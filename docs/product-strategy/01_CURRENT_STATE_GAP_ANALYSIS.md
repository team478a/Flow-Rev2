# 現状ギャップ分析

対象コミット: `main`（PR #1マージ後、`714293d`）。

判定区分: **実装済み** / **一部実装** / **基盤のみ** / **UIのみ** / **未実装** / **再設計が必要** / **削除候補** / **調査継続**

## 1. ロール・権限

| 項目 | 判定 | 根拠 |
|---|---|---|
| 4階層ロール（system_admin/white_label_owner/client_owner/customer） | **実装済み** | `user_profiles.role`、`supabase/migrations/0001_core_tenant.sql:49-58`。トリガーによる昇格防止: `0008_user_trigger.sql:15-38` |
| ルートレベルのロールガード | **実装済み** | `lib/supabase/middleware.ts:74-150`（`/admin`/`/wl`/`/my`のprefixガード） |
| `/api/admin/*`のロールガード | **一部実装** | 個別ルートで実装（`app/api/admin/video/*`等）。以前は`scenarios/execute`に漏れがあったがPR #1で修正済み |

## 2. `white_labels`（OEM事業者）

| 項目 | 判定 | 根拠 |
|---|---|---|
| テーブル・基本CRUD | **実装済み** | `lib/repositories/white-labels.ts`、`app/admin/white-labels/{page,new,[id]/edit}.tsx` |
| `brand_name`編集 | **実装済み** | `features/admin/components/white-label-form.tsx:39-112`、`white-label-actions.ts` |
| `brand_color`編集 | **実装済み** | 同上 |
| `brand_logo_url`編集 | **未実装** | スキーマにのみ存在。フォーム・アクション・リポジトリのどこにも参照なし |
| `brand_domain`編集 | **未実装** | 同上 |
| ブランド情報の実際のUI反映（ロゴ・色を製品画面に表示） | **未実装** | `AppShell`（`features/dashboard/components/app-shell.tsx`）は`brand: string`のみでロゴ・色のprops自体が存在しない。`/wl`・`/dashboard`とも"FlowRev"/"FlowRev WL"の**文字列ハードコード** |
| 独自ドメイン/サブドメインでのテナント解決 | **未実装** | middlewareはロールベースのpath判定のみ。`Host`ヘッダ・`brand_domain`を参照する処理は皆無 |
| ステータス（active/suspended/cancelled）・停止/再開 | **実装済み** | `toggleWhiteLabelStatusAction`、`requireWhiteLabelOwner()`（`features/wl/guard.ts:36-56`）が`/wl/*`を`/suspended`へリダイレクト |
| **停止のクライアントへのカスケード** | **未実装・再設計が必要** | WL停止時、配下`client_owner`は`clients.status`が個別に`suspended`でない限り通常利用を継続できてしまう |
| OEM管理者招待 | **一部実装** | WLオーナーアカウント自体は`createWhiteLabel()`が同時作成（`lib/repositories/white-labels.ts:187-259`）。WLオーナーの「追加」招待（複数管理者）は未実装 |
| 契約状態・利用プラン | **一部実装** | `plan_id`で紐付け可能。契約開始日・更新日等の契約管理概念はなし |
| 操作履歴 | **未実装** | 4章参照 |

## 3. `clients`（クライアント事業者）

| 項目 | 判定 | 根拠 |
|---|---|---|
| テーブル・基本CRUD | **実装済み** | `lib/repositories/clients.ts` |
| WL配下クライアント作成（招待ベース） | **実装済み** | `features/invitations/`、`app/wl/clients/new/page.tsx` |
| クライアント一覧 | **実装済み** | `app/wl/clients/page.tsx` |
| クライアント編集 | **一部実装** | `business_name`のみ編集可（`app/wl/clients/[id]/edit/page.tsx`） |
| 利用停止・再開 | **実装済み** | `toggleClientStatus()`、`requireClientOwner()`が`/dashboard`等を`/suspended`へリダイレクト |
| プラン設定 | **一部実装** | `clients.plan_id`列は存在（PR #1で追加）。WL側UIから明示的にプランを割り当てるフローは未確認・**調査継続** |
| 利用機能確認（クライアント側から見た有効機能） | **未実装** | 後述`plans.features`はゲートには使われるが、クライアント自身が「今何が使えるか」を見る専用画面はない |
| 利用量確認 | **未実装** | 5章参照 |
| サポート状態確認 | **未実装** | 該当概念自体がない |

