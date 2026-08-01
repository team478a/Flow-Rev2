# 目標アーキテクチャ

`00_FLOWREV_PRODUCT_PRINCIPLES.md`の方針と`01_CURRENT_STATE_GAP_ANALYSIS.md`のギャップを踏まえた、目標とするアーキテクチャを領域別に示す。各領域で「既存を活かす」「新規に追加する」を明示する。ここでは**設計方針の提示**にとどめ、実装そのものは`07_IMPLEMENTATION_ROADMAP.md`以降で段階化する。

## 1. 4階層テナント構造

**既存を活かす**: `white_labels`/`clients`/`user_profiles.role`の3テーブル構造はそのまま4階層（`system_admin`/`white_label_owner`/`client_owner`/`customer`）の骨格として使い続ける。新しい「OEM管理」テーブルを別途作らない。

**新規に追加する**:
- `white_labels`にブランド関連列を追加（後述10章）
- WL停止時のクライアントへのカスケード判定ロジック（`features/wl/guard.ts`または新規`lib/tenant/cascade.ts`）
- テナント階層を辿るヘルパー（`customer→client→white_label`の解決）を一箇所に集約する`lib/tenant/resolve.ts`（現状は機能ごとに個別実装されており重複している）

## 2. 認証

**既存を活かす**: Supabase Authをそのまま使用。`user_profiles`とのリンク、ロール昇格防止トリガー（`0008_user_trigger.sql`）は変更不要。

**新規に追加する**: なし（今回のロードマップでは認証方式自体の変更は行わない）。

## 3. 権限（RLS・アプリ層）

**既存を活かす**: `get_user_role()`/`get_user_client_id()`/`get_user_white_label_id()`のSECURITY DEFINER関数群（`0006_rls_functions.sql`）を今後追加するテーブル（`activity_events`/`audit_logs`/`feature_definitions`等）のRLSでも同じパターンで再利用する。新しいRLSヘルパー関数を乱立させない。

**新規に追加する**: 詳細は`05_PERMISSION_AND_TENANT_MODEL.md`。

## 4. DB

**既存を活かす**: `supabase/migrations/NNNN_description.sql`の連番方式、`SUPABASE_SETUP.md`の手動適用手順、`prod_setup.sql`の同期をそのまま継続。

**新規に追加する**: `06_DATA_MODEL_PLAN.md`で候補テーブルごとに整理する。

## 5. イベント管理（行動履歴）

**既存を活かす**: `docs/product/ACTIVITY_EVENT_CATALOG.md`（ブランチ`feature/phase-1-activity-events-foundation`）の設計をベースとする。本文書セットが独自に別設計を起こすことはしない。当該ブランチの設計をこの文書群に取り込み、`04_NATIVE_OPERATIONS_FEATURES.md`で接続方法を明記する。

**新規に追加する**: `activity_events`テーブル（未実装）。`customers.last_action_at`は`activity_events`実装後に読み取り専用の集計ビュー等へ置き換え、直接書き込みには依存しない設計とする。

## 6. 自動化（フォローシナリオ）

**既存を活かす**: `follow_scenarios`/`scenario_steps`/`scenario_logs`と実行エンジン（`app/api/admin/scenarios/execute/route.ts`）はそのまま土台として使う。ゼロから作り直さない。

**新規に追加する**:
- `trigger_type`の拡充（`purchase`以外＝未行動検知・進捗停滞等、`activity_events`ベースのトリガー）
- 定期実行の仕組み（現状Cron無し。Vercel Cron等での定期起動）
- テナント単位のフォロー設定上限（OEM機能制御と接続、9章参照）

## 7. AI

**既存を活かす**: AI文章・画像・LP生成機能自体（Phase 0監査で実装済み確認）とレート制限（`lib/rate-limit.ts`）は活かす。

**新規に追加する**:
- 設定解決を「WL→HQ」の2階層フォールバックに再設計（現状HQ行のみ参照、`lib/repositories/ai-settings.ts:33-57`）。`ai_provider_settings`に`client_id`列が存在しないため、メール設定と同じく2階層が上限（`08`文書冒頭、Task 1-1実装時に確認済み）
- AI利用量の累積計測（5章の利用量管理と接続。将来のOEMコスト管理の土台）
- AI運営アシスタント（未行動検知・優先順位提示等の提案生成）は`04_NATIVE_OPERATIONS_FEATURES.md`で新規設計するが、提案→承認→送信のフローを必ず経る（無承認自動送信はしない）

## 8. メール・LINE

