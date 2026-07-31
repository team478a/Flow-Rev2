# アーカイブされたmigrationファイル

このディレクトリのファイルは、`../SUPABASE_SETUP.md` の手順が**参照していない**、かつ
`0002_products.sql`/`0003_landing_pages.sql`/`0006_customers.sql`/`0005_scenarios.sql`/
`0007_members.sql` と同じテーブルを重複定義しており、両方を同じSupabaseプロジェクトに
適用すると「relation already exists」エラーになるか、RLSが不十分な版のテーブルが先に
作られてしまう危険がありました（`docs/audit/04_DATABASE_AND_AUTH.md`、
`docs/audit/05_SECURITY_FINDINGS.md` M-1参照）。

実行されないよう `.sql` 拡張子を外し `.unused` を付けてここに退避しています。
**このディレクトリのファイルは実行しないでください。** 参照用の記録として保持しています。

| ファイル | 重複していた内容 |
|---|---|
| `0002_content.sql.unused` | `products` / `landing_pages` / `form_submissions` / `customers` / `purchases` |
| `0003_members_scenarios.sql.unused` | `courses` / `lessons` / `lesson_progress` / `follow_scenarios` / `scenario_steps` / `scenario_logs` |

正しいセットアップ手順は `../../SUPABASE_SETUP.md` を参照してください。