## 4. プラン・機能制御

| 項目 | 判定 | 根拠 |
|---|---|---|
| `plans`テーブル（HQ管理） | **実装済み** | `app/admin/plans/{page,new}.tsx`。**ただし編集・削除UIが存在しない**（`lib/repositories/plans.ts`に`updatePlan`/`deletePlan`なし） |
| `plans`テーブル（WL管理、クライアント向け独自プラン） | **実装済み** | `app/wl/plans/`配下、フルCRUD |
| `plans.features` JSONBによる機能ゲート | **一部実装** | `lib/features/plan-features.ts`（`PLAN_FEATURE_DEFS`5キー: `lp_builder`/`member_site`/`scenarios`/`csv_export`/`ai_generation`）。実際にゲートされているのは3キーのみ（`app/(dashboard)/{layout,lp/page,members/page,scenarios/page}.tsx`）。`csv_export`/`ai_generation`は定義のみで未使用 |
| HQ（system_admin）プランでの機能設定 | **未実装** | `app/admin/plans/new/page.tsx`・`features/admin/components/plan-form.tsx`に機能チェックボックスなし。`createPlan()`は`features`列を書かない（DBデフォルト`{}`のまま） |
| `max_clients`/`max_products`/`max_customers`の実際の上限enforcement | **未実装** | 表示・保存のみ。作成時に既存件数と比較するコードは皆無 |
| WL作成プランの`max_clients` | **再設計が必要** | `features/wl/actions.ts:71,169`で常に`maxClients: 0`をハードコード。UIにも入力欄なし＝そもそも意味を持たない設計になっている |
| 汎用的な「テナント単位の機能トグル」基盤（`feature_definitions`等） | **未実装** | `plans.features`という「プラン単位」の仕組みはあるが、`white_label_features`/`client_features`のような個別テナント単位の上書きは存在しない |

## 5. 利用量管理

| 項目 | 判定 | 根拠 |
|---|---|---|
| AI生成・メール送信・LINE送信・ストレージ使用量等の累積計測 | **未実装** | `rate_limits`テーブルは5分間の固定ウィンドウ型レート制限（`ai:{userId}`単位）のみで、月次課金用の累積計測とは別物。他に計測の仕組み一切なし |
| 利用上限の判定・表示 | **未実装** | 計測自体が無いため判定不可 |

## 6. 行動履歴・進捗管理

| 項目 | 判定 | 根拠 |
|---|---|---|
| `activity_events`（顧客行動のイベント記録） | **基盤のみ（別ブランチに設計文書あり、未実装・未マージ）** | `docs/product/ACTIVITY_EVENT_CATALOG.md`（ブランチ`feature/phase-1-activity-events-foundation`）に設計済み。コード・DBとも未実装 |
| `customers.last_action_at` | **削除候補（現状死んだ列）** | 4箇所（`stats.ts`、`customers/page.tsx`、`customer-table.tsx`、`customers/export/route.ts`）が参照するが、書き込むコードが皆無（Phase 0監査で確認済み）。`activity_events`基盤ができ次第、この列への依存をやめて統合する方針（`docs/product/`で既定） |
| レッスン進捗（`lesson_progress`） | **実装済み（ただし「完了」のみ）** | `app/api/my/progress/route.ts`。「視聴開始」状態は存在しない |
| フォローシナリオ（`follow_scenarios`/`scenario_steps`/`scenario_logs`） | **一部実装** | エンジン自体は動作するが`trigger_type='purchase'`しか自動発火せず、自動実行のCronもない（Phase 0監査で既出） |

