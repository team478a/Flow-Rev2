import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * パスワードリセットの送信処理の検証。
 *
 * ここには性質の違う2つの失敗がある。
 *
 *  1. リンク先がずれる
 *     「メールを送る」処理と「新パスワードを入力する画面」は別ファイルで、
 *     両者を繋ぐのは next に書いた文字列だけ。ずれても送信はエラーにならず、
 *     /auth/confirm の検証も成功するため、**リンクを踏んだ利用者だけが404に出会う**。
 *     実際に `/auth/update-password` と書かれていたが、画面の実体は
 *     app/(auth)/update-password/page.tsx にあり、`(auth)` はルートグループなので
 *     URLには現れない。正しいURLは `/update-password`。
 *
 *  2. アドレスの存在を漏らす
 *     送信可否で画面表示を変えると、登録済みアドレスの総当たり確認に使える。
 */

const sendAuthEmail = vi.fn(async (_input: unknown) => ({
  authUserId: null as string | null,
  error: null as string | null,
}));

vi.mock("next/headers", () => ({
  headers: () => new Map([["host", "app.example.com"]]),
}));
vi.mock("next/navigation", () => ({
  redirect: () => undefined,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: {} }),
}));
vi.mock("@/lib/email/send-auth-email", () => ({
  sendAuthEmail: (input: unknown) => sendAuthEmail(input),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => "127.0.0.1",
  hashForRateLimitKey: (v: string) => v,
}));
vi.mock("./session", () => ({ getSessionProfile: async () => null }));
vi.mock("./role", () => ({ roleHomePath: () => "/my" }));

const APP_DIR = resolve(__dirname, "../../app");

/** app ディレクトリを辿り、page.tsx が存在するURLパスを集める。 */
function collectRoutes(dir: string, urlPath = ""): string[] {
  const routes: string[] = [];
  if (existsSync(join(dir, "page.tsx"))) routes.push(urlPath || "/");

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith("_") || name.startsWith("[")) continue;
    // (group) はURLに現れない。@slot も同様。
    const segment =
      name.startsWith("(") && name.endsWith(")")
        ? ""
        : name.startsWith("@")
          ? null
          : `/${name}`;
    if (segment === null) continue;
    routes.push(...collectRoutes(join(dir, name), `${urlPath}${segment}`));
  }
  return routes;
}

async function sendReset() {
  const { requestPasswordReset } = await import("./actions");
  const form = new FormData();
  form.set("email", "user@example.test");
  return requestPasswordReset({ error: null, success: null }, form);
}

function sentInput() {
  return sendAuthEmail.mock.calls[0]?.[0] as {
    key: string;
    next: string;
    origin: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  sendAuthEmail.mockResolvedValue({ authUserId: null, error: null });
});

describe("パスワードリセットメールのリンク先", () => {
  it("recovery のテンプレートで送る", async () => {
    await sendReset();

    expect(sentInput().key).toBe("recovery");
  });

  it("next が実在するページを指している", async () => {
    // 文字列を突き合わせるだけでは同じ誤りを書き写しかねないので、
    // app ディレクトリから実在するURLを組み立てて突き合わせる。
    await sendReset();

    expect(collectRoutes(APP_DIR)).toContain(sentInput().next);
  });

  it("next が認証不要パスに含まれている", async () => {
    // パスワードを忘れた利用者はログインできない。遷移先が認証必須だと
    // middleware に弾かれてログイン画面へ送り返される。
    await sendReset();
    const next = sentInput().next;

    const { PUBLIC_PREFIXES } = await import("@/lib/supabase/middleware");
    const isPublic = PUBLIC_PREFIXES.some(
      (p) => next === p || next.startsWith(`${p}/`),
    );
    expect(isPublic).toBe(true);
  });
});

describe("アドレスの存在を漏らさない", () => {
  it("送信に失敗しても画面には成功と返す", async () => {
    // 未登録アドレスだと generateLink がエラーになる。ここで結果を出し分けると、
    // 「どのアドレスが登録済みか」を外部から総当たりで確認できてしまう。
    sendAuthEmail.mockResolvedValue({
      authUserId: null,
      error: "User not found",
    });

    const result = await sendReset();

    expect(result.error).toBeNull();
    expect(result.success).toBeTruthy();
  });

  it("成功時と失敗時で応答が変わらない", async () => {
    sendAuthEmail.mockResolvedValue({ authUserId: null, error: null });
    const ok = await sendReset();

    vi.resetModules();
    sendAuthEmail.mockResolvedValue({ authUserId: null, error: "User not found" });
    const ng = await sendReset();

    expect(ng).toEqual(ok);
  });
});
