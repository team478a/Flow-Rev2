# 05. セキュリティ調査結果

全項目、実コード（`artifacts/flowrev`）を直接確認した上での報告。本監査ではCritical 2件・High 5件・Medium 7件・Low 4件を確認した。

---

## Critical

### C-1. Stripe Webhookの署名検証がスキップ可能（決済なりすまし・無料アクセス権取得）

- **問題**: `app/api/webhooks/stripe/route.ts:52-62`。クライアントが管理画面で`webhookSecret`を設定していない場合、`stripe.webhooks.constructEvent()`による署名検証を丸ごとスキップし、リクエストボディをそのまま正規のStripeイベントとして信用する（`event = eventData as unknown as Stripe.Event`）。`stripe-signature`ヘッダーは「存在するか」しかチェックされず、値の正当性は検証されない。
- **根拠**: `app/api/webhooks/stripe/route.ts:17-21`（ヘッダー存在チェックのみ）、`:52-61`（`if (settings.webhookSecret) { 検証 } else { スキップ }`）。`webhookSecret`はクライアントの任意設定項目（`lib/repositories/stripe-settings.ts`）であり、必須化されていない。
- **影響**: 攻撃者は`{"type":"checkout.session.completed","data":{"object":{"metadata":{"client_id":"<標的のclient_id>"},"customer_email":"attacker@evil.com"}}}`を偽の`stripe-signature`ヘッダー付きで送るだけで、支払いなしに`purchases`を`paid`にでき、さらに`admin.auth.admin.inviteUserByEmail()`（`route.ts:100-104`）が呼ばれて攻撃者のメールアドレスでcustomerアカウントが自動作成される＝**無料での有料コンテンツアクセス権取得・アカウント不正発行**。
- **再現条件**: 標的クライアントが`webhookSecret`未設定の状態（=デフォルト状態）。`client_id`はUUIDだが、対象LPのチェックアウトフロー経由で入手可能。
- **推奨修正**: `webhookSecret`が未設定の場合はイベントを**拒否**（400/503）する。「未設定時はスキップ」という分岐そのものを削除する。あわせて、クライアント作成時に`webhookSecret`設定を必須項目にするか、未設定クライアントのStripe決済機能自体を無効化する。
- **優先度**: 最優先（本番公開前に必須）。

### C-2. AI生成LPの管理画面プレビューが未サニタイズのHTMLをsame-originで実行する（管理者アカウント乗っ取りにつながるXSS）

- **問題**: LP編集画面の「新しいタブで開く」プレビュー機能（`features/lp/components/lp-html-editor.tsx:52-60`）が、エディタの生HTML（保存時サニタイズなし）を`Blob`化し`URL.createObjectURL`でsame-origin `blob:` URLとして新しいタブに開く。`blob:` URLは生成元と同一オリジン扱いになるため、埋め込まれた`<script>`はFlowRevアプリの認証済みセッション（Cookie等）と同じ権限で実行される。
- **根拠**: `features/lp/components/lp-html-editor.tsx:52-60`（プレビュー生成）。`features/lp/schema.ts:14`（`htmlContent`は`z.string()`のみでスクリプトタグの拒否なし）。保存時の`createLpAction`/`updateLpAction`（`features/lp/actions.ts`）にもサニタイズなし。公開ページ用の`sanitizeLpHtml`（`lib/sanitize.ts`）は`/p/[slug]`のレンダリング時にしか呼ばれておらず、管理画面のエディタ・プレビューには一切適用されていない。
- **影響**: (a) `client_owner`ロールのアカウント（正規・乗っ取られたものいずれも）が悪意あるHTMLを保存し「新しいタブで開く」を自分または他の管理者に踏ませることで、認証情報の窃取・不正操作が可能。(b) AIプロンプトインジェクション経由でClaudeが`<script>`を含むHTMLを生成した場合も同じ経路で発火しうる（AI出力に対するフィルタも存在しない）。
- **再現条件**: `client_owner`権限でLP編集画面にアクセスできること。
- **推奨修正**: 「新しいタブで開く」プレビューを`sandbox`属性付きiframe（`allow-scripts`なし、または別オリジンのプレビュー専用ドメイン）に変更する。加えて、保存時にも`sanitizeLpHtml`相当の処理を通す（多層防御）。
- **優先度**: 最優先。

---

## High

### H-1. `/api/admin/scenarios/execute` にロールチェックがなく、最も権限の低い顧客アカウントが全テナントへの一斉送信を強制実行できる

- **根拠**: `app/api/admin/scenarios/execute/route.ts:19-27`はログイン済みかどうかしかチェックせず、`role === 'system_admin'`等の確認がない。`listPendingDueLogs()`（`lib/repositories/scenario-execution.ts:66-73`）はservice_roleクライアントで`scenario_logs`を`status='pending'`のみでフィルタし、**テナント条件が一切ない**。`?force=true`クエリで遅延スケジュールも無視できる。
- **影響**: `role='customer'`の一般顧客アカウントでも、`POST /api/admin/scenarios/execute?force=true`を叩くだけで、**全代理店・全クライアントの未送信フォローメール/LINEメッセージを今すぐ全部送信させられる**。スパム的被害・他テナントの顧客への意図しない配信・LINE送信コストの不正消費につながる。
- **推奨修正**: `app/api/admin/video/protect-all/route.ts`と同様の`session.role !== "system_admin"`チェックを追加する。`middleware.ts`は`/api/admin/*`をカバーしないため、Route Handler側で必ず個別にチェックする必要がある。
- **優先度**: 高（Critical相当に近い。次の修正スプリントで即対応）。

