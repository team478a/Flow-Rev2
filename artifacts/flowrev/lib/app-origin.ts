/**
 * 認証リンクの組み立てに使う、信頼できるオリジンを決める。
 *
 * リクエストヘッダ（`Host` / `x-forwarded-host`）を使ってはいけない。
 * これらは呼び出し側が指定できる値で、認証リンクの宛先は**メールの受信者**
 * だからである。攻撃者が `/api/p/register` やパスワードリセットへ
 * 偽装したHostで投げると、被害者のもとには
 * `https://攻撃者のドメイン/auth/confirm?token_hash=...` というリンクが届く。
 * 受信者がそれを開いた時点で、有効なワンタイムトークンが攻撃者へ渡り、
 * アカウントを乗っ取れる。
 *
 * 以前はこの値を Supabase へ `redirectTo` として渡していただけで、
 * Supabase 側が Redirect URLs の許可リストと突き合わせ、一致しなければ
 * Site URL にフォールバックしていた。つまり**許可リストが防波堤になっていた**。
 * リンクを自前で組み立てるようにした結果、その防波堤が無くなったため、
 * ここで明示的に信頼できる値だけを使う。
 *
 * 決済のリダイレクト先（Checkoutの success_url 等）と違い、認証リンクは
 * 「間違ったドメインなら失敗する」では済まず「間違ったドメインへ鍵を渡す」
 * ことになるため、決められない場合は送信しない（fail closed）。
 */

/** 末尾スラッシュを落とし、スキームを補う。 */
function normalize(value: string): string {
  const withScheme = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

export class AppOriginUnavailableError extends Error {
  constructor() {
    super(
      "アプリのURLが特定できないため認証リンクを送信できません。環境変数 NEXT_PUBLIC_APP_URL を設定してください。",
    );
    this.name = "AppOriginUnavailableError";
  }
}

/**
 * 認証リンク用のオリジンを返す。決められない場合は例外を投げる。
 *
 * 優先順位:
 *   1. `NEXT_PUBLIC_APP_URL`         — 明示設定。独自ドメイン運用ではこれを使う
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercelが自動で入れる本番ドメイン
 *   3. 本番以外に限り `http://localhost:<port>`
 */
export function getAuthLinkOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return normalize(configured);

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return normalize(vercel);

  if (process.env.NODE_ENV !== "production") {
    return `http://localhost:${process.env.PORT ?? 3000}`;
  }

  throw new AppOriginUnavailableError();
}
