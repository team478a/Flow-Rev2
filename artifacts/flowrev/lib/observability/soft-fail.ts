/**
 * 「失敗しても画面は出す」ための握りつぶしを、記録付きで行う。
 *
 * ブランド表示や一覧取得は、失敗してもページ全体を落とすより空で描いたほうがよい。
 * ただし `.catch(() => [])` と書くと、**データが無い状態と取得に失敗した状態が
 * 画面上で区別できなくなる**。実際に `/my` で「コースが1件あるのに空表示」という
 * 症状が出た際、原因の切り分けができなかった。
 *
 * 値のフォールバックは維持したまま、理由をサーバーログへ残す。
 */
export function softFail<T>(label: string, fallback: T): (e: unknown) => T {
  return (e: unknown) => {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[softFail] ${label}: ${reason}`);
    return fallback;
  };
}
