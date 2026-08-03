import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 認証メールの自前送信の検証。
 *
 * Supabase のメーラーをやめて自前で送る以上、ここが壊れると
 * 招待メールもパスワードリセットも一通も届かなくなる。
 * しかも呼び出し側（購入Webhook・LP登録）はエラーを握りつぶす設計なので、
 * 決済は成功しメールだけが消える、という形で表に出る。
 *
 * 特に押さえたいのは、リンクの組み立てを間違えないこと。
 * token_hash・type・遷移先のどれが欠けても /auth/confirm は検証に失敗し、
 * 利用者には「リンクが無効」としか見えない。
 */

const generateLink = vi.fn(async (_params: unknown) => ({
  data: {
    properties: { hashed_token: "hashed-abc" },
    user: { id: "user-1" },
  },
  error: null as { message: string } | null,
}));
const send = vi.fn(async (_payload: unknown) => ({
  error: null as { message: string } | null,
}));

let emailSetting: {
  apiKey: string;
  fromEmail: string | null;
  fromName: string | null;
} | null;
let branding: { brandName: string } | null;
let template: { subject: string; bodyHtml: string; tier: string };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink } } }),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (payload: unknown) => send(payload) };
  },
}));
vi.mock("@/lib/repositories/email-settings", () => ({
  getActiveEmailSetting: async () => emailSetting,
}));
vi.mock("@/lib/repositories/white-labels", () => ({
  getWhiteLabelBranding: async () => branding,
}));
vi.mock("@/lib/repositories/auth-email-templates", () => ({
  resolveAuthEmailTemplate: async () => template,
}));
vi.mock("server-only", () => ({}));

async function sendInvite(overrides: Record<string, unknown> = {}) {
  const { sendAuthEmail } = await import("./send-auth-email");
  return sendAuthEmail({
    key: "invite",
    email: "buyer@example.test",
    whiteLabelId: "wl-1",
    origin: "https://app.example.com",
    next: "/my",
    displayName: "購入者",
    userData: { role: "customer", client_id: "c-1" },
    ...overrides,
  });
}

function sentPayload() {
  return send.mock.calls[0]?.[0] as {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  emailSetting = {
    apiKey: "re_test",
    fromEmail: "noreply@example.test",
    fromName: "テストブランド",
  };
  branding = { brandName: "テストブランド" };
  template = {
    subject: "【{{brand}}】ご案内",
    bodyHtml: "<p>{{name}} 様</p><a href='{{link}}'>開く</a>",
    tier: "white_label",
  };
  generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "hashed-abc" }, user: { id: "user-1" } },
    error: null,
  });
  send.mockResolvedValue({ error: null });
});

describe("認証リンクの組み立て", () => {
  it("token_hash・type・next を付けて /auth/confirm へ向ける", async () => {
    await sendInvite();

    const url = new URL(
      sentPayload().html.match(/href='([^']+)'/)?.[1]?.replace(/&amp;/g, "&") ??
        "",
    );
    expect(url.origin + url.pathname).toBe("https://app.example.com/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("hashed-abc");
    expect(url.searchParams.get("type")).toBe("invite");
    expect(url.searchParams.get("next")).toBe("/my");
  });

  it("recovery では type=recovery で生成する", async () => {
    // type がずれると verifyOtp は必ず失敗する。
    // 実際に招待用テンプレートを流用して type=invite のままになっていた。
    await sendInvite({ key: "recovery", next: "/update-password" });

    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recovery" }),
    );
    const url = new URL(
      sentPayload().html.match(/href='([^']+)'/)?.[1]?.replace(/&amp;/g, "&") ??
        "",
    );
    expect(url.searchParams.get("type")).toBe("recovery");
  });

  it("招待ではテナント情報を user_metadata に渡す", async () => {
    // トリガーがこれを読んで user_profiles を作る。
    await sendInvite();

    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "invite",
        options: expect.objectContaining({
          data: expect.objectContaining({ client_id: "c-1" }),
        }),
      }),
    );
  });

  it("リンクを生成できなければ送信しない", async () => {
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "" }, user: { id: "" } },
      error: { message: "User already registered" },
    });

    const result = await sendInvite();

    expect(send).not.toHaveBeenCalled();
    expect(result.error).toContain("User already registered");
  });
});

describe("差し込みとエスケープ", () => {
  it("ブランド名と宛名を差し込む", async () => {
    await sendInvite();

    expect(sentPayload().subject).toBe("【テストブランド】ご案内");
    expect(sentPayload().html).toContain("購入者 様");
  });

  it("宛名のHTMLをエスケープする", async () => {
    // 表示名はLP登録フォーム由来で、利用者が自由に入力できる。
    await sendInvite({ displayName: "<script>alert(1)</script>" });

    expect(sentPayload().html).not.toContain("<script>");
    expect(sentPayload().html).toContain("&lt;script&gt;");
  });

  it("OEM未設定なら FlowRev を使う", async () => {
    branding = null;

    await sendInvite({ whiteLabelId: null });

    expect(sentPayload().subject).toContain("FlowRev");
  });
});

describe("送信設定", () => {
  it("送信元が未設定なら送らずに理由を返す", async () => {
    // 呼び出し側はエラーを握りつぶすため、原因が分かる文言で返す必要がある。
    emailSetting = null;

    const result = await sendInvite();

    expect(send).not.toHaveBeenCalled();
    expect(result.error).toContain("メール設定");
  });

  it("送信元が未設定でも authUserId は返す", async () => {
    // ユーザーは既に作られている。ここで null を返すと呼び出し側が
    // テナント紐付けを飛ばし、復旧の必要な行が残る。
    emailSetting = null;

    const result = await sendInvite();

    expect(result.authUserId).toBe("user-1");
  });

  it("差出人名があれば From に含める", async () => {
    await sendInvite();

    expect(sentPayload().from).toBe("テストブランド <noreply@example.test>");
  });

  it("送信に失敗したら理由を返す", async () => {
    send.mockResolvedValue({ error: { message: "domain not verified" } });

    const result = await sendInvite();

    expect(result.error).toContain("domain not verified");
  });
});
