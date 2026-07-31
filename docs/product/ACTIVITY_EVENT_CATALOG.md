# 行動イベントカタログ（Phase A設計）

対象: `activity_events`テーブル、イベント記録サービス、イベント種別定義、既存機能からの記録ポイント。

このドキュメントはPhase Aの技術設計書であり、コードは含まない（`PHASE_1_IMPLEMENTATION_PLAN.md`に実装タスクとして落とし込む）。

## 1. `activity_events`テーブル設計

既存テーブルの命名・型パターン（`supabase/migrations/0005_scenarios.sql`の`scenario_logs`等）に合わせる。

```sql
CREATE TABLE activity_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  customer_id    UUID REFERENCES customers(id) ON DELETE CASCADE,  -- NULL可（スタッフ操作起因のイベント等）
  event_type     TEXT NOT NULL,          -- 下記2章の固定値
  event_source   TEXT NOT NULL,          -- 発生元モジュール名（下記2章）
  payload        JSONB DEFAULT '{}',     -- イベント種別ごとの付加情報
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- 業務上の発生時刻
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()   -- レコード作成時刻（通常occurred_atと同じ）
);

CREATE INDEX idx_activity_events_customer_type ON activity_events(customer_id, event_type, occurred_at DESC);
CREATE INDEX idx_activity_events_client_type ON activity_events(client_id, event_type, occurred_at DESC);
```

**`occurred_at`と`created_at`を分ける理由**: Webhook経由のイベント（Stripe等）は、実際の発生時刻とFlowRevがそれを知った時刻がズレうる。将来の分析・検知ロジックは`occurred_at`を正とする。

### RLS方針

既存の`0006_rls_functions.sql`のヘルパー関数をそのまま使う。

```sql
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_owner：自テナントのイベント参照" ON activity_events
  FOR SELECT USING (
    client_id = get_user_client_id() AND get_user_role() = 'client_owner'
  );

CREATE POLICY "white_label_owner：配下イベント参照" ON activity_events
  FOR SELECT USING (
    white_label_id = get_user_white_label_id() AND get_user_role() = 'white_label_owner'
  );

CREATE POLICY "system_admin：全参照" ON activity_events
  FOR SELECT USING (get_user_role() = 'system_admin');

-- customer ロールへの直接参照は許可しない（内部運営シグナルであり、顧客向けUIでは使わない）。
-- 書き込みは常に service_role（admin client）経由のみ（他の repositories と同じパターン）。
```

**INSERT用のポリシーを設けない理由**: 既存の`lib/repositories/*.ts`の多くと同様、イベント記録は`createAdminClient()`（service_roleキー、RLSバイパス）経由でのみ行う設計とする。これは`docs/audit/04_DATABASE_AND_AUTH.md`で確認済みの既存パターンであり、`activity_events`もこれに倣う。anon/authenticatedキー経由での直接書き込みは想定しない。

## 2. イベント種別定義（Phase A対象の11種）

| event_type | event_source | 発生元（記録ポイント） | payload例 | 実装状況 |
|---|---|---|---|---|
| `customer_registered` | `customers` | `features/customers/actions.ts`の`createCustomerAction()`、`app/api/p/register/route.ts`のPOSTハンドラ | `{ "source": "staff" \| "lp", "lp_id"?: string }` | 記録ポイントは既存、新規追加のみ |
| `purchase_completed` | `purchases` | `app/api/webhooks/stripe/route.ts`の`markPurchasePaid()`呼び出し直後 | `{ "purchase_id": string, "product_id": string, "amount": number }` | 記録ポイントは既存、新規追加のみ |
| `first_login` | `auth` | `features/auth/actions.ts`の`login()` | `{}` | **新規記録ロジックが必要**（4章参照） |
| `course_started` | `member_site` | `app/my/courses/[id]/page.tsx`表示時 | `{ "course_id": string }` | **「開始」概念自体が現状存在しない。新規実装が必要**（4章参照） |
| `lesson_viewed` | `member_site` | レッスン詳細ページ表示時 | `{ "lesson_id": string, "course_id": string }` | **新規実装が必要**（4章参照） |
| `lesson_completed` | `member_site` | `app/api/my/progress/route.ts`の`upsertLessonComplete()`呼び出し直後 | `{ "lesson_id": string, "course_id": string }` | 記録ポイントは既存、新規追加のみ |
| `assignment_submitted` | `assignments` | （課題機能が存在しないため未定義） | — | **ブロック中。課題機能実装まで対象外**（`FLOWREV_NATIVE_OPERATIONS_CONCEPT.md`5章参照） |
| `payment_failed` | `purchases` | `app/api/webhooks/stripe/route.ts`（新規ケース追加が必要） | `{ "purchase_id"?: string, "stripe_event_type": string }` | **Webhookハンドラの拡張が必要**（4章参照） |
| `email_sent` | `scenario_execution` | `lib/repositories/scenario-execution.ts`の`markLogSent()`（channel=emailの場合） | `{ "scenario_log_id": string, "step_id": string }` | 記録ポイントは既存、新規追加のみ |
| `email_opened` | `email_tracking` | 未定（下記参照） | `{ "scenario_log_id"?: string }` | **開封追跡の仕組み自体が存在しない。Phase A対象外、Phase A完了後に個別検討**（4章参照） |
| `line_sent` | `scenario_execution` | `app/api/admin/scenarios/execute/route.ts`の`sendLinePushMessage()`成功後 | `{ "scenario_log_id": string, "step_id": string }` | 記録ポイントは既存、新規追加のみ |

