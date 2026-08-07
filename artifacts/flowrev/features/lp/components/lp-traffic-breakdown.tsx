import { BarChart3 } from "lucide-react";
import type { TrafficSourceCount } from "@/lib/repositories/landing-pages";

interface Props {
  sources: TrafficSourceCount[];
  total: number;
  truncated: boolean;
}

/**
 * LP経由の登録を流入元ごとに表示する。
 *
 * 「どの集客が効いたか」を判断するための画面なので、数字が実態とずれる形の
 * 省略はしない。集計を打ち切った場合はその旨を明示する。
 */
export function LpTrafficBreakdown({ sources, total, truncated }: Props) {
  if (total === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">流入元</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          このLPからの登録はまだありません。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          広告やSNSに貼るURLへ <code className="font-mono">?utm_source=twitter</code>{" "}
          のように付けると、経路ごとの登録数がここに出ます。
        </p>
      </div>
    );
  }

  const max = Math.max(...sources.map((s) => s.count));

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">流入元</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          登録 {total.toLocaleString()} 件
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {sources.map((s) => {
          const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
          return (
            <li key={s.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{s.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {s.count.toLocaleString()} 件（{pct}%）
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${max > 0 ? (s.count / max) * 100 : 0}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {truncated && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          登録が多いため、直近の一部のみを集計しています。表示中の合計は実際の登録総数より少なくなります。
        </p>
      )}
    </div>
  );
}
