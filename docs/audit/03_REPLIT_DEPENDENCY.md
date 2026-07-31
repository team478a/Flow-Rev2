# 03. Replit依存調査

## サマリー表

| # | 項目 | 分類 | Vercelへの影響 | 優先度 |
|---|---|---|---|---|
| 1 | `@replit/vite-plugin-cartographer` | Replit専用（`REPL_ID`存在時のみ動的import） | なし（mockup-sandbox限定、本番未使用） | 低 |
| 2 | `@replit/vite-plugin-dev-banner` | 削除可（catalogに登録のみでどこからも未使用） | なし | 低 |
| 3 | `@replit/vite-plugin-runtime-error-modal` | Vercelでも動作可（ただし無条件ロード） | なし（mockup-sandbox限定） | 低 |
| 4 | `stripe-replit-sync` | 削除可（`pnpm-workspace.yaml`の除外リストに名前だけ存在、実体は一切なし） | なし。実際のStripe実装は`stripe`パッケージによる自前Webhookハンドラで完全にポータブル | 低 |
| 5 | `REPL_ID` / `REPLIT_DOMAINS` | `REPL_ID`は無害。`REPLIT_DOMAINS`は**本番障害リスク** | 招待URL生成のフォールバックが機能しない（`NEXT_PUBLIC_APP_URL`必須化が必要） | **中〜高** |
| 6 | Replit Object Storage | 該当なし（Supabase Storageのみ使用） | — | — |
| 7 | Replit DB | 該当なし（`replit.md`で明示的に不使用方針） | — | — |
| 8 | Replit Secrets | 該当なし（標準`process.env`＋DB暗号化保存） | — | — |
| 9 | ハードコードされたReplit URL | ドキュメント内の例示のみ、実行コードなし | ドキュメント更新のみ | 低 |
| 10 | ポート設定（`PORT`/`0.0.0.0`） | flowrevは無害（Vercelでは未使用）。**api-serverは長時間稼働サーバーでVercel非対応** | api-serverのホスティング方針が未決定 | **高**（api-serverを本当にVercelへ出すなら） |
| 11 | linux-x64限定の`overrides` | **本番障害・CI障害リスク** | Vercelのビルド環境自体はlinux-x64なので問題ないが、GitHub ActionsランナーやApple Silicon開発機では`pnpm install`が壊れる | **高** |
| 12 | `.replit` / `.replitignore` | 完全にReplit専用 | なし。`postMerge`フック（`pnpm --filter db push`）はGitHub Actionsで代替実装が必要 | 中 |
| 13 | `replit.md` | ドキュメント。Replit特有の運用ノウハウ（ポート検知回避、パッケージファイアウォール、`/api`vs`/_apiserver`ルーティング）を含む | 移行時の参照資料として保持 | — |

## 詳細

### 1〜3. Replit専用Viteプラグイン

3つとも**`artifacts/mockup-sandbox`（Replit Canvasのデザイン確認ツール）でのみ使用**され、本番プロダクト（`artifacts/flowrev`、Next.js）は一切関与しない。

- `@replit/vite-plugin-cartographer`: `artifacts/mockup-sandbox/vite.config.ts:37-46`で`NODE_ENV !== "production" && REPL_ID !== undefined`の場合のみ動的import。Replit外では自動的に無効化される安全な実装。
- `@replit/vite-plugin-dev-banner`: `pnpm-workspace.yaml`のcatalogに登録されているが、**どのpackage.jsonからも参照されておらず、完全に死んだエントリ**。削除して問題ない。
- `@replit/vite-plugin-runtime-error-modal`: `vite.config.ts:5,36`で無条件にロードされるが、Replit APIには依存しない汎用的なエラーオーバーレイなので、Vercel/ローカルでも実害はない。

**対応方針**: `mockup-sandbox`を今後も維持するなら現状のままで問題ない。維持しない（Replit専用ツールとして切り離す）なら、3つとも`pnpm-workspace.yaml`のcatalogと`mockup-sandbox/package.json`から削除できる。

### 4. `stripe-replit-sync`

