# 01. アーキテクチャ調査

対象コミット: `2e2861aed27fd5287fd0aacfcb57c5df90f03a3`

## 技術構成（実態）

リポジトリ名/README上は「TypeScript / React 19 / Vite / Tailwind 4 / TanStack Query / Drizzle / Wouter」だが、**実際にユーザーへ提供されているプロダクト（`artifacts/flowrev`）はこれらの多くを使っていない。**

| 項目 | ワークスペースcatalogの指定 | `artifacts/flowrev`（実プロダクト）の実際 |
|---|---|---|
| フレームワーク | Vite | **Next.js 14.2.35（App Router）** — `artifacts/flowrev/package.json` |
| React | 19.1.0 | **18.3.1** |
| Tailwind | v4 | **v3.4.14** |
| ルーティング | Wouter (catalog登録のみ) | Next.js file-based routing。**Wouterはリポジトリ全体でどこからも実際にimportされていない**（catalogに書かれているだけの死んだエントリ） |
| データ層 | Drizzle ORM | **Supabase JS Client + 手書きSQL migration**（`lib/db`のDrizzleスキーマは空のスキャフォールドで未使用） |
| API | (未指定) | Next.js Route Handlers（`app/api/**/route.ts`）+ Server Actions |

`replit.md`にも明記されている通り、これは意図的な判断（Next14+shadcnの安定性を優先し、ワークスペースcatalogから独立したpackage.jsonを持たせている）。

## ワークスペース構成

```
artifacts/
  flowrev/         ← 実プロダクト本体（Next.js 14）。Vercelにデプロイ済み
  api-server/       ← Express。ヘルスチェック(/healthz)のみの空スキャフォールド。Replit専用（/_apiserver配下）
  mockup-sandbox/   ← Vite + shadcn/uiのコンポーネント確認用キャンバス。Replit専用ツール、本番と無関係
lib/
  db/               ← Drizzle ORM設定一式はあるが、スキーマが空（export {} のみ）。誰もimportしていない
  api-spec/         ← OpenAPI定義（healthzのみ）+ Orval codegen設定
  api-zod/          ← Orval生成のZodスキーマ（healthzのみ）
  api-client-react/ ← Orval生成のTanStack Query hooks（healthzのみ）。どこからもimportされていない
scripts/            ← post-merge.sh（Replitのpostmergeフックから呼ばれる）、hello.tsのプレースホルダ
```

**重要な発見**: `lib/db`・`lib/api-spec`・`lib/api-zod`・`lib/api-client-react`・`artifacts/api-server`は、healthzエンドポイント以外では**実質使われていない並行アーキテクチャ**。実プロダクトはこれらを経由せず、`artifacts/flowrev`が直接Supabaseクライアントで完結している。今後この二重構造をどう扱うか（本採用して繋ぎ込むか、削除するか）は意思決定が必要。

## フロントエンド / バックエンドのエントリーポイント

- **flowrev**: `app/layout.tsx`（ルートレイアウト）→ `app/page.tsx`（ロールに応じて `/admin/dashboard` `/wl/dashboard` `/my` `/dashboard` へリダイレクト、`features/auth/role.ts`）。ルートグループ: `(auth)` `(dashboard)` `admin` `wl` `my` `p/[slug]`（公開LP）。APIは `app/api/**/route.ts`。
- **api-server**: `src/index.ts` → `app.listen(PORT)`。`src/app.ts`でExpressアプリを構築し、`/_apiserver`配下にマウント（`replit.md`によれば、flowrev自身の`/api/*`とReplitのプロキシ上で衝突しないための意図的な措置）。
- **mockup-sandbox**: `src/main.tsx` → `App.tsx`。ルーターは使わず`window.location.pathname`を手動パース。

## ビルド成果物 / 実行方法

| package | build | 出力 |
|---|---|---|
| `artifacts/flowrev` | `next build` | `.next/`（Vercel Next.jsプリセットがそのまま解釈） |
| `artifacts/api-server` | `node build.mjs`（esbuild） | `dist/index.mjs`（単一ESMバンドル） |
| `artifacts/mockup-sandbox` | `vite build` | `dist/` |
| `lib/*` | ビルドなし | TSソースを`exports`経由で直接消費（`customConditions: ["workspace"]`） |

ルート`package.json`の`build`スクリプトは `typecheck && pnpm -r --if-present run build` で、**typecheckが1つでも失敗すると後続のbuildは一切実行されない**（後述の「起動・ビルド確認」参照）。

## 開発用と本番用の違い

