# 08. 次のCodex作業への引き継ぎ指示書

このドキュメントは、次にこのリポジトリで作業するCodex/Claude Codeセッションへの実装指示書。`07_MIGRATION_PLAN.md`のPhase構成に対応するが、こちらは1タスクずつ着手できる粒度で書いている。**着手順は本ドキュメントの並び順を推奨する**（Phase 2のセキュリティ修正を最優先にした理由は07参照）。

作業時の共通ルール:
- `main`へ直接コミットしない。必ずfeatureブランチで作業しPRを出す。
- 1つのタスクごとに独立したコミット/PRにする（レビュー・ロールバックしやすくするため）。
- DB migrationに関わる変更は、必ずPreview用Supabaseプロジェクトで先に検証する。本番Supabaseへ直接適用しない。
- `artifacts/flowrev`以外（`api-server`、`mockup-sandbox`、`lib/*`）への変更は、明確な理由がない限り最小限に留める。

---

## タスク1: CI基盤の構築（typecheck/build自動化）

対象: `.github/workflows/ci.yml`（新規）、ルート`package.json`

1. `package.json`に`"packageManager": "pnpm@10.33.0"`を追加。
2. `artifacts/mockup-sandbox`の型エラー（`src/components/ui/{command,drawer,input-otp,spinner}.tsx`、`@types/react`バージョン不整合）を修正する。修正が難しい場合は、ルートの`typecheck`/`build`スクリプトから`mockup-sandbox`を除外し、flowrevのCIが独立して通る状態を優先する。
3. GitHub Actionsワークフローを追加: `pnpm install` → `pnpm --filter @workspace/flowrev run typecheck` → ダミー環境変数を設定した上で`pnpm --filter @workspace/flowrev run build`。
4. Actionsのランナーは`ubuntu-latest`（linux-x64）を使うこと。`pnpm-workspace.yaml`のlinux-x64限定overridesと衝突しないようにするため。

受入条件: PR作成時にCIが自動実行され、typecheck/buildの結果がステータスチェックに出る。

---

## タスク2: Stripe Webhook署名検証の必須化（05のC-1）

対象: `artifacts/flowrev/app/api/webhooks/stripe/route.ts`

1. `settings.webhookSecret`が未設定の場合に検証をスキップする分岐（現行の52-62行目付近）を削除する。
2. `webhookSecret`が無い場合は400または503を返し、イベントを処理しない。
3. クライアント管理画面（Stripe設定フォーム）側で、`webhookSecret`が未設定のままだと決済機能が「未設定」として表示され、Checkout Session作成自体をブロックするようにする（該当UIは`lib/stripe/client.ts`/管理画面のStripe設定フォームを確認）。
4. Preview環境のStripeテストWebhookで、正しい署名は通り、偽署名/未設定時は拒否されることを確認する。

---

## タスク3: `/api/admin/scenarios/execute`のロールチェック追加（05のH-1）

対象: `artifacts/flowrev/app/api/admin/scenarios/execute/route.ts`

1. 現在ログイン確認のみの箇所に、`app/api/admin/video/protect-all/route.ts`と同様の`session.role !== "system_admin"`（または適切なロール）チェックを追加する。
2. `listPendingDueLogs()`（`lib/repositories/scenario-execution.ts`）についても、呼び出し元がテナント指定できるようにするか、少なくともsystem_admin以外からは呼べないことを保証する。
3. `customer`ロールのテストアカウントでこのエンドポイントを呼び、403になることを確認する。

---

## タスク4: LP新規タブプレビューのXSS対策（05のC-2）

対象: `artifacts/flowrev/features/lp/components/lp-html-editor.tsx`

1. `openPreviewInNewTab()`のsame-origin `blob:` URLでの表示をやめ、`sandbox`属性付きiframe（`allow-scripts`を付けない、または別オリジンでのプレビュー配信）に変更する。エディタ内の既存プレビューiframe（正しく`sandbox="allow-same-origin"`のみで実装済み）と同じパターンを踏襲する。
2. 保存時（`createLpAction`/`updateLpAction`）にも`sanitizeLpHtml`相当のサニタイズを通す多層防御を追加する（ただし`<style>`除去による見た目崩れが起きるため、次のタスク5と合わせて設計すること）。
3. `<script>`タグを含むHTMLを保存→プレビューして、スクリプトが実行されないことを確認する。

---

## タスク5（設計検討・任意）: LPデザインシステムのCSS配信方式見直し（05のL-2）

