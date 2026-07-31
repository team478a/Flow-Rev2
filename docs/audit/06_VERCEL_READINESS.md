# 06. Vercel適合性調査

## 前提: デプロイ対象は`artifacts/flowrev`のみ

このモノレポには3つの`artifacts/*`があるが、Vercelにデプロイする（すべき）のは**`artifacts/flowrev`（Next.js 14）のみ**。`artifacts/api-server`（Express、長時間稼働プロセス）と`artifacts/mockup-sandbox`（Vite、Replit Canvas専用）はVercelのサーバーレスモデルと非互換、または本番と無関係。

## 現状の適合性: 高い

`replit.md`によれば**既にVercelへデプロイされている**（`flowrev-dev-flowrev.vercel.app`）。`artifacts/flowrev/vercel.json`が既に存在し、`framework: "nextjs"`と1件のCron設定を含む。

| 項目 | 判定 | 詳細 |
|---|---|---|
| ビルドコマンド | ✅そのまま利用可 | `next build`。Vercelのフレームワークプリセットが自動検出。 |
| 出力ディレクトリ | ✅そのまま利用可 | `.next/`（標準）。カスタム`outDir`指定不要。 |
| Node.jsバージョン | ✅対応済み | `.nvmrc`でNode 20を指定、Vercelがサポートする範囲内。（Replit開発環境はNode24で意図的に差異あり、`replit.md`に明記） |
| pnpmバージョン | 🟡要対応 | `package.json`に`packageManager`フィールドが無く、Vercelがどのpnpmバージョンを使うか固定されていない。`pnpm-workspace.yaml`の`minimumReleaseAge`設定は比較的新しいpnpm機能のため、古いpnpmだと無視される恐れがある。 |
| APIサーバー構成 | ✅対応済み | flowrev自身の`app/api/**/route.ts`はNext.js Route Handler＝Vercel Functionとしてそのままデプロイ可能。`artifacts/api-server`はデプロイ対象外。 |
| 常駐サーバー依存 | ✅なし | `setInterval`等の常駐ループは確認されず。 |
| ファイルシステム書き込み | ✅なし | アップロードはすべてSupabase Storage/Cloudflare Stream直送で、ローカルディスク書き込みは確認されなかった。 |
| WebSocket/長時間処理 | ✅なし | `ws`/`socket.io`の使用なし。 |
| Cron処理 | 🟡一部のみ設定済み | `vercel.json`に動画保護チェックのCronはあるが、フォローアップシナリオ送信（`/api/admin/scenarios/execute`）のCronは未設定（02参照）。 |
| 環境変数 | 🟡要設定 | 下記一覧を参照。Vercelダッシュボードでの設定が必要。 |
| CORS | ✅問題なし | flowrevのAPIはCORSヘッダーを一切設定しておらず、同一オリジン限定（Cookie認証のAPIとして正しい設計）。 |
| Supabase接続 | ✅対応済み | anon/service_roleキーの分離も適切。 |
| OpenAI/Anthropic呼び出し | ✅対応済み | サーバーサイドのみ、DB暗号化保存のキーを使用。 |
| Stripe Webhook | 🟡要修正 | エンドポイント自体はVercel対応だが、署名検証にCritical脆弱性あり（05のC-1参照）。デプロイ前に必ず修正すること。 |
| LINE Webhook | — | 未実装のため対象外。 |

## 実ビルド検証結果

本監査環境でダミー環境変数を与えてビルドを実行し、**成功を確認済み**（`01_ARCHITECTURE.md`参照）。

```
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
ENCRYPTION_KEY=... NEXT_PUBLIC_APP_URL=... pnpm run build
✓ Compiled successfully / 56ページ全て生成成功 / EXIT:0
```

ビルド警告として、`@supabase/supabase-js`が`process.version`（Edge Runtime非対応API）を使用している旨のwarningが出るが、これはNode.js runtimeで動作するRoute Handler内の話であり、Edge Runtimeを明示指定していない限り実害はない。

## 必要な環境変数（Vercelダッシュボードに設定）

`artifacts/flowrev/.env.example`より:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`（Vercelの本番/PreviewのURLを正しく設定すること。REPLIT_DOMAINSフォールバックには依存しないこと）
- `ENCRYPTION_KEY`（32バイト以上のランダム文字列）
- `CLOUDFLARE_STREAM_WEBHOOK_SECRET`
- `CRON_SECRET`（**未設定のまま本番公開しないこと**、05のH-3参照）

AI（Anthropic/OpenAI）・メール（Resend）・Stripe・LINEの各APIキーは環境変数ではなく管理画面からDBに暗号化保存する設計のため、Vercel環境変数としては不要。

## Preview環境構築手順（提案）

1. Vercelプロジェクトの Root Directory を `artifacts/flowrev` に設定。
2. Supabase側にDev/Preview用プロジェクトを用意し、`SUPABASE_SETUP.md`の手順（または統一後のmigration方式）でスキーマを適用。
3. 上記環境変数をPreview環境に設定（本番と別のSupabaseプロジェクト・別の`ENCRYPTION_KEY`を使うこと）。
4. `develop`ブランチへのプッシュでPreviewが自動生成される運用（`replit.md`記載のブランチ戦略: `feature/*` → `develop`(Preview) → `main`(Production)）を踏襲。

## Production環境構築時の注意点

1. **`CRON_SECRET`・`CLOUDFLARE_STREAM_WEBHOOK_SECRET`を必ず設定する**（未設定だと認証がスキップされる、05のH-3）。
2. **全クライアントにStripe `webhookSecret`の設定を必須化してから決済を有効化する**（05のC-1が未修正の場合は特に重要）。
3. `packageManager`フィールドをルート`package.json`に追加し、pnpmバージョンを固定する。
4. `pnpm-workspace.yaml`のlinux-x64限定overridesは、Vercelのビルド機自体には影響しないが、GitHub Actionsやローカル開発環境の構成次第では見直しが必要（03参照）。
5. `/api/admin/scenarios/execute`のロールチェック漏れ（05のH-1）を本番公開前に必ず修正する。
6. フォローアップ自動送信を有効化するなら、`vercel.json`に`/api/admin/scenarios/execute`用のCronエントリを追加する。

## 総合判定

**`artifacts/flowrev`はコード・アーキテクチャの観点ではVercelにそのままデプロイ可能な状態にある。** 必要なのはコードの書き直しではなく、(a) 環境変数の整備、(b) `packageManager`固定などの設定追加、(c) Critical/Highのセキュリティ修正、の3点。`artifacts/api-server`と`artifacts/mockup-sandbox`はVercelの対象外として明確に切り離して運用する。