- **flowrev**: Replitのプレビュー環境では、ポート検知の都合で`next dev`ではなく`next build && next start`が使われる（`replit.md`のGotchas、`.agents/memory/nextjs-replit-port-detection.md`）。本番はVercel（Node 20、`.nvmrc`）で、Replitの開発環境はNode 24（`.replit`）。
- **AI/メールプロバイダのAPIキーは環境変数ではなくDBに暗号化保存**（`ENCRYPTION_KEY`で AES-256-GCM、`lib/crypto.ts`）。管理画面から設定し、本部(HQ)キー→代理店(white label)キーの優先順位で解決される。
- デプロイ先が分裂している: **flowrevはVercel**（`vercel.json`あり、`framework: "nextjs"`）、**api-serverとmockup-sandboxはReplitの`.replit-artifact/artifact.toml`経由でReplit上でのみ稼働**。api-serverをVercelへ本当に出すのかは未決定（06参照）。

## データフロー（概略）

```
ブラウザ (client_owner管理画面 / customer会員サイト / 匿名LP訪問者)
   │
   ├─ Next.js Server Component / Server Action ─┐
   ├─ Next.js Route Handler (app/api/**)         │→ Supabase (Auth / Postgres+RLS / Storage)
   └─ Middleware (lib/supabase/middleware.ts) ────┘     └─ service_role client（RLSバイパス、lib/repositories/*一部）
                                                    → Anthropic Claude（LP文章/HTML生成）
                                                    → OpenAI DALL-E 3（画像生成）
                                                    → Stripe（決済、テナントごとの秘密鍵）
                                                    → Resend（メール送信）
                                                    → LINE Messaging API（送信のみ、受信Webhookなし）
                                                    → Cloudflare Stream（動画配信・署名付きURL）
```

## 外部連携ファイル一覧

| サービス | 主なファイル |
|---|---|
| Supabase | `lib/supabase/{client,server,admin,middleware,url}.ts`、`supabase/migrations/*.sql` |
| Anthropic | `lib/ai/client.ts`、`lib/ai/lp-design-system.ts` |
| OpenAI | `app/api/ai/generate-image/route.ts` |
| Stripe | `lib/stripe/client.ts`、`app/api/webhooks/stripe/route.ts` |
| LINE | `lib/line/client.ts`（送信のみ） |
| Resend | `lib/email/send-invite.ts`、`send-scenario-step.ts`、`send-unprotected-alert.ts` |
| Cloudflare Stream | `lib/cloudflare/stream.ts`、`app/api/webhooks/cloudflare-stream/route.ts` |

## 起動・ビルド確認結果

実行環境: Node v22.22.2 / pnpm 10.33.0（リポジトリ側でのバージョン固定なし）

```bash
pnpm install     # ✅ 成功（10.1秒、857パッケージ）
pnpm run typecheck  # ❌ 失敗（exit 2）— artifacts/mockup-sandbox のみ
pnpm run build      # ❌ 未実行（typecheckで停止するため）
```

### typecheckの失敗原因

`artifacts/mockup-sandbox`のtypecheckが、shadcn/ui由来のコンポーネント（`command.tsx`、`drawer.tsx`、`input-otp.tsx`、`spinner.tsx`）で`@types/react`のバージョン不整合エラーを出して失敗する（`bigint`が`ReactNode`に代入不可、等）。**これは今回の変更に起因するものではなく、既存コードの型定義の不整合**（`node_modules`内に`@types/react@18.3.31`と`@types/react@19.2.0`が混在していることが原因と推測される）。

flowrev単体・api-server単体・scripts単体のtypecheckは問題なく通る:

```bash
cd artifacts/flowrev && pnpm run typecheck   # ✅ 成功（exit 0、エラーなし）
```

### buildの実行結果

ルートの`build`はtypecheckの失敗で連鎖的に止まるため、**flowrev単体で直接検証した**:

```bash
cd artifacts/flowrev && pnpm run build
# 1回目: Supabase環境変数未設定のため、静的プリレンダリング中にエラー（EXIT:1）
#   Error: Supabase の環境変数が未設定です: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
```

これは「コードのバグ」ではなく「この監査環境にSupabaseの認証情報がない」ことが原因と判断し、ダミーの環境変数を与えて再実行した:

```bash
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
ENCRYPTION_KEY=... NEXT_PUBLIC_APP_URL=... pnpm run build
# ✅ 成功（EXIT:0）。全56ページのプリレンダリングと`.next/`出力が完了。
```

**結論: flowrevのコード自体はビルド可能であり、Vercelへのデプロイを妨げるコード上の問題はない。** ルートの`pnpm build`が壊れて見えるのは、無関係な`mockup-sandbox`のtypecheckエラーが原因であり、これがCIやAgent向けの「ビルドが通らない」という誤った第一印象を生んでいる。

lint (`next lint`) は、`.eslintrc`が未作成のため対話プロンプト（Strict/Base選択）が出て非対話環境では失敗する。`next.config.mjs`では`eslint.ignoreDuringBuilds: true`のため本番ビルドはlintの影響を受けない。