対象: `artifacts/flowrev/lib/sanitize.ts`、`lib/ai/lp-design-system.ts`

現状、AIが生成した`<style>`タグはサニタイザーによって除去され、公開LPのデザインが機能していない（機能バグ）。`<style>`をそのまま許可リストに入れるとC-2と同系統のリスクを公開ページにも持ち込むため、代わりに「固定クラス名のCSS（`generateLpCss()`が生成する部分）をアプリ側の静的スタイルシートとして配信し、AI生成HTMLからは`<style>`タグを除去する」設計に変更することを推奨する。この変更は影響範囲が広いため、対応する場合は事前に方針をユーザーへ確認すること。

---

## タスク6: CRON_SECRET等のフェイルクローズ化（05のH-3）

対象: `app/api/admin/cron/check-unprotected-videos/route.ts`、`app/api/webhooks/cloudflare-stream/route.ts`

1. `NODE_ENV === 'production'`かつ該当シークレットが未設定の場合は、リクエストを処理せずエラーを返す（起動時チェックでも可）。
2. 開発環境でのみ、明示的なスキップを許容する。

---

## タスク7: SSRFガードの追加（05のH-4）

対象: `app/api/ai/generate-lp/route.ts`の`fetchReferenceText()`

1. `referenceUrl`のホストが、プライベートIPレンジ（`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`）またはlocalhostに解決される場合は拒否する。
2. `http`/`https`以外のスキームを拒否する（既に`new URL()`でエラーにはなるが、明示的にチェックする）。

---

## タスク8: レート制限の導入（05のH-2）

対象: `app/api/ai/*`、`features/auth/actions.ts`

1. 既存の`rate_limits`テーブル（`0004_payments.sql`で定義済み、未使用）を使い、ユーザーIDまたはIP単位のトークンバケット/固定ウィンドウ制限を実装する。
2. AI生成系（`generate-lp`/`generate-image`/`generate-follow`/`generate-product`）はユーザー単位で1分あたりN回程度に制限。
3. ログイン・パスワードリセットはIP+メール単位で制限。

---

## タスク9: 画像アップロードのマジックバイト検証（05のH-5）

対象: `artifacts/flowrev/lib/storage.ts`

1. アップロードされたファイルの先頭バイトを検証し、宣言されたMIMEタイプと実際のファイル形式が一致することを確認してから保存する。
2. 可能であれば画像を信頼できるライブラリで再エンコードしてから保存する。

---

## タスク10: DBマイグレーション整理（04・07のPhase 3）

対象: `artifacts/flowrev/supabase/migrations/*`、`SUPABASE_SETUP.md`

1. `0002_content.sql`・`0003_members_scenarios.sql`を`supabase/migrations/_archived/`等へ移動し、`SUPABASE_SETUP.md`の手順と一致しないファイルであることを明記する。
2. `prod_setup.sql`にしかない`plans.white_label_id`列と関連RLSポリシーを、正規のmigration連番ファイルに統合する。
3. 今後の変更の管理方式（Drizzle migrations／Supabase CLI migrations）をユーザーと決定し、決定後はこのドキュメントを更新する。

---

## タスク11: Replit依存の整理（03・07のPhase 5）

対象: `pnpm-workspace.yaml`、`features/invitations/actions.ts`

1. `stripe-replit-sync`・`@replit/vite-plugin-dev-banner`のcatalogエントリを削除。
2. `REPLIT_DOMAINS`フォールバックを削除し、`NEXT_PUBLIC_APP_URL`未設定時は明示的にエラーを投げる。

---

## タスク12: 購入後フォロー・未行動者検知のMVP自動化（02・07のPhase 7）

対象: `vercel.json`、`lib/repositories/scenario-execution.ts`

**前提**: タスク3（ロールチェック追加）が完了していること。

1. `/api/admin/scenarios/execute`用のCronエントリを`vercel.json`に追加。
2. `no_action`トリガー型シナリオを自動起動するロジックを追加。
3. 本番反映前に、テナント運営者が送信内容・頻度を確認できる管理画面上の導線（プレビュー等）があることを確認する。

---

## 着手時の確認事項（各タスク共通）

- 着手前に対象ファイルを実際に読み、本監査時点(`2e2861aed27fd5287fd0aacfcb57c5df90f03a3`)からコードが変わっていないか確認すること。
- 修正後は必ず`pnpm --filter @workspace/flowrev run typecheck`と`pnpm --filter @workspace/flowrev run build`（ダミー環境変数付き）を実行し、既存機能を壊していないことを確認すること。
