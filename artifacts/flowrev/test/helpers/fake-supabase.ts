/**
 * リポジトリ層のテスト用に、supabase-js のクエリビルダを最小限だけ模したフェイク。
 *
 * インメモリの行データに対して .eq() / .is() のフィルタを適用し、
 * select / insert / update / upsert を実行する。
 *
 * 実際に行を書き換えるので、テストは「どんなクエリを投げたか」ではなく
 * 「結果としてどの行がどう変わったか」を検証できる。
 * `.is("client_id", null)` のようなスコープ指定が効いているかは、
 * 呼び出し形を見るより、対象外の行が無傷であることを確かめるほうが確実。
 *
 * 発行されたクエリは `calls` に記録されるので、検索順序の検証にも使える。
 */

export type Row = Record<string, unknown>;

type Op = "select" | "insert" | "update" | "upsert";

export interface RecordedCall {
  table: string;
  op: Op;
  filters: Array<{ op: "eq" | "is"; column: string; value: unknown }>;
}

export interface FakeSupabase {
  from: (table: string) => QueryBuilder;
  /** 行データ本体。テストから直接参照して状態を検証できる。 */
  tables: Record<string, Row[]>;
  calls: RecordedCall[];
  auth: {
    admin: {
      inviteUserByEmail: (
        email: string,
        options?: { redirectTo?: string; data?: Row },
      ) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
    };
  };
}

interface QueryBuilder {
  select: (columns?: string) => QueryBuilder;
  insert: (payload: Row | Row[]) => QueryBuilder;
  update: (payload: Row) => QueryBuilder;
  upsert: (
    payload: Row | Row[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  is: (column: string, value: unknown) => QueryBuilder;
  order: (column?: string, opts?: unknown) => QueryBuilder;
  limit: (n: number) => QueryBuilder;
  maybeSingle: () => Promise<{ data: Row | null; error: null }>;
  then: (
    onfulfilled: (v: { data: Row[]; error: null }) => unknown,
  ) => Promise<unknown>;
}

function matches(row: Row, filters: RecordedCall["filters"]): boolean {
  return filters.every((f) => {
    const actual = row[f.column];
    if (f.op === "is") {
      // .is(col, null) は SQL の IS NULL 相当。undefined も未設定として扱う。
      return f.value === null ? actual == null : actual === f.value;
    }
    return actual === f.value;
  });
}

export interface FakeSupabaseOptions {
  /** inviteUserByEmail が返す認証ユーザーID。null ならエラー扱い。 */
  invitedUserId?: string | null;
  inviteError?: string | null;
}

export function createFakeSupabase(
  initialTables: Record<string, Row[]>,
  options: FakeSupabaseOptions = {},
): FakeSupabase {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initialTables)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  const calls: RecordedCall[] = [];
  const inviteCalls: Array<{ email: string; options?: { redirectTo?: string; data?: Row } }> = [];

  function from(table: string): QueryBuilder {
    const call: RecordedCall = { table, op: "select", filters: [] };
    calls.push(call);

    let payload: Row[] = [];
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};

    function rowsOf(): Row[] {
      if (!tables[table]) tables[table] = [];
      return tables[table];
    }

    function execute(): Row[] {
      const store = rowsOf();

      if (call.op === "insert") {
        store.push(...payload.map((p) => ({ ...p })));
        return payload;
      }

      if (call.op === "upsert") {
        const key = upsertOpts.onConflict ?? "id";
        const written: Row[] = [];
        for (const p of payload) {
          const existing = store.find((r) => r[key] === p[key]);
          if (existing) {
            // ignoreDuplicates: true は「既存行があれば何もしない」。
            // 本番で client_id が NULL のまま残った原因がこの挙動だった。
            if (!upsertOpts.ignoreDuplicates) Object.assign(existing, p);
            written.push(existing);
          } else {
            const created = { ...p };
            store.push(created);
            written.push(created);
          }
        }
        return written;
      }

      const hit = store.filter((r) => matches(r, call.filters));

      if (call.op === "update") {
        for (const r of hit) Object.assign(r, payload[0] ?? {});
      }

      return hit;
    }

    const builder: QueryBuilder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (p) => {
        call.op = "insert";
        payload = Array.isArray(p) ? p : [p];
        return builder;
      },
      update: (p) => {
        call.op = "update";
        payload = [p];
        return builder;
      },
      upsert: (p, opts) => {
        call.op = "upsert";
        payload = Array.isArray(p) ? p : [p];
        upsertOpts = opts ?? {};
        return builder;
      },
      eq: (column, value) => {
        call.filters.push({ op: "eq", column, value });
        return builder;
      },
      is: (column, value) => {
        call.filters.push({ op: "is", column, value });
        return builder;
      },
      maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
      then: (onfulfilled) =>
        Promise.resolve(onfulfilled({ data: execute(), error: null })),
    };

    return builder;
  }

  return {
    from,
    tables,
    calls,
    auth: {
      admin: {
        inviteUserByEmail: async (email, opts) => {
          inviteCalls.push({ email, options: opts });
          if (options.invitedUserId === null) {
            return {
              data: { user: null },
              error: { message: options.inviteError ?? "invite failed" },
            };
          }
          return {
            data: { user: { id: options.invitedUserId ?? "invited-user-id" } },
            error: null,
          };
        },
      },
    },
    // テストから招待呼び出しの引数を検証できるようにする
    ...({ inviteCalls } as object),
  } as FakeSupabase & { inviteCalls: typeof inviteCalls };
}
