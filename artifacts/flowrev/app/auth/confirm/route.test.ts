import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * メール認証リンクの受け口の検証。
 *
 * ここはログイン前のリクエストを受け、成功すればセッションCookieを発行する。
 * `next` はメールテンプレート由来だが、URLとして外から与えられる値でもあるため、
 * 外部サイトへ飛ばされないことを確認する（ログイン直後の遷移先を
 * 攻撃者が指定できると、フィッシングの着地点として使える）。
 */

const verifyOtp = vi.fn(async () => ({ error: null as { message: string } | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { verifyOtp } }),
}));
vi.mock("@/features/auth/session", () => ({
  getSessionProfile: async () => ({ role: "customer" }),
}));
vi.mock("@/features/auth/role", () => ({
  roleHomePath: () => "/my",
}));

async function call(url: string) {
  const { GET } = await import("./route");
  return GET(new NextRequest(url));
}

const BASE = "https://app.example.com/auth/confirm";

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ error: null });
});

describe("メール認証リンクの受け口", () => {
  it("token_hash を検証して next へ送る", async () => {
    const res = await call(`${BASE}?token_hash=abc&type=invite&next=/my`);

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "invite",
      token_hash: "abc",
    });
    expect(res.headers.get("location")).toBe("https://app.example.com/my");
  });

  it("next が無ければロールのホームへ送る", async () => {
    const res = await call(`${BASE}?token_hash=abc&type=magiclink`);

    expect(res.headers.get("location")).toBe("https://app.example.com/my");
  });

  it("token_hash が無いリンクを拒否する", async () => {
    const res = await call(`${BASE}?type=invite`);

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/login?error=invalid_link");
  });

  it("type が無いリンクを拒否する", async () => {
    const res = await call(`${BASE}?token_hash=abc`);

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/login?error=invalid_link");
  });

  it("期限切れ・使用済みのリンクはログイン画面へ戻す", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired" } });

    const res = await call(`${BASE}?token_hash=old&type=recovery&next=/my`);

    // 検証に失敗した以上、next へ進ませてはいけない
    expect(res.headers.get("location")).toContain("/login?error=link_expired");
  });
});

describe("next の扱い", () => {
  it("外部サイトへのリダイレクトを許さない", async () => {
    const res = await call(
      `${BASE}?token_hash=abc&type=invite&next=https://evil.example.net/steal`,
    );

    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://app.example.com/")).toBe(true);
    expect(location).not.toContain("evil.example.net");
  });

  it("プロトコル相対URL（//evil）も許さない", async () => {
    // "//evil.example.net" は "/" 始まりだが、ブラウザは外部ホストとして解釈する
    const res = await call(
      `${BASE}?token_hash=abc&type=invite&next=//evil.example.net/steal`,
    );

    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("evil.example.net");
  });
});
