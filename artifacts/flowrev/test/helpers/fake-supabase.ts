/**
 * リポジトリ層のテスト用に、supabase-js のクエリビルダを最小限だけ模したフェイク。
 *
 * 設定解決（クライアント→WL→HQ）は「どのテーブルにどの条件で問い合わせ、
 * どの順で最初のヒットを採るか」がすべてなので、
 * ここではテーブルごとの行データに対して .eq() / .is() のフィルタを適用し、
 * .maybeSingle() で先頭1件を返す、という挙動だけを再現する。
 *
 * 併せて発行されたクエリを `calls` に記録するので、
 * 「クライアント行が見つかった時点でWL/HQを問い合わせない」といった
 * 検索順序そのものも検証できる。
 */

export type Row = Record<string, unknown>;

export interface RecordedCall {
  table: string;
  filters: Array<{ op: "eq" | "is"; column: string; value: unknown }>;
}

export interface FakeSupabase {
  from: (table: string) => QueryBuilder;
  calls: RecordedCall[];
}

interface QueryBuilder {
  select: (columns?: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  is: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, opts?: unknown) => QueryBuilder;
  limit: (n: number) => QueryBuilder;
  maybeSingle: () => Promise<{ data: Row | null; error: null }>;
  then: (
    onfulfilled: (v: { data: Row[]; error: null }) => unknown,
  ) => Promise<unknown>;
}

function matches(
  row: Row,
  filters: RecordedCall["filters"],
): boolean {
  return filters.every((f) => {
    const actual = row[f.column];
    if (f.op === "is") {
      // .is(col, null) は SQL の IS NULL 相当。undefined も未設定として扱う。
      return f.value === null ? actual == null : actual === f.value;
    }
    return actual === f.value;
  });
}

/**
 * @param tables テーブル名 → 行の配列
 */
export function createFakeSupabase(
  tables: Record<string, Row[]>,
): FakeSupabase {
  const calls: RecordedCall[] = [];

  function from(table: string): QueryBuilder {
    const call: RecordedCall = { table, filters: [] };
    calls.push(call);

    const builder: QueryBuilder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (column, value) => {
        call.filters.push({ op: "eq", column, value });
        return builder;
      },
      is: (column, value) => {
        call.filters.push({ op: "is", column, value });
        return builder;
      },
      maybeSingle: async () => {
        const rows = (tables[table] ?? []).filter((r) =>
          matches(r, call.filters),
        );
        return { data: rows[0] ?? null, error: null };
      },
      then: (onfulfilled) => {
        const rows = (tables[table] ?? []).filter((r) =>
          matches(r, call.filters),
        );
        return Promise.resolve(onfulfilled({ data: rows, error: null }));
      },
    };

    return builder;
  }

  return { from, calls };
}