### H-2. レート制限が一切実装されていない

- **根拠**: ログイン(`features/auth/actions.ts`)・パスワードリセット・AI生成系4エンドポイント(`app/api/ai/*`)いずれにもアプリケーション側の回数制限がない。`rate_limits`テーブルは`0004_payments.sql`で定義済みだが、アプリコードのどこからも参照されていない（実装未着手のまま放置）。
- **影響**: (a) ログイン・パスワードリセットへのブルートフォース/クレデンシャルスタッフィング攻撃。(b) `customer`ロールを含む任意の認証済みユーザーが`/api/ai/generate-image`（DALL-E 3、課金対象）を無制限に呼び出せ、HQ共有のOpenAI/Anthropic請求を膨らませられる。
- **推奨修正**: 既存の`rate_limits`テーブルを使うか、Vercel KV/Upstash等で、認証系はIP+メール単位、AI生成系はユーザー単位のトークンバケット制限を実装する。
- **優先度**: 高。

### H-3. `CRON_SECRET`/一部Webhookの署名検証が「未設定なら検証スキップ」というフェイルオープン設計

- **根拠**: `app/api/admin/cron/check-unprotected-videos/route.ts:34-47`は`CRON_SECRET`が未設定だと認証チェックのブロック自体がスキップされる。加えてこのパスは`middleware.ts`の`PUBLIC_PREFIXES`に含まれ、ログインすら不要。同様に`app/api/webhooks/cloudflare-stream/route.ts`もシークレット未設定&`NODE_ENV!=='production'`の場合に検証をスキップする。
- **影響**: 本番環境で環境変数の設定漏れが起きると、無条件でCloudflare APIの呼び出しやメール送信を誰でもトリガーできてしまう（コスト濫用・情報の一部露出）。「開発時のみ許容」という設計意図がコード上で強制されておらず、設定忘れという典型的なヒューマンエラーがそのまま本番の穴になる。
- **推奨修正**: 本番(`NODE_ENV==='production'`)では該当シークレットが未設定なら**起動時にエラーで落とす**（フェイルクローズ）。開発時のみ明示的にスキップを許可する。
- **優先度**: 高。

### H-4. LP生成の参照URLスクレイピングにSSRF対策がない

- **根拠**: `app/api/ai/generate-lp/route.ts:20-37`の`fetchReferenceText()`は、ユーザー入力の`referenceUrl`に対し`new URL()`での構文チェックのみでサーバーサイドfetchを実行する。プライベートIP・localhost・クラウドメタデータエンドポイント（`169.254.169.254`等）へのアクセスを防ぐアローリスト/ブロックリストが存在しない。
- **影響**: 認証済みユーザー（`customer`ロールでも可、ロールチェックなし）が内部ネットワークやメタデータエンドポイントへの到達性を調査したり、取得結果をLPコンテンツとして間接的に持ち出したりできる可能性がある（デプロイ先の実際のネットワーク構成に依存）。
- **推奨修正**: プライベートIPレンジ・`localhost`・非`http(s)`スキームをブロックするアローリストを`fetchReferenceText`に追加する。
- **優先度**: 高。

### H-5. `email`(File type)/画像アップロードがクライアント申告のMIMEタイプのみで検証されている

- **根拠**: `lib/storage.ts:8-9,13-15,35,98`。`isAllowedMime()`はブラウザ/クライアントが送ってきた`File.type`文字列を信用しているだけで、ファイルのマジックバイトを検証していない。`app/api/lp/upload-image/route.ts`はcurl等での直接アクセス時、任意のバイト列に`image/png`ラベルを付けて公開バケット`lp-images`にアップロードできる。
- **影響**: 画像に偽装した任意ファイルの公開ホスティング（フィッシング・マルウェア配布・コンテンツタイプ混同攻撃の踏み台）。
- **推奨修正**: サーバー側でファイル先頭バイトのシグネチャ検証を行い、可能であれば信頼できる画像ライブラリでの再エンコードを挟む。
- **優先度**: 中〜高。

---

## Medium

### M-1. マイグレーション管理が手作業かつ矛盾ファイルが残存（詳細は04参照）

重複・矛盾するSQLファイル、`prod_setup.sql`とのスキーマドリフトが存在し、手順ミスによる本番スキーマ破損リスクがある。

### M-2. CSRF対策が明示的に実装されていない

