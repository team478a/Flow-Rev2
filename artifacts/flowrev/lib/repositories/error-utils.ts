import "server-only";

/**
 * Supabase/Postgres 等の下位レイヤーのエラー詳細（制約名・カラム名等）を
 * そのままクライアントへ返さないためのヘルパー。
 * 詳細はサーバーログにのみ出力し、クライアントには安全な定型メッセージだけを
 * 持つ例外を投げる。
 */
export function throwSafe(safeMessage: string, cause: unknown): never {
  console.error(safeMessage, cause);
  throw new Error(safeMessage);
}