リポジトリ全体で**`pnpm-workspace.yaml`の`minimumReleaseAgeExclude`リストに名前が載っているだけ**（`pnpm-workspace.yaml`）。package.json・lockfile・node_modulesのどこにも実体がなく、インポートしているコードも存在しない。実際のStripe連携は`stripe`（公式npmパッケージ）を使った自前実装（`lib/stripe/client.ts`、`app/api/webhooks/stripe/route.ts`）で完結しており、これは特にReplit依存を持たない。

**対応**: `minimumReleaseAgeExclude`から`stripe-replit-sync`の行を削除するだけでよい（死んだ参照の掃除）。

### 5. `REPLIT_DOMAINS` — 唯一の本番ロジックへの混入

`features/invitations/actions.ts:36-39,180-185`で、招待URLを生成する際に`NEXT_PUBLIC_APP_URL`が未設定の場合のフォールバックとして`REPLIT_DOMAINS`を参照している。Vercel上では`REPLIT_DOMAINS`は存在しないため、`NEXT_PUBLIC_APP_URL`を必ず設定しないと招待メールのURL生成がエラーになる。現状`.env.example`にも必須項目として記載されているため実運用上のリスクは限定的だが、コード上のフォールバック分岐自体は死んでいるので削除し、代わりに未設定時は即座にエラーを出す（fail fast）実装に変えるのが望ましい。

### 10. ポート設定・api-serverのホスティング問題

- `artifacts/flowrev`の`dev`/`serve`/`start`スクリプトは`-H 0.0.0.0 -p ${PORT:-3000}`を使うが、これはVercel上では使われない設定（Vercelは`next start`をそのまま呼ばない）ため無害。
- `artifacts/api-server/src/index.ts`は`process.env.PORT`が無いと即座に例外を投げる長時間稼働のExpressサーバーであり、**Vercelのサーバーレス実行モデルとは根本的に非互換**。現状`replit.md`によれば、api-serverはVercelデプロイの対象外（Replit上でのみ稼働）と位置付けられているため、これ自体は今すぐの障害要因ではない。ただし、**api-serverを将来どこで稼働させるか（Vercel Functionsへの書き直し／別ホスティング／廃止）の方針が未決定**であり、これを放置すると「あるのに動かしどころがないコード」が積み上がる。

### 11. linux-x64限定のパッケージオーバーライド（要注意）

`pnpm-workspace.yaml`の`overrides`セクションで、esbuild/lightningcss/@tailwindcss-oxide/rollup/@expo-ngrok-binの非linux-x64バイナリをすべて`"-"`（インストール禁止）にしている。コメントに明記の通り「replit uses linux-x64 only」という前提の最適化。

- **Vercelのビルドマシンはlinux-x64なので、Vercel単体では問題にならない。**
- しかし、**GitHub Actionsのデフォルトランナー（`ubuntu-latest`）もlinux-x64なので通常は問題ないが、`macos-latest`を使うジョブやApple Silicon（M1/M2/M3）の開発者ローカル環境では`pnpm install`自体が失敗する。** 今後Codex/Claude Code/人間の開発者がMac上で作業する可能性を考えると、これは中〜高優先度で見直すべき設定。

**対応方針**: GitHub Actionsを`ubuntu-latest`固定で運用するなら現状維持でも動くが、将来Macでのローカル開発を許容するなら、このoverridesブロックを緩和する必要がある（07移行計画で扱う）。

### 12. `.replit` / `.replitignore` / postMergeフック

`.replit`はデプロイターゲット（autoscale）、ポートマップ、Replit Agentの設定など完全にReplit専用の内容。削除して問題ない。ただし`[postMerge] path = "scripts/post-merge.sh"`が実行している`pnpm --filter db push`（Drizzleスキーマの自動適用）は、**マージ時に何かしらのDB同期を自動実行するという「実際の運用動作」**なので、GitHub Actions側で同等のステップ（DBマイグレーション適用ジョブ）に置き換える必要がある。

なお`scripts/post-merge.sh`の`pnpm --filter db`は、パッケージ名が`@workspace/db`であるため`--filter db`という指定が意図通りにマッチしない可能性がある（要検証）。いずれにせよ`lib/db`のDrizzleスキーマ自体が空なので、今この時点では実害はない。
