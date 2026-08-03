import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 認証メールが指すリンク先の検証。
 *
 * パスワードリセットは「メールを送る」処理と「新パスワードを入力する画面」が
 * 別ファイルに分かれており、両者を繋ぐのは redirectTo に書いた文字列だけ。
 * ここがずれても送信処理はエラーにならず、`/auth/confirm` の token_hash 検証も
 * 成功するため、**リンクを踏んだ利用者だけが404に出会う**。
 *
 * 実際に `next=/auth/update-password` と書かれていたが、画面の実体は
 * app/(auth)/update-password/page.tsx にあり、`(auth)` は Next.js の
 * ルートグループなのでURLには現れない。正しいURLは `/update-password`。
 *
 * 文字列を直接比較するだけでは同じ間違いを書き写しかねないので、
 * app ディレクトリから実在するURLを組み立てて突き合わせる。
 */

const resetPasswordForEmail = vi.fn(async (_email: string, _opts: unknown) => ({
  error: null as { status?: number } | null,
}));

vi.mock("next/headers", () => ({
  headers: () => new Map([["host", "app.example.com"]]),
}));
vi.mock("next/navigation", () => ({
  redirect: () => undefined,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { resetPasswordForEmail } }),
}));

// email-auth.ts 本体を通し、supabase-js に渡るオプションを観測する。
// ここをスタブで置き換えると flowType の検証ができなくなる。
const supabaseCreateClient = vi.fn((_url: string, _key: string, opts: unknown) => {
  createdOptions.push(opts);
  return { auth: { resetPasswordForEmail } };
});
let createdOptions: unknown[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, opts: unknown) =>
    supabaseCreateClient(url, key, opts),
}));
vi.mock("server-only", () => ({}));
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
  await requestPasswordReset({ error: null, success: null }, form);
  const opts = resetPasswordForEmail.mock.calls[0]?.[1] as {
    redirectTo: string;
  };
  return new URL(opts.redirectTo);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  createdOptions = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("パスワードリセットメールの送信クライアント", () => {
  it("PKCEを使わないクライアントで送る", async () => {
    // @supabase/ssr の createServerClient は flowType を "pkce" に固定する。
    // PKCEで送るとSupabaseはPKCEに紐付いたトークンを発行するが、
    // verifyOtp は code_verifier を送らないため /auth/confirm で必ず失敗する。
    // 招待メール（service_role経由でPKCEを通らない）だけが動き、
    // パスワードリセットだけが壊れる、という形で表に出る。
    await sendReset();

    const auth = (createdOptions[0] as { auth?: { flowType?: string } })?.auth;
    expect(auth?.flowType).toBe("implicit");
  });

  it("セッションを永続化しない", async () => {
    // メールを送るだけでセッションは発行しない。Cookieを書く必要がない。
    await sendReset();

    const auth = (createdOptions[0] as { auth?: { persistSession?: boolean } })
      ?.auth;
    expect(auth?.persistSession).toBe(false);
  });
});

describe("パスワードリセットメールのリンク先", () => {
  it("/auth/confirm を経由する", async () => {
    // token_hash を検証してセッションCookieを発行できるのはこのルートだけ
    const url = await sendReset();

    expect(url.pathname).toBe("/auth/confirm");
  });

  it("next が実在するページを指している", async () => {
    const url = await sendReset();
    const next = url.searchParams.get("next");

    expect(next).toBeTruthy();
    expect(collectRoutes(APP_DIR)).toContain(next);
  });

  it("next が認証不要パスに含まれている", async () => {
    // パスワードを忘れた利用者はログインできない。遷移先が認証必須だと
    // middleware に弾かれてログイン画面へ送り返される。
    const url = await sendReset();
    const next = url.searchParams.get("next") ?? "";

    const { PUBLIC_PREFIXES } = await import("@/lib/supabase/middleware");
    const isPublic = PUBLIC_PREFIXES.some(
      (p) => next === p || next.startsWith(`${p}/`),
    );
    expect(isPublic).toBe(true);
  });
});
