# 02. 機能実装マトリクス

判定はコミットメッセージではなく実際のコード（`artifacts/flowrev`）を根拠とする。`artifacts/api-server`はhealthzのみのため対象外、`lib/db`（Drizzle）は未使用のため対象外。

凡例: ✅完成 / 🟡一部完成 / 🖼UIのみ / 🗄DBのみ / 🎭モック / ❌未実装 / ❓要動作確認

| 機能 | 判定 | 根拠 | 備考 |
|---|---|---|---|
| 管理者ログイン | ✅完成 | `features/auth/actions.ts:23-58`、`lib/supabase/middleware.ts:106-116`、`features/admin/guard.ts:10-19` | Supabase Auth + `user_profiles.role`。ミドルウェア＋サーバーアクション二重チェック。 |
| 顧客登録 | ✅完成 | `features/customers/actions.ts:19-68`、`app/api/p/register/route.ts:51-75` | スタッフ登録・LP自己登録の両経路あり。 |
| 顧客一覧 | ✅完成 | `app/(dashboard)/customers/page.tsx`、`lib/repositories/customers.ts:66-75` | フィルタ・タグ・CSVエクスポートあり。 |
| 顧客削除 | ✅完成 | `features/customers/actions.ts:120-136`、`lib/repositories/customers.ts:151-156` | **物理削除**（`deleted_at`等のソフトデリートなし）。 |
| 顧客再登録 | 🟡一部 | `lib/repositories/customers.ts:92-117`、`features/invitations/accept-actions.ts:62,138` | `customers`テーブルへの再登録は削除後の再INSERTとして偶発的に成立するのみで専用フローはない。招待の再送信（`client_owner`向け）には再登録ロジックがあるが、これは顧客(customer)ではなくテナントオーナー向け。 |
| プラン管理 | 🟡一部 | `lib/repositories/plans.ts:33-255`、`features/wl/actions.ts:46-215` | 代理店(white_label)側はCRUD完備。**本部(system_admin)側は作成・一覧のみで更新・削除がない**。 |
| 商品管理 | ✅完成 | `features/products/actions.ts:32-202` | CRUD＋サムネイルアップロード完備。 |
| 契約管理 | ❌未実装 | `contract`/`agreement`/`subscription`で全文検索し0件 | テーブル・API・UIすべて存在しない。 |
| LP生成 | ✅完成 | `app/api/ai/generate-lp/route.ts`、`lib/ai/client.ts:38-58` | Anthropic Claude（`claude-haiku-4-5-20251001`）でHTML/CSS生成。 |
| LP編集 | ✅完成 | `features/lp/actions.ts:71-114`、`features/lp/components/lp-html-editor.tsx` | 生HTML編集＋ライブプレビュー。 |
| LP公開 | ✅完成 | `lib/repositories/landing-pages.ts:102-123`、`app/p/[slug]/page.tsx` | `status`カラムで公開/非公開制御、専用ビューで匿名公開。 |
| LPプレビュー | ✅完成 | `lp-html-editor.tsx`、`app/p/[slug]/page.tsx` | エディタ内プレビュー（sandboxed iframe）＋公開ページ。**新規タブプレビューはXSSリスクあり（05参照）**。 |
| AI文章生成 | ✅完成 | `app/api/ai/generate-product/route.ts`、`generate-follow/route.ts`、`lib/ai/client.ts:12-32` | 商品説明・フォローメール文の2種。 |
| AI画像生成 | ✅完成 | `app/api/ai/generate-image/route.ts:37-62` | OpenAI DALL-E 3、生成後Supabase Storageへ再アップロード。 |
| 画像アップロード | ✅完成 | `app/api/lp/upload-image/route.ts`、`lib/storage.ts` | MIME/サイズ検証あり（ただしクライアント申告のContent-Typeのみ、05参照）。 |
| Supabase Storage | ✅完成 | `lib/storage.ts:1-126` | `product-images`（非公開・署名URL）、`lp-images`（公開）の2バケット運用。 |
| LINE連携（全体） | 🟡一部 | `features/line/actions.ts`、`lib/repositories/line-settings.ts`、`lib/line/client.ts` | 設定保存・送信クライアントは実装済みだが、受信導線（Webhook）が無いため`line_user_id`が一切書き込まれず、実運用では機能しない。 |
| LINE送信 | 🟡一部 | `lib/line/client.ts:11-32`、`app/api/admin/scenarios/execute/route.ts:71-85` | 送信ロジック自体は正しいが、送信先`line_user_id`を埋める手段が皆無。 |
| LINE Webhook | ❌未実装 | `app/api/webhooks/`配下に`stripe`と`cloudflare-stream`のみ存在、`line`ディレクトリ無し | 署名検証(`X-Line-Signature`)含め一切コードなし。 |
| メール送信 | ✅完成 | `lib/email/send-invite.ts`、`send-scenario-step.ts` | Resend、HQ→代理店フォールバック設定。 |
| ステップ配信 | 🟡一部 | `lib/repositories/scenario-execution.ts:21-141`、`app/api/admin/scenarios/execute/route.ts` | エンキュー〜送信のロジックは実装済みだが、**Vercel Cronに未登録**のため管理画面の「テスト実行」ボタンを手動で押さない限り自動送信されない。 |
| 決済 | ✅完成 | `app/api/p/register/route.ts:92-160`、`lib/stripe/client.ts` | テナントごとのStripeキーでCheckout Session発行。 |
| Stripe Webhook | ✅完成（要修正） | `app/api/webhooks/stripe/route.ts` | 機能としては実装済み。ただし**署名検証がスキップ可能な実装不備あり（05のCritical参照）**。 |
| 会員サイト | ✅完成 | `app/my/courses/[id]/page.tsx`、`lib/repositories/purchases.ts:88-104` | 購入判定・Cloudflare Stream署名再生・進捗管理。 |
| 購入後フォロー | 🟡一部 | `enqueuePurchaseScenarios`（`app/api/p/register/route.ts:202-209`、`app/api/webhooks/stripe/route.ts:136-143`） | エンキューは自動、送信はステップ配信同様Cron未接続で手動実行頼み。 |
| 未行動者検知 | 🟡一部 | `app/(dashboard)/customers/page.tsx:10-16`、`lib/repositories/stats.ts:21-121` | ダッシュボード表示・CSV抽出は機能するが、`no_action`トリガー型のシナリオ自動起動ロジックは存在しない（検知はできるが自動フォローに繋がらない）。 |
| Onbizu連携 | ❌未実装 | `onbizu`で全文検索し0件 | コード・設定・ドキュメントいずれにも記述なし。 |
| CommitRev連携 | ❌未実装 | `commitrev`で全文検索し0件 | 同上。 |

## 横断的な所見

- `artifacts/api-server`と`lib/db`（Drizzle）はほぼ未使用の並行スキャフォールドであり、実際の機能はすべて`artifacts/flowrev`が直接Supabaseへアクセスして実現している。
- **ステップ配信・購入後フォロー・未行動者検知の3機能が「一部完成」に留まっている根本原因は共通**：シナリオ実行エンジン自体は正しく実装されているが、本番で定期的に自動実行させるCronトリガーが1つも設定されていない（`vercel.json`のCronは動画保護チェックのみ）。この1点を解消すれば3機能とも実質的に完成に近づく。
- LINE連携は「送る仕組み」はあるが「顧客とLINEをつなぐ仕組み（Webhook）」が無いため、現状では機能として成立していない。
