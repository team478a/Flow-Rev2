# オンボーディング・未行動者検知・フォロー自動化 MVP設計

対象: Phase B（未行動者検知MVP）、Phase C（オンボーディング管理）、Phase D（フォロー自動化）。

この3つは密接に連携する（検知結果とオンボーディング進捗の両方が、フォロー自動化のトリガーになる）ため1文書にまとめる。いずれも設計のみで、Phase 1（本ラウンド）の実装対象には含めない。実装順序は`PHASE_1_IMPLEMENTATION_PLAN.md`で扱う。

## 1. Phase B: 未行動者検知MVP

### 1.1 固定ルール

| ルール | 判定条件 | 必要なデータ源 |
|---|---|---|
| 購入後24時間ログインなし | `purchase_completed`イベント発生から24時間以内に、同顧客の`first_login`（またはログインイベント）が存在しない | `activity_events`（Phase A） |
| 購入後3日講座未開始 | `purchase_completed`から3日以内に`course_started`が存在しない | `activity_events`（Phase A、`course_started`は後回し実装のため暫定的に`lesson_viewed`または`lesson_completed`で代用可） |
| 7日間アクセスなし | 顧客の直近の`activity_events.occurred_at`（`event_type`問わず）が7日以上前 | `activity_events`（Phase A） |
| 課題期限超過 | — | **課題機能が存在しないため実装不可。ブロック中**（`FLOWREV_NATIVE_OPERATIONS_CONCEPT.md`5章） |
| 決済失敗 | `payment_failed`イベントが存在し、かつ同一購入が`paid`になっていない | `activity_events` + `purchases.payment_status`（Phase Aで`payment_failed`記録を追加後） |

「課題期限超過」以外の4ルールはPhase Aの`activity_events`が揃った時点で実装可能。課題期限超過は課題機能実装後に追加する。

### 1.2 実装方式

固定ルールは、既存の`app/api/admin/cron/check-unprotected-videos/route.ts`（Cloudflare動画保護チェック）と同じ構造のCronエンドポイントとして実装することを提案する（`GET`/`POST`両対応、`CRON_SECRET`によるBearer認証、`Vercel Cron`から定期起動）。

```
GET/POST /api/admin/cron/detect-inactive-customers
```

判定結果は、既存の`customers`テーブルを汚さず、新規テーブル`inactivity_flags`に書き出す（検知の都度、同一ルール・同一顧客の未解決フラグがあれば重複作成しない）。

```sql
CREATE TABLE inactivity_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  customer_id    UUID REFERENCES customers(id) ON DELETE CASCADE,
  rule_key       TEXT NOT NULL,   -- 'no_login_24h' | 'course_not_started_3d' | 'no_access_7d' | 'payment_failed'
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ,     -- 顧客が該当行動を取った場合にセット（下記1.3参照）
  UNIQUE (customer_id, rule_key, resolved_at)  -- 未解決フラグの重複防止（部分インデックスでの代替も検討）
);
```

RLSは`activity_events`と同一パターン（`client_owner`は自テナントのみ、`white_label_owner`は配下、`system_admin`は全件）。

### 1.3 解決（resolved）の扱い

検知後に顧客が実際に行動した場合（例: ログインした）、フラグを放置せず`resolved_at`をセットする。これは新規Cronジョブか、行動イベント記録時のトリガーロジックのいずれかで行う。Phase B MVPでは「次回Cron実行時に再評価し、条件を満たさなくなっていれば解決扱いにする」というシンプルな方式から始め、リアルタイム解決は後回しにする。

### 1.4 管理画面表示

既存の顧客一覧（`app/(dashboard)/customers/page.tsx`）に、現状の「7日間未行動」フィルタ（`last_action_at`ベース、現在は機能していない）を`inactivity_flags`ベースに置き換える形で統合する。既存の4箇所の重複実装（`FLOWREV_NATIVE_OPERATIONS_CONCEPT.md`5章参照）は本Phaseで一本化する。

## 2. Phase C: オンボーディング管理

### 2.1 データモデル

```sql
CREATE TABLE onboarding_templates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES products(id),  -- 商品ごとに異なるオンボーディングを許容（NULL=全商品共通）
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE onboarding_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       UUID REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  step_number       INTEGER NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  completion_type   TEXT NOT NULL,  -- 'manual_check' | 'event_based'（下記2.2参照）
  completion_event  TEXT,           -- completion_type='event_based' の場合、activity_events.event_type を参照
  due_days          INTEGER,        -- テンプレート適用からの猶予日数（NULL=期限なし）
  UNIQUE (template_id, step_number)
);

CREATE TABLE onboarding_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID REFERENCES customers(id) ON DELETE CASCADE,
  template_id    UUID REFERENCES onboarding_templates(id),
  step_id        UUID REFERENCES onboarding_steps(id),
  status         TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'completed' | 'overdue'
  started_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  UNIQUE (customer_id, step_id)
);
```