## 7. メール・LINE・決済設定の階層解決

| 機能 | 判定 | 根拠 |
|---|---|---|
| AI設定 | **再設計が必要** | `getActiveAiSetting()`はHQ行のみ参照。テーブルにはWL単位のユニーク制約があるのに読み取り経路が存在しない（`lib/repositories/ai-settings.ts:33-57`） |
| メール（Resend）設定 | **実装済み（2階層）** | `getActiveEmailSetting(whiteLabelId)`がWL→HQの順でフォールバック（`lib/repositories/email-settings.ts:105-149`） |
| LINE設定 | **再設計が必要** | クライアント単位のみでフォールバックなし（`lib/repositories/line-settings.ts:47-70`） |
| Stripe設定 | **再設計が必要** | 同上（`lib/repositories/stripe-settings.ts:47-70`） |
| Cloudflare設定 | **再設計が必要** | テナント概念自体がなくプラットフォーム全体で1行のみ（`lib/repositories/cloudflare-settings.ts:60-82`） |

**共通の課題**: 「クライアント→WL→HQ」という一貫した3階層フォールバックはどの機能にも存在しない。機能ごとにバラバラな設計になっており、OEM機能制御（9.4節相当）を作る前に、この階層解決パターンを統一するかどうかの判断が必要。

## 8. コンテンツのテナント間再利用（テンプレート配布）

| 項目 | 判定 | 根拠 |
|---|---|---|
| 商品・LP・フォローシナリオのWL→クライアントへの複製 | **未実装** | `products`/`follow_scenarios`/`landing_pages`いずれのリポジトリにもclone/copy/templateの概念なし。スキーマにも`source_id`的な列がない |

## 9. 監査ログ

| 項目 | 判定 | 根拠 |
|---|---|---|
| 運営者操作の監査ログ（誰が・いつ・何をしたか） | **未実装** | `audit_log`等のテーブル・列は皆無。停止操作（`toggleWhiteLabelStatusAction`等）にすら`actor_id`の記録がない |

## 10. 会員サイト・決済・AI生成機能

これらはPhase 0監査（`docs/audit/02_FEATURE_MATRIX.md`）で評価済みのため詳細は割愛し、結論のみ記載する。

| 項目 | 判定 |
|---|---|
| 会員サイト（購入判定・動画視聴・進捗） | **実装済み** |
| 決済（Stripe Checkout・Webhook） | **実装済み**（PR #1でWebhook署名検証必須化済み） |
| AI文章・画像・LP生成 | **実装済み**（PR #1でレート制限・SSRF対策済み） |

## 11. 外部連携・Onbizu/CommitRev

| 項目 | 判定 | 根拠 |
|---|---|---|
| Onbizu連携コード | **削除候補（対象コード自体が存在しない）** | 全文検索で0件。`docs/audit/02_FEATURE_MATRIX.md`にも記録済み |
| CommitRev連携コード | **削除候補（対象コード自体が存在しない）** | 同上 |

方針変更（不採用決定）に伴うコード上の対応は不要（削除すべきものが元々存在しない）。ドキュメント上の方針記録のみで完結する。

## 12. まとめ：優先度の高いギャップ

1. **OEMブランディングの実UI反映が皆無**（`brand_logo_url`/`brand_domain`が死んでいるだけでなく、`brand_color`すら製品画面のどこにも出ない） — OEM事業として販売する上で最低限必要
2. **WL停止がクライアントへカスケードしない** — 契約解除時の実務上の穴
3. **利用量計測が完全に不在** — 課金モデル以前の問題として、現状は使われ放題
4. **監査ログが完全に不在** — 停止・プラン変更等の重要操作が誰にも追跡できない
5. **設定解決階層がバラバラ**（AI/LINE/Stripe/Cloudflareそれぞれ別実装） — 機能制御を設計する前に方針統一が必要
6. **HQプランに機能設定UIがなく、編集・削除もできない** — WL側と非対称
