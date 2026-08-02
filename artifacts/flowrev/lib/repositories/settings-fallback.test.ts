import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type Row } from "@/test/helpers/fake-supabase";

/**
 * 設定解決のフォールバック（クライアント→WL→HQ）の検証。
 *
 * 階層判定を誤ると「他テナントの認証情報を使う」という形で失敗しうる箇所であり、
 * Phase 1（PR #3・#4・#7・#9）で4つのリポジトリに同じパターンを実装したため、
 * ここで挙動を固定しておく。
 */

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const WL_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_WL_ID = "33333333-3333-3333-3333-333333333333";

// ENCRYPTION_KEY は decrypt を通る経路で必要になる。
// 復号結果そのものは検証対象ではないので、テスト用の固定鍵で十分。
process.env.ENCRYPTION_KEY = "0".repeat(64);

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fake,
}));

function setup(tables: Record<string, Row[]>) {
  fake = createFakeSupabase({
    clients: [{ id: CLIENT_ID, white_label_id: WL_ID }],
    ...tables,
  });
}

describe("LINE設定のフォールバック", () => {
  beforeEach(() => vi.resetModules());

  it("クライアント行があればそれを使い、tierはclientになる", async () => {
    setup({
      line_accounts: [
        { client_id: CLIENT_ID, channel_access_token_enc: "c", channel_secret_enc: "c" },
        { client_id: null, white_label_id: WL_ID, channel_access_token_enc: "w" },
        { client_id: null, white_label_id: null, channel_access_token_enc: "h" },
      ],
    });
    const { getLineSettingsMasked } = await import("./line-settings");
    const result = await getLineSettingsMasked(CLIENT_ID);
    expect(result?.tier).toBe("client");
  });

  it("クライアント行が無ければ自OEMの行にフォールバックする", async () => {
    setup({
      line_accounts: [
        { client_id: null, white_label_id: WL_ID, channel_access_token_enc: "w" },
        { client_id: null, white_label_id: null, channel_access_token_enc: "h" },
      ],
    });
    const { getLineSettingsMasked } = await import("./line-settings");
    const result = await getLineSettingsMasked(CLIENT_ID);
    expect(result?.tier).toBe("white_label");
  });

  it("クライアント行もWL行も無ければHQ行にフォールバックする", async () => {
    setup({
      line_accounts: [
        { client_id: null, white_label_id: null, channel_access_token_enc: "h" },
      ],
    });
    const { getLineSettingsMasked } = await import("./line-settings");
    const result = await getLineSettingsMasked(CLIENT_ID);
    expect(result?.tier).toBe("hq");
  });

  it("どの階層にも無ければ null を返す", async () => {
    setup({ line_accounts: [] });
    const { getLineSettingsMasked } = await import("./line-settings");
    expect(await getLineSettingsMasked(CLIENT_ID)).toBeNull();
  });

  it("他OEMの行は自分のフォールバック先にならない", async () => {
    setup({
      line_accounts: [
        {
          client_id: null,
          white_label_id: OTHER_WL_ID,
          channel_access_token_enc: "other",
        },
      ],
    });
    const { getLineSettingsMasked } = await import("./line-settings");
    // 他OEMの行しか無いので、解決結果は null でなければならない。
    // ここが white_label で返ると、他社の認証情報を使ってしまう。
    expect(await getLineSettingsMasked(CLIENT_ID)).toBeNull();
  });
});

describe("Stripe設定のフォールバック", () => {
  beforeEach(() => vi.resetModules());

  it("クライアント→WL→HQの順に解決する", async () => {
    setup({
      stripe_accounts: [
        { client_id: null, white_label_id: WL_ID, access_token_enc: "w" },
        { client_id: null, white_label_id: null, access_token_enc: "h" },
      ],
    });
    const { getStripeSettingsMasked } = await import("./stripe-settings");
    expect((await getStripeSettingsMasked(CLIENT_ID))?.tier).toBe("white_label");
  });

  it("他OEMの行は自分のフォールバック先にならない", async () => {
    setup({
      stripe_accounts: [
        { client_id: null, white_label_id: OTHER_WL_ID, access_token_enc: "other" },
      ],
    });
    const { getStripeSettingsMasked } = await import("./stripe-settings");
    expect(await getStripeSettingsMasked(CLIENT_ID)).toBeNull();
  });
});

describe("Cloudflare設定のフォールバック", () => {
  beforeEach(() => vi.resetModules());

  it("clientIdを渡すとクライアント→WL→HQの順に解決する", async () => {
    setup({
      cloudflare_settings: [
        { client_id: null, white_label_id: WL_ID, account_id: "w", api_token_enc: "w" },
        { client_id: null, white_label_id: null, account_id: "h", api_token_enc: "h" },
      ],
    });
    const { getCloudflareSettingsMasked } = await import("./cloudflare-settings");
    expect((await getCloudflareSettingsMasked(CLIENT_ID))?.tier).toBe(
      "white_label",
    );
  });

  it("clientIdを渡さない場合はHQ行のみを見る（Webhook・Cron経路）", async () => {
    setup({
      cloudflare_settings: [
        { client_id: CLIENT_ID, account_id: "c", api_token_enc: "c" },
        { client_id: null, white_label_id: WL_ID, account_id: "w", api_token_enc: "w" },
        { client_id: null, white_label_id: null, account_id: "h", api_token_enc: "h" },
      ],
    });
    const { getCloudflareSettingsMasked } = await import("./cloudflare-settings");
    const result = await getCloudflareSettingsMasked();

    // 引数なしの呼び出しでクライアント行やWL行を掴むと、
    // Cronが他テナントのアカウントを操作してしまう。
    expect(result?.tier).toBe("hq");
    expect(result?.accountId).toBe("h");
  });
});
