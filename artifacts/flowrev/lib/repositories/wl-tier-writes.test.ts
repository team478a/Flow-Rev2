import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type Row } from "@/test/helpers/fake-supabase";

/**
 * OEM（WL）単位の設定を保存する処理の検証。
 *
 * `/wl/settings/*` の各画面から呼ばれ、対象は常に「自分のOEMの行」でなければならない。
 * ここで対象を絞り損ねると、OEMオーナーの保存操作が
 *  - 他OEMの認証情報を上書きする
 *  - 配下クライアントが個別に設定した行を書き換える
 * という形でテナント境界を越える。いずれも保存は成功して見えるため、
 * 操作した本人にも気づけない。
 *
 * フォールバック読み取り（settings-fallback.test.ts）が「読む側」を守るのに対し、
 * こちらは「書く側」を守る。
 */

const WL_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_WL_ID = "88888888-8888-8888-8888-888888888888";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

process.env.ENCRYPTION_KEY = "0".repeat(64);

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fake,
}));

function setup(tables: Record<string, Row[]>) {
  fake = createFakeSupabase(tables);
}

beforeEach(() => vi.resetModules());

describe("LINE設定のOEM単位保存", () => {
  it("自OEM行が無ければ作る（client_id は NULL）", async () => {
    setup({ line_accounts: [] });
    const { upsertLineSettingsForWhiteLabel } = await import("./line-settings");

    await upsertLineSettingsForWhiteLabel(WL_ID, {
      channelAccessToken: "token",
      channelSecret: "secret",
    });

    const rows = fake.tables.line_accounts;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.white_label_id).toBe(WL_ID);
    // client_id が入ると、フォールバックの「クライアント階層」として扱われてしまう
    expect(rows[0]?.client_id).toBeNull();
  });

  it("他OEMの行を書き換えない", async () => {
    setup({
      line_accounts: [
        {
          id: "other",
          client_id: null,
          white_label_id: OTHER_WL_ID,
          channel_access_token_enc: "other_token",
        },
      ],
    });
    const { upsertLineSettingsForWhiteLabel } = await import("./line-settings");

    await upsertLineSettingsForWhiteLabel(WL_ID, {
      channelAccessToken: "mine",
    });

    const other = fake.tables.line_accounts.find((r) => r.id === "other");
    expect(other?.channel_access_token_enc).toBe("other_token");
    // 自分の行は別途作られる
    expect(fake.tables.line_accounts).toHaveLength(2);
  });

  it("配下クライアントの行を書き換えない", async () => {
    setup({
      line_accounts: [
        {
          id: "client-row",
          client_id: CLIENT_ID,
          white_label_id: WL_ID,
          channel_access_token_enc: "client_token",
        },
      ],
    });
    const { upsertLineSettingsForWhiteLabel } = await import("./line-settings");

    await upsertLineSettingsForWhiteLabel(WL_ID, {
      channelAccessToken: "wl_token",
    });

    const clientRow = fake.tables.line_accounts.find(
      (r) => r.id === "client-row",
    );
    // 同じ white_label_id を持つが client_id があるので対象外
    expect(clientRow?.channel_access_token_enc).toBe("client_token");
  });

  it("キー未入力なら既存の値を保持する", async () => {
    setup({
      line_accounts: [
        {
          id: "mine",
          client_id: null,
          white_label_id: WL_ID,
          channel_access_token_enc: "existing_enc",
          channel_secret_enc: "existing_secret",
        },
      ],
    });
    const { upsertLineSettingsForWhiteLabel } = await import("./line-settings");

    await upsertLineSettingsForWhiteLabel(WL_ID, {
      lineFriendUrl: "https://line.me/R/ti/p/@test",
    });

    const row = fake.tables.line_accounts.find((r) => r.id === "mine");
    expect(row?.channel_access_token_enc).toBe("existing_enc");
    expect(row?.channel_secret_enc).toBe("existing_secret");
    expect(row?.line_friend_url).toBe("https://line.me/R/ti/p/@test");
  });
});

