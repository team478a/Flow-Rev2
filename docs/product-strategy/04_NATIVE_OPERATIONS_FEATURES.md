# ネイティブ運営機能（Onbizu/CommitRev代替の自社実装）

Onbizu・CommitRevが担おうとしていた「顧客の行動を捉え、未行動者をフォローし、目標達成を伴走する」という概念を、FlowRev内部にネイティブ機能として実装する方針を示す。

**旧ブランチ`feature/phase-1-activity-events-foundation`との関係**: このブランチの`docs/product/`配下5文書（`FLOWREV_NATIVE_OPERATIONS_CONCEPT.md`/`ACTIVITY_EVENT_CATALOG.md`/`ONBOARDING_AND_FOLLOWUP_MVP.md`/`COMMITMENT_MANAGEMENT_MVP.md`/`PHASE_1_IMPLEMENTATION_PLAN.md`）は、本章より詳細な技術設計（テーブルDDL・RLSポリシー文・記録サービスのコード方針・既存コード調査で判明した具体的な制約）を先行して作成していた。本章はその内容（DDL要旨・イベント種別・既存コード調査の要点・設計原則）を確認のうえ本章および`06_DATA_MODEL_PLAN.md`に統合し、`docs/product-strategy`の文書体系に位置づけ直したものである。**今後の設計判断はこの`docs/product-strategy/`配下を正とする。** 旧ブランチはコードとしては未実装のまま削除せず保持するが（`09`文書参照）、今後の更新対象とはしない。DDLのより詳細な記述（インデックス定義等）を確認したい場合の参照先としてのみ有効とする。

**Phase番号の対応**: 旧ブランチは機能ごとにPhase A〜Eの符番を用いている（A=行動イベント、B=未行動者検知、C=オンボーディング、D=フォロー自動化、E=コミットメント管理）。本文書セットの`07_IMPLEMENTATION_ROADMAP.md`はPhase 0〜9の通し番号を用いており、Phase 6が旧Phase A、Phase 7が旧Phase B・C・Dをまとめたもの、Phase 8が旧Phase Eに相当する（`07`文書内に対応表を記載）。**AI運営アシスタントのみ旧ブランチに独立Phaseの記載がなく、本文書セットでPhase 9として新たに位置づけた。**

## 1. 行動イベント（Activity Events）

- **目的**: 顧客の行動（登録、ログイン、購入、講座開始、レッスン視聴、レッスン完了、決済失敗、メール/LINE送信等）を単一のイベントストリームとして横断的に記録し、他の運営機能（未行動検知・オンボーディング進捗・フォロー自動化・AI運営アシスタント）が共通して依存できる基盤データとする。
- **主な利用者**: システム内部（他機能から参照）。直接の閲覧者はclient_owner（顧客ごとの行動履歴として）、white_label_owner（配下集計）。
- **MVPスコープ**: `docs/product/ACTIVITY_EVENT_CATALOG.md`で定義済みの11イベント種別のうち、既存コードパスへ1行追加するだけで実現できる4種（`customer_registered`/`purchase_completed`/`lesson_completed`/`email_sent`・`line_sent`）を優先実装する。`first_login`/`course_started`/`lesson_viewed`/`payment_failed`は新規の記録メカニズムが必要なため優先度を下げる。`assignment_submitted`（課題機能自体が未実装のためブロック）と`email_opened`（Resend側のWebhook連携が別途必要）はPhase 6のスコープ外とする。既存の`customers.last_action_at`（死んだ列）はこの実装後に置き換える。
- **必要データ**: `activity_events(id, white_label_id, client_id, customer_id, event_type, event_source, payload, occurred_at, created_at)`。RLSは既存の`get_user_role()`等ヘルパー関数を再利用し、書き込みは`follow_scenarios`等の既存パターンと同じくservice-role（`createAdminClient()`）経由のみに限定する。記録処理は必ずベストエフォート（失敗しても主処理を止めない）で実装する。
- **既存機能との接続**: `lesson_progress`（視聴完了のみ記録）はイベントの一種として統合可能。将来的に`lesson_progress`のUPDATE時に`activity_events`へも記録する。
- **既存コード調査で判明した制約**（`docs/product/FLOWREV_NATIVE_OPERATIONS_CONCEPT.md`5章・`ACTIVITY_EVENT_CATALOG.md`4章より）:
  - ログイン処理（`features/auth/actions.ts`の`login()`）は顧客・スタッフ共通で、ログイン日時を記録する仕組みが一切ない。`first_login`実装にはスタッフのログインを誤って記録しないよう`role === 'customer'`の分岐が必要。
  - 会員サイトのレッスン視聴には「開始」状態が存在しない（完了時のみ記録）。`course_started`/`lesson_viewed`の実装には重複記録防止の冪等性チェックが必要で、他イベントより実装コストが高い。
  - Stripe Webhookは`checkout.session.completed`のみ処理しており、決済失敗・期限切れイベントを扱っていない。`payment_failed`記録にはWebhookハンドラの拡張が必要。
  - 課題（assignment）機能はコードベースに存在しないため、`assignment_submitted`は実装不可（課題機能自体の実装まで対象外）。
