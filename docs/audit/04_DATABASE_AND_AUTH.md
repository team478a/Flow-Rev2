# 04. データベース・認証調査

## 前提: 2つの並行DB層

- `lib/db`（Drizzle ORM + drizzle-kit）: `src/schema/index.ts`は空のスキャフォールド（`export {}`のみ）で、**実プロダクトはこれを一切使用していない**。
- `artifacts/flowrev/supabase/migrations/*.sql`: **実際に使われているスキーマ**。以降はすべてこちらを対象とする。

## DB構成（テーブル一覧・要約）

| テーブル | テナント/所有カラム | 主な外部キー |
|---|---|---|
| `plans` | `white_label_id`（**`prod_setup.sql`にのみ存在、個別migrationには無い**） | → `white_labels` |
| `white_labels` | — | `owner_user_id`→auth.users, `plan_id`→plans |
| `clients` | `white_label_id` | `owner_user_id`→auth.users |
| `user_profiles` | `white_label_id`, `client_id`, `role` | id = auth.users.id |
| `invitations` | `white_label_id` | `invited_by`→auth.users |
| `ai_provider_settings` / `email_settings` | `white_label_id`（NULL=HQ） | — |
| `products` / `landing_pages` / `form_submissions` | `white_label_id`, `client_id` | — |
| `customers` | `white_label_id`, `client_id`, `user_id` | UNIQUE(client_id, email) |
| `purchases` | `white_label_id`, `client_id` | customer_id, product_id |
| `courses` / `lessons` / `lesson_progress` | `white_label_id`, `client_id`/`customer_id` | — |
| `follow_scenarios` / `scenario_steps` / `scenario_logs` | `white_label_id` | — |
| `payment_providers` / `stripe_accounts` / `bank_transfer_settings` / `payment_logs` | `white_label_id`, `client_id` | — |
| `rate_limits` | — | UNIQUE(key)。**定義のみで未使用（05参照）** |
| `line_accounts` | `client_id`（UNIQUE）, `white_label_id` | — |
| `cloudflare_settings`ほか | — (system_admin専用) | — |
| `public_landing_pages`（VIEW） | なし（意図的に`client_id`等を除外） | — |

全テーブルが`white_labels`→`clients`→子テーブルへ`ON DELETE CASCADE`で連鎖しており、代理店・クライアント削除は配下データを一括物理削除する設計。

## migration管理の現状

**Drizzle migrationsでもSupabase migrationsでもなく、「手作業でSupabaseダッシュボードのSQL Editorに順番に貼り付けて実行する」運用**（`artifacts/flowrev/SUPABASE_SETUP.md`に16ステップの手順書がある）。加えて`artifacts/flowrev/supabase/prod_setup.sql`という929行の一括投入用スクリプトも別途存在する。

### 見つかった問題点

1. **重複・矛盾するmigrationファイルがリポジトリに残存**:
   - `0002_content.sql` と `0002_products.sql` — 同じ`products`/`landing_pages`/`customers`等を重複定義。セットアップ手順書は`0002_products.sql`側しか参照していない。
   - `0003_members_scenarios.sql` と `0007_members.sql`/`0005_scenarios.sql` — 同様に重複。
   - 手順書の順序を無視して番号順にすべて実行すると「テーブルが既に存在する」エラーになるか、RLSが緩い版のテーブルが先に作られてしまう危険がある。
2. **個別ファイルと`prod_setup.sql`の間でスキーマドリフトが発生している**: `plans.white_label_id`カラムは`prod_setup.sql`にしか存在せず、`0001_core_tenant.sql`単体では作られない。しかしアプリコード（`lib/repositories/plans.ts`の代理店向けプラン機能）はこのカラムの存在を前提にしている。手順書通りに個別ファイルだけを適用すると、代理店プラン機能が実行時エラーになる。
3. **RLSポリシーも同様にドリフトしている**: `plans`テーブルのRLSポリシーは`prod_setup.sql`にしか定義がなく、単体の`0007_rls_policies.sql`には一切ない。
4. マイグレーション履歴を記録するテーブル（`_migrations`等）が存在せず、「どのSQLがどの環境に適用済みか」を追跡する仕組みがない。ロールバック用のdownスクリプトも無い。

**結論**: 今後はDrizzle migrationsかSupabase CLIのmigrationsのどちらかに一本化すべき。現状の「SQLファイルを手でコピペ」運用は、Phase 0時点で既に矛盾ファイルによる事故が起きうる状態にある。

## Supabase Auth・鍵の分離

- ブラウザ用クライアント（anon key）: `lib/supabase/client.ts`
- サーバー用クライアント（anon key、RLS適用、Cookie連携）: `lib/supabase/server.ts`
- 管理用クライアント（**service_role key、RLSバイパス**）: `lib/supabase/admin.ts` — `"server-only"`でガードされており、クライアントコンポーネントからimportすればビルドエラーになる。
- **grep調査の結果、`SUPABASE_SERVICE_ROLE_KEY`はサーバー専用の2ファイルでしか参照されておらず、クライアントサイドへの露出は確認されなかった。**