- **根拠**: `csrf`/`xsrf`関連コードなし。Cookieの`sameSite`も明示設定されておらずライブラリのデフォルト（Lax想定）任せ。Next.js Server Actionsは組み込みのOrigin検証があるが、`app/api/**`のRoute Handlerにはない。
- **影響**: 現状は`SameSite=Lax`のデフォルト挙動により大半のPOST型CSRFは緩和されているが、明示設定ではないため将来のライブラリ更新で挙動が変わるリスクがある。`app/api/customers/export`はGETで状態変更を伴わないが、クロスサイトの強制ダウンロード（confused deputy）の余地がある。
- **推奨修正**: Cookieオプションで`sameSite`を明示指定し、状態変更系Route HandlerにOrigin/Refererチェックを追加する。

### M-3. エラーレスポンスが内部情報（DBの制約名・カラム名等）を返却している

- **根拠**: 13以上の`app/api/**/route.ts`および`lib/repositories/*.ts`が`error.message`をそのままクライアントに返している（例: `lib/repositories/landing-pages.ts`）。PostgREST/Postgresのエラーメッセージには制約名・テーブル名が含まれる。
- **影響**: 攻撃の下調べ（スキーマ推測）に利用されうる。
- **推奨修正**: クライアントには汎用エラーメッセージを返し、詳細はサーバーログにのみ出力する。

### M-4. PIIがログに平文出力されている

- **根拠**: `app/api/webhooks/stripe/route.ts:127-129`、`app/api/p/register/route.ts:196`で顧客メールアドレスを`console.warn`に直接出力。
- **影響**: ログ基盤へのアクセス権を持つ運用者・第三者ログSaaSに顧客メールが露出する。
- **推奨修正**: メールアドレスの代わりにユーザーID等をログに出す。

### M-5. `ai_provider_settings`テーブルのRLSポリシーが実質無条件許可（`USING (TRUE)`）

- **根拠**: `0008_ai_rls.sql`（詳細は04参照）。ポリシー名は「system_admin専用」だが実際の条件式にロールチェックがない。
- **影響**: 現状はservice_roleクライアント経由アクセスのみのため実害はないが、将来anonキー経由コードが追加された際に即座に穴になる潜在的リスク。
- **推奨修正**: `USING (get_user_role() = 'system_admin')`へ修正する。

### M-6. 招待受諾フローでの既存アカウント役割の無条件上書き（詳細は04参照）

同一メールアドレスへの再招待時、既存の`auth.users`/`user_profiles`を無条件に新しい役割・テナントで上書きしてしまう。

### M-7. `courses-public.ts`の`listPublishedLessons()`がテナント条件なしでservice_roleクエリを実行している（現状は後続の`notFound()`チェックで実害なし、詳細は04参照）

潜在的なIDORの罠として、将来の改修時に注意が必要。

---

## Low

### L-1. `api-server`のCORS設定がワイルドカード（`cors()`オプションなし）

現状`/healthz`しか公開していないため実害はないが、将来認証付きエンドポイントを追加する際は明示的なオリジン許可リストに変更する必要がある（`artifacts/api-server/src/app.ts:28`）。

### L-2. LP公開ページの`<style>`タグがサニタイザーによって丸ごと除去され、AIデザインシステムが機能していない

- **根拠**: `lib/sanitize.ts`の`sanitize-html`設定は`allowedTags`に`style`を含めていない（デフォルトの`nonTextTags`挙動でタグごと中身も削除）。結果として`/p/[slug]`で公開されたLPは、AIが生成したCSSデザインがすべて失われ、ほぼ無装飾のHTMLとして表示される。
- **注記**: これはセキュリティ上は正しい挙動（`<style>`ベースのインジェクション対策として機能している）だが、**機能不全のバグ**でもある。将来「直そう」として`style`タグを許可リストに追加すると、C-2と同種のリスクを公開ページ側にも持ち込むことになるため、修正時はCSSをアプリ側が所有する固定スタイルシートとして扱う（AI生成HTMLの外に出す）方式を推奨する。

### L-3. LINE Webhook・LINE署名検証は「存在しない」（実装時に要対応）

現状LINE受信機能自体が未実装のため脆弱性としては該当しないが、実装時はCloudflare Stream Webhook（`app/api/webhooks/cloudflare-stream/route.ts:127-148`、HMAC-SHA256 + `timingSafeEqual`で正しく実装済み）を参考実装として使うべき。

### L-4. `stripe-replit-sync`は実体が存在しない

セキュリティ上の懸念事項ではないが、`pnpm-workspace.yaml`の死んだ参照として03で扱った。

---

## 確認された「問題なし」項目（参考）

- クライアントサイドへの秘密鍵露出（`NEXT_PUBLIC_*`経由）: **なし**。
- Supabase service_role keyのクライアント露出: **なし**（`server-only`ガード済み）。
- SQLインジェクション: Drizzleは未使用、実際のクエリはすべてSupabase JSクライアント（PostgREST）経由でパラメータ化されており、生SQL文字列結合は確認されなかった。
- `/api/p/register`（匿名公開エンドポイント）のテナントID解決: LPレコードから逆引きしており、クライアントが`client_id`を偽装する余地はない。
