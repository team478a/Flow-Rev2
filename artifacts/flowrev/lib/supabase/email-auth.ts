import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "./url";

/**
 * 認証メール送信専用の匿名クライアント（PKCEを使わない）。
 *
 * なぜ `lib/supabase/server.ts` の createClient を使えないか:
 *
 *   `@supabase/ssr` の createServerClient は flowType を "pkce" に固定している。
 *   PKCEでは resetPasswordForEmail が code_challenge を Supabase へ送り、
 *   Supabase は **PKCEに紐付いたトークン**を発行する。メールの
 *   `{{ .TokenHash }}` もそのトークンになる。
 *
 *   ところが verifyOtp は POST /verify に `{ type, token_hash }` を送るだけで、
 *   code_verifier を一切送らない（auth-js に該当する分岐が無い）。
 *   そのため PKCE に紐付いたトークンは /auth/confirm で必ず検証に失敗し、
 *   利用者には「リンクが無効」としか見えない。
 *
 *   招待メールが動いているのは、inviteUserByEmail が service_role の管理
 *   クライアント経由で送られ、PKCEを通らないため。同じ token_hash 方式でも
 *   招待だけ成功しパスワードリセットだけ失敗する、という差はここから出ていた。
 *
 * flowType を "implicit" にすると code_challenge を送らないため、
 * `{{ .TokenHash }}` は招待と同じ通常のトークンになり、/auth/confirm で
 * 検証できる。メールを送るだけでセッションは発行しないので、
 * Cookieの読み書きもセッション永続化も不要。
 */
export function createEmailAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase の環境変数が未設定です: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return createSupabaseClient(normalizeSupabaseUrl(url), anonKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