## RLS（Row Level Security）

**「RLSがない」という典型的なマルチテナントSaaSの失敗パターンには当てはまらない。** `plans, white_labels, clients, user_profiles, invitations, products, landing_pages, customers, purchases, courses, lessons, ...`など主要テーブルほぼ全てで有効化されており（`0006_rls_functions.sql`）、`get_user_role()`/`get_user_client_id()`/`get_user_white_label_id()`という`SECURITY DEFINER`ヘルパー関数を軸に、`USING`と`WITH CHECK`双方でテナントID・ロールのなりすましを防ぐポリシーが`0007_rls_policies.sql`に397行にわたって定義されている（本監査で内容を直接確認済み）。`user_profiles`の更新ポリシーは、本人であっても`role`/`white_label_id`/`client_id`の書き換えを禁止する権限昇格対策も入っている。

### RLSの穴（要修正）

- `ai_provider_settings`: ポリシー名は「system_admin」だが実際の条件は`USING (TRUE) WITH CHECK (TRUE)`——**ロールチェックが一切なく、誰でも読み書き可能な状態**（`0008_ai_rls.sql`）。現状はアプリが常にservice_roleクライアント経由でしかこのテーブルに触れないため実害はないが、将来anonキー経由のコードパスが追加された瞬間に危険な穴になる。
- `email_settings`: RLS有効化のみでポリシーが1つも無い（deny-allなので安全側だが、意図的なのか漏れなのか不明で一貫性がない）。
- `stripe_accounts`/`payment_logs`: 同様にservice_roleバイパスのみで、`client_owner`向けの読み取りポリシーは`0010_stripe_payments.sql`という後発ファイルでようやく追加されている（手順書の順序次第では未適用のまま運用される可能性）。
- **アプリの大部分（`lib/repositories/*.ts`）はservice_roleクライアント経由でDBにアクセスしており、その場合RLSは完全にバイパスされる。** テナント分離はコード側の`.eq("client_id", ...)`フィルタだけに依存する。ほとんどの箇所は正しくフィルタされているが、`courses-public.ts`のコメントには「RLSがcustomerロール未対応のため、admin clientでclientIdフィルタする」と明記されており、これはRLSに頼らずアプリ側フィルタのみに依存している具体例。

## 認証・権限・テナント分離

- 単一の`auth.users`（Supabase Auth）+ `user_profiles.role`（4階層: `system_admin` / `white_label_owner` / `client_owner` / `customer`）。
- サインアップ時のロール付与はPostgresトリガー（`0008_user_trigger.sql`）でホワイトリスト制御されており、クライアントが`system_admin`を自称しても`customer`に強制的に落とされる。`system_admin`はDB直接操作でしか付与できない。
- ルートレベルの権限分離は`middleware.ts`が担うが、**`/api/admin/*`は`/admin`から始まらないため、このミドルウェアのガード対象外**。個々のRoute Handlerが自前でロールチェックする必要があり、実際に1箇所チェック漏れがある（05のCritical参照）。

## 削除済み顧客の再登録・同一メールアドレスの扱い

- `customers`の削除は**物理削除**（ソフトデリートカラムなし）。同一クライアント内での再登録は、`UNIQUE(client_id, email)`制約が削除により解放されるため単純な再INSERTとして成立する。
- `customers.email`はテナント（`client_id`）ごとに一意で、**グローバルには一意ではない**（同じメールアドレスが複数の異なるクライアントの顧客として存在しうる、これは仕様として妥当）。
- 一方`auth.users.email`はSupabase Authの制約でグローバルに一意。このため、**招待の受諾フロー（`accept-actions.ts`）で「既に存在するメールアドレスへの招待」を処理する際、既存のauth.usersレコードを再利用し、その`user_profiles`のrole/テナントIDを新しい招待の内容で上書きしてしまう**実装になっている。これは「本当に削除されたユーザーの再招待」と「既に別テナントで有効なアカウントを持つ人物への誤招待・悪用目的の招待」を区別しておらず、後者の場合は既存アカウントの役割・所属が意図せず書き換わる。中程度のリスクとして`05_SECURITY_FINDINGS.md`にも計上する。

## 推奨改善（優先順）

1. `SUPABASE_SETUP.md`の手順書と矛盾する`0002_content.sql`/`0003_members_scenarios.sql`を削除するか、明確に「未使用・アーカイブ」と分かるようにリネーム/移動する。
2. `plans`関連のスキーマ・RLSポリズドリフト（`prod_setup.sql`にしかない部分）を個別migrationファイル側に統合する。
3. `ai_provider_settings`のRLSポリシーに正しいロール条件を追加する。
4. Drizzle migrationsまたはSupabase CLI migrationsのいずれかに一本化し、マイグレーション履歴を追跡可能にする。
5. 招待受諾フローで、既存メールアドレスが「削除済みの同一テナント関係者」であることを確認してから再利用する（無条件の役割上書きをやめる）。