**既存を活かす**: メール（Resend）設定は既にWL→HQの2階層フォールバックが実装済み（`lib/repositories/email-settings.ts:105-149`）。これを他機能の模範パターンとする。

**新規に追加する**: LINE設定・Stripe設定・Cloudflare設定を、「テナント別設定があれば使い、なければ上位へフォールバックする」というメール設定と同じ考え方に統一する（現状はクライアント単体のみ、またはグローバル1行のみ）。この統一は9章の機能制御設計より先に行う（前提が揃わないと機能制御の設計が破綻するため）。**（2026-08-01決定事項、2026-08-02訂正）Cloudflareを含む全ての外部設定は「クライアント設定→OEM設定→FlowRev本部設定」の階層フォールバックを基本方針とする。ただし実際に到達できる階層数はテーブルのテナント列構成に依存する: `line_accounts`/`stripe_accounts`は`client_id`・`white_label_id`の両列が既存のため3階層（クライアント→OEM→本部）を実現できる。`cloudflare_settings`はテナント列が一切ないため、Phase 1で列追加方法を確定したうえで3階層化する（`08`文書Task 1-4、`09`文書参照）。**

## 9. Storage

**既存を活かす**: Supabase Storageの現行バケット構成（動画・画像等）は変更しない。

**新規に追加する**: OEMブランドロゴ・favicon用のバケット/パス設計（10章のブランド設定に付随）。

## 10. 決済

**既存を活かす**: Stripe Checkout・Webhook（PR #1で署名検証必須化済み）はそのまま。2段階課金（本部→OEM、OEM→クライアントはOEM自己回収）の前提に合わせ、FlowRevが決済を代行徴収する設計は今回追加しない。

**新規に追加する**: なし（Stripe Connect・自動分配は明示的に後回し）。利用量計測（5章）が先。

## 11. OEMブランド設定

**既存を活かす**: `white_labels`テーブルに既に存在する`brand_name`/`brand_color`/`brand_logo_url`/`brand_domain`列を土台にする。テーブルの再設計はしない。

**新規に追加する**:
- `brand_logo_url`/`brand_domain`をフォーム・アクション・リポジトリで実際に読み書きできるようにする
- favicon・送信者名・サポートメールアドレス・会社名・利用規約URL・プライバシーポリシーURL用の列追加
- `AppShell`（`features/dashboard/components/app-shell.tsx`）にロゴ・色のprops追加、`/wl`・`/dashboard`のハードコード文字列除去
- MVPはサブドメイン/パスベースのテナント識別のみ（カスタムドメインは後回し）

## 12. OEM機能制御

**既存を活かす**: `plans.features` JSONB・`PLAN_FEATURE_DEFS`（`lib/features/plan-features.ts`）の「機能キー」という考え方自体は正しい方向性なので踏襲する。

**新規に追加する**: ディレクティブが明示的に要求する`feature_definitions`/`plan_features`/`white_label_features`/`client_features`のキー方式へ拡張する（大量のboolean列追加は行わない）。上位階層（HQ→OEM→クライアント）の設定を下位が超えられないようclamp処理を入れる。詳細は`06_DATA_MODEL_PLAN.md`・`07_IMPLEMENTATION_ROADMAP.md`。

## 13. 利用量管理

**既存を活かす**: なし（`rate_limits`はレート制限であり利用量管理ではないため流用不可、01章で確認済み）。

**新規に追加する**: 累積利用量テーブル（AI生成回数・メール送信数・LINE送信数・自動化実行数・ストレージ使用量等）。**課金の自動化より計測を先に作る**（ディレクティブ明記の順序）。**（2026-08-01決定事項）計測対象の追加優先順位は、AI画像生成 → AI文章・LP・商品生成 → メール送信 → LINE送信 → 自動化実行 → ストレージ・動画容量、の順とする（`07`文書Phase 5、`09`文書参照）。**

## 14. 監査ログ

**既存を活かす**: なし（現状皆無）。

**新規に追加する**: `audit_logs`テーブル（誰が・いつ・どのテナントで・何を）。まずは重要操作（ステータス変更・プラン変更・機能設定変更・招待）から記録対象とする。

## 15. まとめ

上記のうち、**既存資産をほぼそのまま使える領域**（認証、DB運用フロー、メール設定のフォールバックパターン、フォローシナリオエンジン、決済）と、**ゼロから設計が必要な領域**（利用量管理、監査ログ、OEM機能制御のキー方式、行動イベント）が明確に分かれる。実装順序は既存資産の再設計（設定解決の統一）を利用量管理・機能制御より先に行う必要がある点に注意する。詳細な順序は`07_IMPLEMENTATION_ROADMAP.md`で定める。
