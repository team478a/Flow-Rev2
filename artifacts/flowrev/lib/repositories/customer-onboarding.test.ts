import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase, type Row } from "@/test/helpers/fake-supabase";

/**
 * 購入者・LP登録者をcustomerとして招待し、テナントに紐付ける処理の検証。
 *
 * ここが壊れると2種類の失敗が起きる。
 *  - テナントを付け損ねる → 購入者が /my に入れない（PR #15 で修正した不具合）
 *  - テナントを上書きしすぎる → 既存ユーザーが別テナントへ移される（より深刻）
 *
 * 後者は正常系では表面化しない。新規ユーザーは client_id が NULL なので、
 * スコープ指定の有無にかかわらず同じ結果になるため。
 */

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const WL_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_CLIENT_ID = "99999999-9999-9999-9999-999999999999";
const OTHER_WL_ID = "88888888-8888-8888-8888-888888888888";
const USER_ID = "invited-user-id";

let fake: ReturnType<typeof createFakeSupabase>;

// メール送信自体は send-auth-email.test.ts で検証する。
// ここで見たいのは、送信結果を受けたあとのテナント紐付け。
const sendAuthEmail = vi.fn(async (_input: unknown) => ({
  authUserId: USER_ID as string | null,
  error: null as string | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fake,
}));
vi.mock("@/lib/email/send-auth-email", () => ({
  sendAuthEmail: (input: unknown) => sendAuthEmail(input),
}));

function setup(tables: Record<string, Row[]> = {}) {
  fake = createFakeSupabase({ user_profiles: [], customers: [], ...tables });
}

async function invite() {
  const { inviteCustomerWithTenant } = await import("./customer-onboarding");
  return inviteCustomerWithTenant({
    email: "buyer@example.com",
    clientId: CLIENT_ID,
    whiteLabelId: WL_ID,
    displayName: "購入者",
    origin: "https://example.com",
    next: "/my",
  });
}

beforeEach(() => {
  vi.resetModules();
  sendAuthEmail.mockResolvedValue({ authUserId: USER_ID, error: null });
});

describe("招待時のテナント紐付け", () => {
  it("トリガーが作った client_id NULL の行にテナントを補う", async () => {
    // auth.users への INSERT で on_auth_user_created が先に行を作る状況を再現する。
    setup({
      user_profiles: [{ id: USER_ID, role: "customer", client_id: null, white_label_id: null }],
    });

    await invite();

    const profile = fake.tables.user_profiles.find((r) => r.id === USER_ID);
    expect(profile?.client_id).toBe(CLIENT_ID);
    expect(profile?.white_label_id).toBe(WL_ID);
  });

  it("行が無ければ作る", async () => {
    setup();

    await invite();

    const profile = fake.tables.user_profiles.find((r) => r.id === USER_ID);
    expect(profile?.client_id).toBe(CLIENT_ID);
    expect(profile?.role).toBe("customer");
  });

  it("既に別テナントに所属しているユーザーの所属は変えない", async () => {
    // 同じメールアドレスの人物が別クライアントに既に居るケース。
    // ここで上書きしてしまうと、そのユーザーは元のテナントのデータを失い、
    // 招待した側のテナントのデータが見えるようになる。
    setup({
      user_profiles: [
        {
          id: USER_ID,
          role: "customer",
          client_id: OTHER_CLIENT_ID,
          white_label_id: OTHER_WL_ID,
        },
      ],
    });

    await invite();

    const profile = fake.tables.user_profiles.find((r) => r.id === USER_ID);
    expect(profile?.client_id).toBe(OTHER_CLIENT_ID);
    expect(profile?.white_label_id).toBe(OTHER_WL_ID);
  });

  it("招待メタデータにテナント情報を含める", async () => {
    // トリガーは raw_user_meta_data からテナントを読むため、
    // ここに含まれていないと NULL の行が作られる。
    setup();

    await invite();

    expect(sendAuthEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "invite",
        userData: expect.objectContaining({
          role: "customer",
          client_id: CLIENT_ID,
          white_label_id: WL_ID,
        }),
      }),
    );
  });

  it("送信先OEMと着地先を渡す", async () => {
    // OEMごとの文面・送信元を解決するのに white_label_id が要る。
    setup();

    await invite();

    expect(sendAuthEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        whiteLabelId: WL_ID,
        origin: "https://example.com",
        next: "/my",
      }),
    );
  });

  it("customers 行を認証ユーザーに紐付ける", async () => {
    setup({
      customers: [
        { email: "buyer@example.com", client_id: CLIENT_ID, user_id: null },
      ],
    });

    await invite();

    const customer = fake.tables.customers[0];
    expect(customer?.user_id).toBe(USER_ID);
  });

  it("他クライアントの同名メールの customers 行には触れない", async () => {
    setup({
      customers: [
        { email: "buyer@example.com", client_id: CLIENT_ID, user_id: null },
        { email: "buyer@example.com", client_id: OTHER_CLIENT_ID, user_id: null },
      ],
    });

    await invite();

    const mine = fake.tables.customers.find((c) => c.client_id === CLIENT_ID);
    const other = fake.tables.customers.find(
      (c) => c.client_id === OTHER_CLIENT_ID,
    );
    expect(mine?.user_id).toBe(USER_ID);
    expect(other?.user_id).toBeNull();
  });
});

describe("招待が失敗した場合", () => {
  it("authUserId は null になり、エラーを返す", async () => {
    setup();
    sendAuthEmail.mockResolvedValue({
      authUserId: null,
      error: "email rate limit exceeded",
    });

    const result = await invite();

    expect(result.authUserId).toBeNull();
    expect(result.error).toContain("rate limit");
  });

  it("プロフィールや customers を書き換えない", async () => {
    setup({
      user_profiles: [{ id: USER_ID, role: "customer", client_id: null }],
      customers: [
        { email: "buyer@example.com", client_id: CLIENT_ID, user_id: null },
      ],
    });
    sendAuthEmail.mockResolvedValue({ authUserId: null, error: "invite failed" });

    await invite();

    expect(fake.tables.user_profiles[0]?.client_id).toBeNull();
    expect(fake.tables.customers[0]?.user_id).toBeNull();
  });

  it("メールは送れなくてもユーザーが作られていればテナントを紐付ける", async () => {
    // 認証ユーザーは作られたがResendの送信で落ちた場合、ここで諦めると
    // 「アカウントはあるがテナント未設定」という復旧の必要な状態が残る。
    // 招待の再送で回復できるよう、紐付けだけは済ませておく。
    setup();
    sendAuthEmail.mockResolvedValue({
      authUserId: USER_ID,
      error: "メール送信に失敗しました: domain not verified",
    });

    await invite();

    const profile = fake.tables.user_profiles.find((r) => r.id === USER_ID);
    expect(profile?.client_id).toBe(CLIENT_ID);
  });
});