- **将来拡張**: イベントベースのセグメンテーション、AI運営アシスタントへの入力。
- **OEM対応**: `client_id`/`white_label_id`をレコードに最初から持たせ、RLSで階層フィルタする。

## 2. オンボーディング

- **目的**: 購入直後の顧客が迷わず最初のアクションを取れるよう、ステップ形式の初回フローとその進捗を管理する。単なる「歓迎メール1通」ではなく、複数ステップの完了状況を追跡できることを目標とする。
- **主な利用者**: customer（体験する側）、client_owner（テンプレート設計・進捗確認）。
- **MVPスコープ**: 商品（`product_id`、NULL可＝全商品共通）ごとにオンボーディングテンプレートを作成し、ステップごとに`manual_check`（顧客/運営者の手動チェック）または`event_based`（`activity_events`の特定イベント発生で自動完了）のいずれかの完了条件を設定する。ステップには任意の猶予日数（`due_days`）を設定でき、超過は未行動検知（3章）・フォロー自動化（5章）のトリガーに接続する。
- **必要データ**: 新規`onboarding_templates`（`white_label_id`/`client_id`/`product_id`/`name`/`status`）、`onboarding_steps`（`template_id`/`step_number`/`title`/`completion_type`/`completion_event`/`due_days`）、`onboarding_progress`（`customer_id`/`template_id`/`step_id`/`status`/`started_at`/`completed_at`）の3テーブル。既存の`follow_scenarios`→`scenario_steps`と同じ「親経由でテナントを辿る」設計に揃える。
- **既存機能との接続**: `event_based`ステップは`activity_events`（1章）の発生をトリガーに自動完了する。期限超過は`follow_scenarios.trigger_type='onboarding_step_overdue'`（5章）としてフォロー自動化に接続する。
- **将来拡張**: 進捗連動の分岐オンボーディング。
- **OEM対応**: `onboarding_templates`が`white_label_id`/`client_id`を直接持つため、`follow_scenarios`と同じ粒度でテナント分離できる。

## 3. 未行動検知（Inactivity Detection）

- **目的**: 一定期間行動のない顧客・対応が必要な状態を検知し、運営者に提示する。
- **主な利用者**: client_owner（対応する側）。
- **MVPスコープ**: 固定ルールベースで検知する（ビジュアルなルールビルダーは作らない）。想定する固定ルールは「購入後24時間ログインなし」「購入後3日講座未開始」「7日間アクセスなし」「決済失敗」の4種（いずれも`activity_events`が揃えば判定可能）。「課題期限超過」は課題機能自体が存在しないため対象外。既存の`app/api/admin/cron/check-unprotected-videos/route.ts`と同様の構造（Bearer認証によるCronエンドポイント、Vercel Cronから定期起動）で実装することを想定する。
- **必要データ**: 新規`inactivity_flags`（`white_label_id`/`client_id`/`customer_id`/`rule_key`/`detected_at`/`resolved_at`）。`activity_events`（1章）を読むだけで判定でき、`activity_events`自体には手を入れない。顧客が該当行動を取った場合は`resolved_at`をセットし、対応する未送信のフォロー（5章）をキャンセルする。
- **既存機能との接続**: 検知結果を`follow_scenarios`の新しいトリガー種別（`trigger_type='inactivity'`）として発火できるようにする。既存の顧客一覧（`app/(dashboard)/customers/page.tsx`）にある「7日間未行動」フィルタ（`last_action_at`ベース、現状機能していない）を`inactivity_flags`ベースに置き換えて一本化する。
- **将来拡張**: 未行動理由の推定（AI）。
- **OEM対応**: クエリ・レコードともテナントIDでスコープする。

## 4. コミットメント管理

