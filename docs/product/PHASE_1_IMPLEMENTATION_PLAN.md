# Phase 1 実装計画：行動イベント基盤（Activity Event Foundation）

対象ブランチ: `feature/phase-1-activity-events-foundation`

**本ドキュメントの「Phase 1」は、製品ロードマップ上の Phase A（行動イベント基盤）を指す。** Phase B〜E（未行動者検知・オンボーディング・フォロー自動化・コミットメント管理）は`ONBOARDING_AND_FOLLOWUP_MVP.md`・`COMMITMENT_MANAGEMENT_MVP.md`に設計のみ記載しており、本計画のスコープには含まない。

本ドキュメント作成時点ではコードは一切実装していない（「最初の成果物として、コード実装前に」という指示に基づき設計ドキュメントのみを作成）。以下は次の実装セッションに向けたタスク分解である。

## 1. 目的

顧客のあらゆる行動を単一の`activity_events`テーブルに記録できるようにし、Phase B以降（未行動者検知・オンボーディング・分析）が依存できる土台を作る。既存の`customers.last_action_at`（現在どこからも書き込まれていないデッドコード、`FLOWREV_NATIVE_OPERATIONS_CONCEPT.md`5章参照）が象徴する「行動データが記録されていない」という既存の欠落を解消する。

## 2. 作業内容（タスク分解）

### 2.1 DBマイグレーション

- `0015_activity_events.sql`: `activity_events`テーブル、インデックス、RLSポリシーを追加（`ACTIVITY_EVENT_CATALOG.md`1章の内容そのまま）。`supabase/prod_setup.sql`にも同時に反映する（本セッションのPR #1で確立した「個別migrationファイルとprod_setup.sqlを両方更新する」運用を踏襲）。
- `SUPABASE_SETUP.md`にStep 21として追記する。

### 2.2 イベント記録サービス

- `lib/activity-events/record-event.ts`: `recordActivityEvent()`関数（`ACTIVITY_EVENT_CATALOG.md`3章の設計通り）。
- `lib/activity-events/event-types.ts`: イベント種別の型定義（`ActivityEventType`）。

### 2.3 既存記録ポイントへの追加（低リスク・優先度高）

以下は既存のコードパスに1行追加するだけで実現できるため、最初に着手する。

| イベント | 変更対象ファイル |
|---|---|
| `customer_registered` | `features/customers/actions.ts`, `app/api/p/register/route.ts` |
| `purchase_completed` | `app/api/webhooks/stripe/route.ts` |
| `lesson_completed` | `app/api/my/progress/route.ts` |
| `email_sent` / `line_sent` | `lib/repositories/scenario-execution.ts`（`markLogSent()`呼び出し元、`app/api/admin/scenarios/execute/route.ts`） |

### 2.4 新規記録メカニズムが必要なもの（優先度中、個別に設計レビューを挟む）

- `first_login`: `user_profiles`または`customers`への`first_login_at`列追加を伴う。ログイン処理（`features/auth/actions.ts`の`login()`）は顧客・スタッフ共通のため、**スタッフのログインではイベントを発火しない**よう`role === 'customer'`の分岐が必要（顧客の行動のみを対象とする設計意図に合わせる）。
- `course_started` / `lesson_viewed`: 冪等性チェック（重複記録防止）の実装方式を個別に設計する（`ACTIVITY_EVENT_CATALOG.md`4.2節）。
- `payment_failed`: `app/api/webhooks/stripe/route.ts`への新規イベントケース追加。Stripe側でどのイベントタイプ（`checkout.session.expired`/`payment_intent.payment_failed`）を購読するかを確定してから実装する。

### 2.5 Phase 1では実装しないもの

- `assignment_submitted`（課題機能が存在しないためブロック）
- `email_opened`（Resend側のWebhook連携が別途必要なため対象外）

## 3. 受入条件（Acceptance Criteria）

- `activity_events`テーブルがマイグレーションで作成され、RLSが有効化され、`client_owner`が自テナントの、`system_admin`が全テナントのイベントを参照できる（他テナントのイベントは参照できない）ことをPreview環境で確認する。
- 2.3節の4イベント種別が、対応する既存操作（顧客登録・購入完了・レッスン完了・シナリオ送信）を行った際に実際に`activity_events`へ記録されることを確認する。
- イベント記録が失敗しても、主処理（顧客登録・購入・レッスン完了等）が失敗しないことを確認する（意図的にDBエラーを起こすテスト、またはコードレビューでの確認）。
- `pnpm --filter @workspace/flowrev run typecheck` / `run build`が通ること。

## 4. リスクと軽減策

| リスク | 軽減策 |
|---|---|
| 高頻度イベント（`lesson_viewed`等）による`activity_events`テーブルの急激な肥大化 | Phase 1では冪等性チェックにより「初回のみ記録」に限定し、閲覧のたびに記録しない設計とする（`ACTIVITY_EVENT_CATALOG.md`4.2節）。将来的なパーティショニング・古いイベントのアーカイブ方針は、実データ量が見えてから別途検討する |
| 既存の主処理へ新しい失敗ポイントを持ち込んでしまう | すべての記録呼び出しをベストエフォート（`.catch(() => {})`または関数内部での例外握りつぶし）にする。コードレビューでこの点を必ず確認する |
| RLSポリシーの設定ミスによるテナント間イベント漏えい | 既存の`get_user_role()`等のヘルパー関数をそのまま再利用し、新規のポリシー条件式を最小限にする。Preview環境で他テナントアカウントから参照できないことを手動確認してからマージする |
| 本PRの`0011`〜`0014`同様、migrationがPreview/本番へ未適用のままコードだけ先行デプロイされると、`activity_events`への書き込みコードが「relation does not exist」で失敗する | 記録処理は必ずベストエフォートにする（上記軽減策と同一）ため、テーブル未作成でもエラーが飲み込まれ主処理には影響しない設計にする。ただし、意図した記録が行われないため、**マイグレーション適用の順序をデプロイ前に必ず確認する**運用は本PR同様に維持する |

## 5. ロールバック方法

- コード: 本Phaseの変更はすべて「新しいテーブルへの追記」＋「既存処理の最後に追加するイベント記録呼び出し」のみで、既存の処理ロジック・戻り値を変更しない。問題が起きた場合は当該コミットをrevertするだけで既存機能への影響なく戻せる。
- DB: `activity_events`テーブルは他のどのテーブルからも参照されない（外部キーの向きは常に`activity_events`→既存テーブルの一方向）ため、`DROP TABLE activity_events;`だけで安全に撤去できる。

## 6. Phase B以降の着手条件

Phase Aの受入条件を満たし、Preview環境で実データによる記録を確認した後、`ONBOARDING_AND_FOLLOWUP_MVP.md`のPhase B（未行動者検知）に進む。Phase D（フォロー自動化の自動実行化）着手前には、`docs/audit/08_NEXT_CODEX_INSTRUCTIONS.md`タスク12と同様、実際に顧客への自動送信が始まる運用変更であるため、着手前に運用者の承認を別途得ること。