describe("Stripe設定のOEM単位保存", () => {
  it("自OEM行を作る（client_id は NULL）", async () => {
    setup({ stripe_accounts: [] });
    const { upsertStripeSettingsForWhiteLabel } = await import(
      "./stripe-settings"
    );

    await upsertStripeSettingsForWhiteLabel(WL_ID, {
      secretKey: "sk_test_x",
      webhookSecret: "whsec_x",
    });

    const rows = fake.tables.stripe_accounts;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.white_label_id).toBe(WL_ID);
    expect(rows[0]?.client_id).toBeNull();
  });

  it("他OEMの決済設定を書き換えない", async () => {
    // 決済設定の越境は売上の行き先が変わることを意味する
    setup({
      stripe_accounts: [
        {
          id: "other",
          client_id: null,
          white_label_id: OTHER_WL_ID,
          access_token_enc: "other_key",
        },
      ],
    });
    const { upsertStripeSettingsForWhiteLabel } = await import(
      "./stripe-settings"
    );

    await upsertStripeSettingsForWhiteLabel(WL_ID, { secretKey: "sk_mine" });

    const other = fake.tables.stripe_accounts.find((r) => r.id === "other");
    expect(other?.access_token_enc).toBe("other_key");
  });

  it("キー未入力なら既存の値を保持する", async () => {
    setup({
      stripe_accounts: [
        {
          id: "mine",
          client_id: null,
          white_label_id: WL_ID,
          access_token_enc: "existing_key",
          webhook_secret_enc: "existing_whsec",
        },
      ],
    });
    const { upsertStripeSettingsForWhiteLabel } = await import(
      "./stripe-settings"
    );

    await upsertStripeSettingsForWhiteLabel(WL_ID, { isLive: false });

    const row = fake.tables.stripe_accounts.find((r) => r.id === "mine");
    expect(row?.access_token_enc).toBe("existing_key");
    expect(row?.webhook_secret_enc).toBe("existing_whsec");
  });
});

describe("AI設定のOEM単位保存", () => {
  it("provider ごとに別の行を持つ", async () => {
    setup({ ai_provider_settings: [] });
    const { upsertWlAiSetting } = await import("./ai-settings");

    await upsertWlAiSetting(WL_ID, { provider: "anthropic", apiKey: "k1" });
    await upsertWlAiSetting(WL_ID, { provider: "openai", apiKey: "k2" });

    const rows = fake.tables.ai_provider_settings;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.white_label_id === WL_ID)).toBe(true);
  });

  it("HQ共通行（white_label_id NULL）を書き換えない", async () => {
    setup({
      ai_provider_settings: [
        {
          id: "hq",
          white_label_id: null,
          provider: "anthropic",
          api_key_enc: "hq_key",
        },
      ],
    });
    const { upsertWlAiSetting } = await import("./ai-settings");

    await upsertWlAiSetting(WL_ID, { provider: "anthropic", apiKey: "wl_key" });

    const hq = fake.tables.ai_provider_settings.find((r) => r.id === "hq");
    expect(hq?.api_key_enc).toBe("hq_key");
    expect(fake.tables.ai_provider_settings).toHaveLength(2);
  });
});

describe("Cloudflare設定のOEM単位保存", () => {
  it("自OEM行を作る（client_id は NULL）", async () => {
    setup({ cloudflare_settings: [] });
    const { upsertCloudflareSettingsForWhiteLabel } = await import(
      "./cloudflare-settings"
    );

    await upsertCloudflareSettingsForWhiteLabel(WL_ID, {
      accountId: "acct",
      apiToken: "token",
    });

    const rows = fake.tables.cloudflare_settings;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.white_label_id).toBe(WL_ID);
    expect(rows[0]?.client_id).toBeNull();
  });

  it("HQ共通行を書き換えない", async () => {
    // HQ行は Webhook と Cron が参照する。ここを壊すと全社の動画処理に波及する
    setup({
      cloudflare_settings: [
        {
          id: "hq",
          client_id: null,
          white_label_id: null,
          account_id: "hq_acct",
          api_token_enc: "hq_token",
        },
      ],
    });
    const { upsertCloudflareSettingsForWhiteLabel } = await import(
      "./cloudflare-settings"
    );

    await upsertCloudflareSettingsForWhiteLabel(WL_ID, {
      accountId: "wl_acct",
      apiToken: "wl_token",
    });

    const hq = fake.tables.cloudflare_settings.find((r) => r.id === "hq");
    expect(hq?.account_id).toBe("hq_acct");
    expect(hq?.api_token_enc).toBe("hq_token");
  });
});