- **目的**: 顧客が設定した目標・約束事の進捗を週次で追跡し、達成を後押しする。
- **主な利用者**: customer（自身の目標設定・週次チェックイン）、client_owner（進捗確認・声かけ）。
- **MVPスコープ**: `docs/product/COMMITMENT_MANAGEMENT_MVP.md`の設計を土台とする。顧客が目標を1件登録し、週次で「今週の行動」を自己申告、client_ownerがコメントを返す最小フロー。
- **必要データ**: 新規`commitments`（`white_label_id`/`client_id`/`customer_id`/`goal_text`/`due_date`/`status`）、`commitment_checkins`（`commitment_id`/`week_start`/`action_text`/`self_rating`/`operator_comment`/`commented_by`/`ai_suggestion`）。
- **既存機能との接続**: 週次チェックイン未提出を未行動検知（3章）と同様の仕組みでフォロー自動化のトリガーに使う。AI提案（`ai_suggestion`）は既存の`lib/ai/client.ts`を使うが、`operator_comment`への反映は必ずclient_ownerの確認・編集を経る（AI無承認自動送信の禁止原則、`00`章8節）。
- **将来拡張**: 複数目標、マイルストーン分割、達成予測。
- **OEM対応**: `commitments`が階層列を最初から持つ。`white_label_owner`は参照のみ（他機能と同じ「参照のみ」パターン）とし、コメントは`client_owner`の権限とする。

## 5. 購入後フォロー自動化

- **目的**: 未行動検知・オンボーディング遅延・コミットメント未達成等をトリガーに、自動でフォローメッセージを送る、または運営者に対応を促す。
- **主な利用者**: client_owner（ルール設計）、customer（受け取る側）。
- **MVPスコープ**: 新規エンジンは作らず、既存の`follow_scenarios`/`scenario_steps`/`scenario_logs`（`trigger_type`＋`delay_days`＋`channel`という汎用構造を既に持つ）を拡張する。既存のZodスキーマには`'no_action'`/`'course_complete'`という未使用の`trigger_type`値が既にUI選択肢として存在するが、実際に発火させるコードは`'purchase'`にしか実装されていない（`lib/repositories/scenario-execution.ts`の`enqueuePurchaseScenarios`のみ）。ここに`'inactivity'`（3章）・`'onboarding_step_overdue'`（2章）を追加実装し、既存の空きトリガーを実際に機能させる。
- **必要データ**: 既存テーブルの拡張（ALTER）で対応する。具体的には`scenario_steps.trigger_type`の許容値追加、`scenario_steps.channel`への`'admin_task'`追加（顧客への自動送信ではなく運営者への社内タスク化）、`scenario_logs.status`への`'cancelled'`追加（未行動が解決した際、送信待ちのフォローを取り消す）。新規テーブルの要否（`admin_tasks`を独立テーブルにするか`scenario_logs`を流用するか）は実装時に決定する。
- **既存機能との接続**: 実行エンジン自体（`app/api/admin/scenarios/execute/route.ts`）はメール・LINE両チャネルの送信ロジックを既に実装済みであり、自動トリガー（Cron）が存在しないことが唯一の未解決課題（Phase 0監査で既出）。定期実行はVercel Cronで追加する。**この変更は実際に顧客への自動送信が始まる運用変更を伴うため、着手前に別途運用者の承認を得る**（PR #1最終確認時に踏襲した方針と同様）。
- **将来拡張**: ビジュアルな条件分岐ビルダー（今回は明示的に後回し）。
- **OEM対応**: 既存の`client_id`スコープをそのまま利用。将来的にOEM機能制御でフォロー自動化の利用可否・段数上限をプラン制御する。

## 6. AI運営アシスタント

- **目的**: 未行動者・優先対応者・解約リスクをAIが要約し、運営者の「今日何をすべきか」を提示する。
- **主な利用者**: client_owner（主）、white_label_owner（配下クライアントの俯瞰、将来）。
- **MVPスコープ**: 1〜4章のデータ（行動イベント・未行動検知結果・オンボーディング進捗・コミットメント状況）を要約し、ダッシュボードにテキストで提示する読み取り専用機能。**提案の自動送信は行わない**（`00`章8節の原則）。既存のAI文章生成ボタン（`features/ai/components/ai-generate-button.tsx`）と同じ「生成→人間が確認・編集→保存」のUXパターンを踏襲する。
- **必要データ**: 既存のAI生成基盤（`lib/repositories/ai-settings.ts`等）を流用。新規テーブルは不要見込み。
- **既存機能との接続**: AI利用量計測（`02`文書13章）と接続し、将来のOEMコスト管理に使う。
- **将来拡張**: 提案→承認→自動送信のワークフロー化。
- **OEM対応**: AI設定解決を3階層フォールバック（`02`文書7章）に統一した上で、テナント単位の利用量を計測する。

## まとめ

上記6機能のうち、**行動イベント・未行動検知・オンボーディング・コミットメント管理は新規テーブルが必要**（それぞれ独立したテーブル群を持つ）、**フォロー自動化は既存の`follow_scenarios`系テーブルのALTER（新規テーブルは最小限）で対応可能**、**AI運営アシスタントは新規テーブル不要**、という整理になる。行動イベント（1章）を最初に実装し、未行動検知・オンボーディング・コミットメント管理はいずれも行動イベントを読むだけで動作する設計にすることで、依存関係を一方向（既存機能→行動イベント→新機能群）に保つ。
