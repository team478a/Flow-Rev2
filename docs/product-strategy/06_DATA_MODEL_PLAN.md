# データモデル計画

指示書14章で列挙された候補テーブル群を中心に、既存活用（reuse-existing）／新規追加（new-needed）／統合すべき（should-merge）に分類する。**これは実装計画ではなく、対象の仕分けである**。実際の実装順序は`07_IMPLEMENTATION_ROADMAP.md`で扱う。

## 1. 分類一覧

| テーブル | 分類 | 備考 |
|---|---|---|
| `white_labels` | reuse-existing | OEM事業者本体。ブランド関連列の拡充のみ行う（新規テーブル化しない） |
| `clients` | reuse-existing | クライアント事業者本体。変更不要（既存の`plan_id`等で足りる） |
| `user_profiles` | reuse-existing | 4階層ロールの本体。変更不要 |
| `plans` | reuse-existing | `features` JSONB列は残すが、機能制御の中核は`plan_features`（新規）に移行し、`plans.features`は将来的に非推奨とする方向で検討（今回は削除しない） |
| `customers` | reuse-existing | 変更不要。ただし`last_action_at`は下記の通りshould-merge対象 |
| `products` | reuse-existing | 変更不要 |
| `landing_pages` | reuse-existing | テンプレート配布機能（WL→クライアント複製）を追加する際は`source_id`列の追加を検討するが、今回のロードマップでは着手しない |
| `follow_scenarios` / `scenario_steps` / `scenario_logs` | reuse-existing | `trigger_type`の許容値拡張のみ行う。テーブル構造自体の作り直しはしない |
| `lesson_progress` | reuse-existing | 変更不要。将来`activity_events`と連携する際も列追加は最小限にする想定 |
| `rate_limits` | reuse-existing（用途限定） | レート制限専用として維持する。利用量管理（累積計測）とは明確に別物であり、統合しない |
| `ai_settings` / `email_settings` / `line_settings` / `stripe_settings` / `cloudflare_settings` | reuse-existing | テーブル構造は概ね維持しつつ、読み取りロジック（3階層フォールバック）を統一する。`cloudflare_settings`のみテナント列の追加要否を実装時に確認する |
| `activity_events` | new-needed | 行動イベント記録。`white_label_id`/`client_id`/`customer_id`/`event_type`/`event_source`/`payload`/`occurred_at`/`created_at`。詳細スキーマ・RLS方針・イベント種別カタログは`docs/product/ACTIVITY_EVENT_CATALOG.md`（旧ブランチ`feature/phase-1-activity-events-foundation`）の設計をそのまま採用する（`04`文書1章参照） |
| `inactivity_flags` | new-needed | 未行動者検知の結果保持。`white_label_id`/`client_id`/`customer_id`/`rule_key`/`detected_at`/`resolved_at`。`activity_events`を読むだけで判定でき、`activity_events`自体には手を入れない（`04`文書3章） |
| `onboarding_templates` / `onboarding_steps` / `onboarding_progress` | new-needed | オンボーディング管理。`onboarding_templates`が`white_label_id`/`client_id`/`product_id`を持ち、`onboarding_steps`/`onboarding_progress`はテンプレート/ステップ経由でテナントを辿る（`follow_scenarios`→`scenario_steps`と同じ辿り方）。ステップは`manual_check`/`event_based`（`activity_events`と連携）の2種の完了条件を持つ（`04`文書2章） |
| `commitments` | new-needed | コミットメント管理。`white_label_id`/`client_id`/`customer_id`/`goal_text`/`due_date`/`status` |
| `commitment_checkins` | new-needed | コミットメントの週次チェックイン。`commitment_id`経由でテナントを辿る。`action_text`/`self_rating`/`operator_comment`/`ai_suggestion`（AIは下書き提案のみ、`operator_comment`への反映は必ず運営者の確認・編集を経る） |
| `feature_definitions` | new-needed | 機能キーのマスタ定義（本部管理） |
| `plan_features` | new-needed | プラン単位の機能割当（HQプラン・WLプラン共通） |
| `white_label_features` | new-needed | OEM事業者単位の機能上書き（HQ許可範囲内） |
| `client_features` | new-needed | クライアント事業者単位の機能上書き（WL許可範囲内） |
| `usage_records`（仮称） | new-needed | 利用量の累積計測（AI生成・メール送信・LINE送信・ストレージ等）。集計テーブルまたはイベント型テーブルのどちらにするかは実装時に決定 |
| `audit_logs` | new-needed | 運営者操作の監査ログ（actor_id, tenant scope, action, target, occurred_at） |
| `scenario_logs.status`への`'cancelled'`追加、`scenario_steps.channel`への`'admin_task'`追加 | new-needed（既存テーブルの拡張） | 新規テーブルではなく既存`follow_scenarios`系テーブルのALTER。未行動が解決した際の送信取り消し、および「運営者への社内タスク化」ステップに対応する（`04`文書5章） |

## 2. should-mergeの詳細

| 対象 | 統合方針 |
|---|---|
| `customers.last_action_at` | `activity_events`実装後、この列への直接書き込みをやめ、`activity_events`から最新行動日時を導出する（ビューまたはクエリ）。列自体は後方互換のため即削除はせず、移行完了後に削除候補として`08`/`09`文書で扱う |
| `plans.features`（JSONB） | 短期的には残すが、`plan_features`（新規キー方式）が整備され次第、読み取り経路を`plan_features`に一本化する。列削除は今回のロードマップでは行わない |

## 3. 機能キー方式のテーブル関係（指示書9.4節対応）

```text
feature_definitions（本部が定義する機能キーのマスタ）
        │
        ▼
   plan_features（プラン単位のデフォルト割当）
        │
        ▼
white_label_features（OEM単位の上書き、HQ許可範囲内にクランプ）
        │
        ▼
   client_features（クライアント単位の上書き、WL許可範囲内にクランプ）
```

大量のboolean列を`white_labels`/`clients`に追加する方式は採らない（指示書で明示的に禁止）。機能の有効判定は「該当テナントに最も近い階層の設定を優先し、未設定なら上位階層にフォールバックする」ロジックで統一する。これは`02`文書7章で述べた設定解決パターン（メール設定と同型）と揃える。

## 4. 「全部一度に実装する計画ではない」という明記

上記new-needed群を一度のフェーズで全て実装することは意図していない。`07_IMPLEMENTATION_ROADMAP.md`で段階分けし、`08_PHASE_1_DETAILED_PLAN.md`で最初のフェーズに含める範囲のみを具体化する。行動イベント・未行動検知・オンボーディング・コミットメント管理関連のテーブル（本章2段落目）は、旧ブランチ`feature/phase-1-activity-events-foundation`の`docs/product/`で先行して技術設計されていた内容を本文書へ統合したものである。今後の設計判断は本`docs/product-strategy/`配下を正とし、旧ブランチは削除せず保持するが更新対象にはしない。SQL DDLの詳細な記述（インデックス定義等）を確認したい場合のみ、旧ブランチを参照する。
