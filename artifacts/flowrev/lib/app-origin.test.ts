import { describe, it, expect, beforeEach, vi } from "vitest";
import { getAuthLinkOrigin, AppOriginUnavailableError } from "./app-origin";

/**
 * 認証リンクのオリジン決定の検証。
 *
 * ここは「間違ったドメインなら失敗する」で済まない。認証リンクは
 * **有効なワンタイムトークンを含んだURL**で、宛先はメールの受信者である。
 * リクエストヘッダ（Host / x-forwarded-host）から組み立てると、攻撃者が
 * 偽装したHostで /api/p/register やパスワードリセットを叩くだけで、
 * 被害者のもとに `https://攻撃者のドメイン/auth/confirm?token_hash=...`
 * というリンクが届く。開かれた時点でアカウントを奪える。
 *
 * 以前は Supabase の Redirect URLs 許可リストが防波堤になっていたが、
 * リンクを自前で組み立てるようにした結果その保護が外れたため、
 * 「ヘッダを一切見ない」ことをここで固定する。
 */

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
});

describe("認証リンクのオリジン", () => {
  it("NEXT_PUBLIC_APP_URL を最優先で使う", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "other.vercel.app");

    expect(getAuthLinkOrigin()).toBe("https://app.example.com");
  });

  it("末尾のスラッシュを落とす", () => {
    // 落とさないと `https://app.example.com//auth/confirm` になる
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");

    expect(getAuthLinkOrigin()).toBe("https://app.example.com");
  });

  it("スキームが無ければ https を補う", () => {
    // VERCEL_PROJECT_PRODUCTION_URL はホスト名だけで渡ってくる
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "flow-rev2.vercel.app");

    expect(getAuthLinkOrigin()).toBe("https://flow-rev2.vercel.app");
  });

  it("本番で設定が無ければ例外を投げる（ヘッダへフォールバックしない）", () => {
    // ここで黙ってリクエストのHostを使うと、上のコメントの経路が復活する。
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getAuthLinkOrigin()).toThrow(AppOriginUnavailableError);
  });

  it("本番以外では localhost を使う", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(getAuthLinkOrigin()).toContain("http://localhost");
  });
});
