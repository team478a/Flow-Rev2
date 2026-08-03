import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/features/auth/session";
import { roleHomePath } from "@/features/auth/role";

/**
 * メール認証リンクの受け口（token_hash 方式）。
 *
 * 招待・マジックリンク・パスワードリセット・メール確認のリンクから呼ばれ、
 * `token_hash` を検証してセッションCookieを発行する。
 *
 * なぜ /auth/callback ではこれを扱えないか:
 *   Supabase の既定のメールリンクは `#access_token=...` というURLフラグメントで
 *   トークンを返す。フラグメントはブラウザがサーバーへ送信しないため、
 *   Route Handler からは読み取れない。実際、招待リンクを開いても
 *   セッションが確立されずログイン画面に戻る状態だった。
 *
 *   `token_hash` はクエリ文字列で渡されるのでサーバーで受け取れる。
 *   Supabase 側のメールテンプレートを `{{ .TokenHash }}` を使う形に変更し、
 *   このルートへ誘導することで、SSR構成のままメール認証が成立する。
 *
 * /auth/callback（`?code=` を交換するPKCE用）は、OAuth等で使われる可能性があるため残す。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    // 期限切れ・使用済み・type不一致・トークン不正が、すべてここに集まる。
    // URLに載せる理由は利用者向けの案内文のためで、内訳は含めない
    // （どのトークンが「存在するが期限切れ」なのかを外部に教えないため）。
    //
    // 一方、内訳が分からないと運用側で切り分けができないので、サーバーログには残す。
    // token_hash そのものは記録しない（有効なら認証情報として使えてしまう）。
    console.warn(
      `[auth/confirm] verifyOtp 失敗 (type=${type}, status=${error.status ?? "-"}, code=${error.code ?? "-"}): ${error.message}`,
    );
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }

  if (next) {
    // オープンリダイレクト防止のため、アプリ内の相対パスのみ許可する。
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  const session = await getSessionProfile();
  const dest = session ? roleHomePath(session.role) : "/login";
  return NextResponse.redirect(`${origin}${dest}`);
}