（`white_label_id`/`client_id`は`onboarding_templates`から`template_id`経由で辿れるため、`onboarding_progress`自体には持たせず、RLSポリシーはJOIN形式にする。既存の`scenario_steps`が`scenario_id`経由で`follow_scenarios.client_id`を辿る設計と同じパターン。）

### 2.2 完了条件

- `manual_check`: 顧客または運営者が手動で「完了」操作をする（会員サイトのレッスン完了ボタンと同じUXパターン）。
- `event_based`: 指定した`activity_events.event_type`が発生した時点で自動的に`completed`にする（例: ステップ「最初のレッスンを見る」は`lesson_viewed`イベントで自動完了）。これによりオンボーディング進捗と行動イベント基盤が直接連携する。

### 2.3 期限・リマインド

`due_days`超過かつ未完了のステップは、Phase Bの検知Cronと同じ仕組みで「オンボーディング遅延」として検知し、Phase Dのフォロー自動化のトリガーにする（`follow_scenarios.trigger_type = 'onboarding_step_overdue'`、下記3章）。

### 2.4 テナント分離

`onboarding_templates`は既存の`follow_scenarios`と同じ粒度（`client_id`単位、`product_id`で絞り込み可）で作成する。RLSも`follow_scenarios`と同一パターン。

## 3. Phase D: フォロー自動化

### 3.1 方針：新規エンジンを作らず既存を拡張する

既存の`follow_scenarios` / `scenario_steps` / `scenario_logs`（`supabase/migrations/0005_scenarios.sql`）は、「トリガー種別＋ステップ番号＋待機日数＋チャネル」という汎用的な構造を既に持っており、`trigger_type`列には`"no_action"`・`"course_complete"`という未使用の値がZodスキーマ上既に定義されている（`FLOWREV_NATIVE_OPERATIONS_CONCEPT.md`5章参照）。これを最大限再利用する。

新たに使う`trigger_type`値（既存のZod enumに追加する）:

- `'inactivity'` — Phase Bの`inactivity_flags`検知をトリガーにする
- `'onboarding_step_overdue'` — Phase Cのオンボーディング期限超過をトリガーにする

「条件」「待機時間」「メール」「LINE」は既存の`scenario_steps`（`delay_days`・`channel`・`subject`/`body`）でそのまま表現できる。**新しいシナリオビルダーUIは作らない**（設計原則）。

### 3.2 管理者タスク（新規のstep種別）

現状`scenario_steps.channel`は`'email'`/`'line'`のみ。ここに`'admin_task'`を追加し、「顧客への自動送信ではなく、運営者に対応を促す社内タスクを作る」ステップを表現する。実行時（`app/api/admin/scenarios/execute/route.ts`）に`channel === 'admin_task'`の場合はメール送信の代わりに、管理画面に表示するタスクレコードを作る（新規テーブル`admin_tasks`、または既存の`scenario_logs`にタスク種別を持たせる軽量な方式のどちらかを実装時に選定）。

### 3.3 停止条件

Phase Bの「解決（resolved）」の概念（1.3節）と統合する。`inactivity_flags.resolved_at`がセットされた時点で、対応する`scenario_logs`のうち`pending`状態のものを`cancelled`にする（新しいstatus値を追加）。これにより「ログインしたのにフォローメールが届く」という体験の悪化を防ぐ。既存の`scenario_logs.status`は`pending`/`sent`/`failed`のみのため、`cancelled`を追加する。

### 3.4 自動実行のスケジューリング

Phase 0監査で指摘済みの通り、現状`app/api/admin/scenarios/execute`は手動トリガーのみで自動化されていない（`docs/audit/02_FEATURE_MATRIX.md`）。Phase Dでは、これをVercel Cron（`vercel.json`の`crons`配列に追加）で定期実行する。これは監査時点の`docs/audit/08_NEXT_CODEX_INSTRUCTIONS.md`タスク12と同じ内容であり、**実際に顧客への自動送信が始まる運用変更を伴うため、Phase D着手前に別途運用者の承認を得る**（PR #1の最終確認時に既に指摘済みの方針を踏襲する）。

## 4. 既存機能との接続まとめ

| 新機能 | 接続する既存テーブル/機能 | 接続方法 |
|---|---|---|
| `inactivity_flags` | `customers`, `purchases`, `activity_events` | 検知Cronが`activity_events`と`purchases.payment_status`を読み、`customer_id`で`customers`と紐付ける |
| `onboarding_templates/steps/progress` | `products`, `follow_scenarios`（間接） | `product_id`で商品に紐付け。期限超過は`follow_scenarios.trigger_type='onboarding_step_overdue'`経由でフォローに接続 |
| フォロー自動化の拡張 | `follow_scenarios`, `scenario_steps`, `scenario_logs`, `lib/email/*`, `lib/line/client.ts` | 既存テーブル・既存送信関数をそのまま使う。新規に増えるのは`trigger_type`の値と`channel='admin_task'`のみ |
| 管理画面表示（未行動者一覧） | `app/(dashboard)/customers/page.tsx` | 既存の（機能していない）7日間フィルタを`inactivity_flags`ベースに置き換え |