## 3. イベント記録サービス設計

新規モジュール `lib/activity-events/record-event.ts`（仮）を作り、既存の`lib/repositories/*.ts`と同じ「ベストエフォート・失敗は握りつぶす」パターンに合わせる（例: `app/api/webhooks/stripe/route.ts`の招待メール送信部分が`catch { /* 招待失敗は webhook 成功に影響させない */ }`としている既存パターンと同一方針）。

```ts
// lib/activity-events/record-event.ts のイメージ（実装はPhase 1タスクで行う）
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActivityEventType =
  | "customer_registered"
  | "purchase_completed"
  | "first_login"
  | "course_started"
  | "lesson_viewed"
  | "lesson_completed"
  | "payment_failed"
  | "email_sent"
  | "line_sent";
  // assignment_submitted / email_opened はブロック中のためPhase Aでは型に含めない

export interface RecordActivityEventInput {
  eventType: ActivityEventType;
  eventSource: string;
  clientId: string;
  whiteLabelId: string;
  customerId?: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * 行動イベントを記録する（ベストエフォート）。
 * 呼び出し元の主処理（購入完了・レッスン完了等）を、イベント記録の失敗で
 * 失敗させないこと。呼び出し側は必ず .catch(() => {}) するか、
 * この関数内部で例外を握りつぶす（既存の enqueuePurchaseScenarios 等と同じ方針）。
 */
export async function recordActivityEvent(input: RecordActivityEventInput): Promise<void> {
  // 実装: createAdminClient().from("activity_events").insert({...})
}
```

**なぜ「ベストエフォート」か**: 行動イベントの記録は分析・検知のための副次的な処理であり、これが失敗したことを理由に顧客の購入やレッスン完了といった主処理自体を失敗させてはならない。これは既存コードベース全体で徹底されている方針（`docs/audit/01_ARCHITECTURE.md`のデータフロー、Stripe Webhookの招待送信部分等）と一貫させる。

## 4. 記録ポイントごとの実装メモ

### 4.1 既存の記録ポイントにそのまま追加できるもの

- `customer_registered`: `features/customers/actions.ts`の`createCustomerAction()`成功後、および`app/api/p/register/route.ts`のupsert成功後に`recordActivityEvent()`を呼ぶだけ。
- `purchase_completed`: `app/api/webhooks/stripe/route.ts`の`markPurchasePaid()`成功直後。
- `lesson_completed`: `app/api/my/progress/route.ts`の`upsertLessonComplete()`成功直後。
- `email_sent` / `line_sent`: `lib/repositories/scenario-execution.ts`の`markLogSent()`と同じ箇所（呼び出し元は`app/api/admin/scenarios/execute/route.ts`）。

### 4.2 新規の記録メカニズムが必要なもの

- **`first_login`**: `features/auth/actions.ts`の`login()`は現状ログイン日時を一切記録しない。「初回かどうか」を判定するには、`user_profiles`または`customers`に`first_login_at`（NULL＝未ログイン）を追加し、NULLのときだけイベントを発火して値をセットする方式を提案する。
- **`course_started` / `lesson_viewed`**: 現状「表示された」ことを記録する仕組みが存在しない（完了ボタンでの明示的な操作のみ記録される）。サーバーコンポーネントのページ表示時に記録すると、リロードのたびに重複イベントが発生するため、**顧客ごと・コース/レッスンごとに「初回表示のみ記録する」冪等性チェック**（例: `activity_events`に対する事前SELECT、または専用のユニーク制約付き中間テーブル）が必要。実装コストが他のイベントより高いため、Phase 1実装計画では他のイベントより後回しにすることを提案する（詳細は`PHASE_1_IMPLEMENTATION_PLAN.md`）。
- **`payment_failed`**: `app/api/webhooks/stripe/route.ts`に新しいイベントタイプの分岐を追加する必要がある。Stripeの`checkout.session.expired`（顧客が決済を完了せず離脱）と`payment_intent.payment_failed`（カード拒否等）のどちらを拾うかは、Stripe側のWebhook購読設定（イベントタイプの選択）にも影響するため、実装時に確定する。

### 4.3 Phase A時点では実装しないもの

- **`email_opened`**: Resend連携（`lib/email/*.ts`）には開封追跡の仕組みが一切ない。Resend自体はWebhook経由での配信状況通知に対応しているため、技術的には`app/api/webhooks/resend`のような新規Webhookルートを追加すれば実現可能だが、これは行動イベント基盤そのものとは独立した「メール配信基盤の拡張」であり、Phase Aのスコープには含めない。イベント型としてはカタログに定義しておき、実装は別タスクとする。
- **`assignment_submitted`**: 課題機能自体が存在しないため実装不可。

## 5. 検知・分析での利用イメージ（先取り）

Phase B（未行動者検知）・Phase 7（成果・売上分析）は、いずれも`activity_events`をSELECTするだけで完結し、`activity_events`テーブル自体や記録サービスに手を入れない。例えば「7日間アクセスなし」は、顧客ごとの`MAX(occurred_at)`が7日以上前であることを問い合わせるだけで判定でき、現状の`customers.last_action_at`（誰も書き込んでいない）への依存を解消できる。具体的なクエリ設計は`ONBOARDING_AND_FOLLOWUP_MVP.md`で扱う。
