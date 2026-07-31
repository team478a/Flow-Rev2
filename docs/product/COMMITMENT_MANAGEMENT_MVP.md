# コミットメント管理 MVP設計（Phase E）

設計のみ。Phase 1（本ラウンド）の実装対象には含めない。Phase A〜Dの完了後に着手する。

## 1. 概要

顧客が自ら目標（コミットメント）を設定し、週次で行動を報告し、運営者（`client_owner`）がコメントで伴走する機能。会員サイト（`app/my`配下、customerロール向け）に新しい画面を追加する形で実装する。

## 2. データモデル

```sql
CREATE TABLE commitments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  customer_id    UUID REFERENCES customers(id) ON DELETE CASCADE,
  goal_text      TEXT NOT NULL,
  due_date       DATE,
  status         TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'achieved' | 'abandoned'
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE commitment_checkins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id  UUID REFERENCES commitments(id) ON DELETE CASCADE,
  week_start     DATE NOT NULL,           -- 対象週の開始日（月曜起点等、実装時に確定）
  action_text    TEXT,                    -- 「今週の行動」の顧客自身の記述
  self_rating    TEXT,                    -- 顧客自身の達成度自己申告（実装時にスケールを確定。例: 'done' | 'partial' | 'not_done'）
  operator_comment TEXT,                  -- 運営者コメント
  commented_by   UUID REFERENCES auth.users(id),
  ai_suggestion  TEXT,                    -- AI提案（下記4章）。運営者コメントの下書きとして使う
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (commitment_id, week_start)
);
```

`white_label_id`/`client_id`は`commitments`に直接持たせる（既存の`customers`テーブルと同じ粒度）。`commitment_checkins`は`commitment_id`経由で辿る（`scenario_steps`が`scenario_id`経由でテナントを辿るのと同じパターン）。

## 3. RLS方針

- `customer`: 自分自身の`commitments`/`commitment_checkins`のみ参照・作成・更新可（`customers.user_id = auth.uid()`経由での紐付け。既存の`purchases`の顧客向けRLSポリシー `EXISTS (SELECT 1 FROM customers c WHERE c.id = ... AND c.user_id = auth.uid())` と同じパターンを使う）。
- `client_owner`: 自テナント（`client_id`）の顧客のコミットメントを参照・コメント可。
- `white_label_owner`: 配下テナントを参照可（コメントは不可、既存の他機能と同じ「参照のみ」パターンに合わせる）。
- `system_admin`: 全参照可。

## 4. AI運営アシスタント（提案・承認型）

`commitment_checkins.ai_suggestion`は、既存の`lib/ai/client.ts`（Anthropic、`generateText()`）を使い、顧客の`action_text`・`self_rating`・過去の`activity_events`を入力として、運営者コメントの下書きを生成する。

**重要**: これは「提案」であり、`operator_comment`列には**必ず`client_owner`が確認・編集した上で保存した内容のみ**が入る。AI生成結果を自動的に`operator_comment`へコピーして顧客に見せる実装はしない（設計原則「AIによる完全自動送信は後回しにし、最初は提案・承認型とする」）。UIパターンは既存の`features/ai/components/ai-generate-button.tsx`（生成→テキストエリアに反映→ユーザーが編集→保存）をそのまま踏襲する。

## 5. 既存機能との接続

| 項目 | 接続先 | 接続方法 |
|---|---|---|
| コミットメント作成・閲覧UI | `app/my`（customerロール向け会員サイト、既存の`app/my/courses/[id]/page.tsx`と同じ認可パターン） | `getSessionProfile()`で`role === 'customer'`を確認し、`session.clientId`でテナントスコープする既存パターンを流用 |
| 運営者側の閲覧・コメントUI | `app/(dashboard)`配下（`client_owner`向け）、既存の顧客詳細ページ（`app/(dashboard)/customers/[id]/page.tsx`）にタブ追加する形を想定 | 既存の顧客詳細ページから`customer_id`で辿る |
| 週次チェックインのリマインド | Phase Dのフォロー自動化（`follow_scenarios`） | 「今週まだチェックインしていない」を新しいルールとして`inactivity_flags`的な検知に追加するか、専用の軽量チェックにする（実装時に判断） |
| AI提案 | `lib/ai/client.ts`（既存のAnthropic連携、DB暗号化保存のAPIキーをそのまま利用） | 新しいプロンプトビルダー関数を`lib/ai/`配下に追加するのみで、AI呼び出し基盤自体は変更しない |
| 行動データとの連携 | `activity_events`（Phase A） | チェックイン提出・未提出も将来`activity_events`にイベントとして記録し、Phase 7の分析・Phase Bの検知と統合できるようにする（Phase E MVP時点では必須ではない） |

## 6. Phase E MVPで作らないもの

- 目標のテンプレート化・カテゴリ分類
- 達成度の自動判定（`self_rating`はあくまで自己申告）
- AIによるコミットメント達成予測等の高度な分析
- 週次チェックインを怠った場合の自動的なペナルティ・エスカレーション（検知はするが、対応は運営者判断に委ねる）
