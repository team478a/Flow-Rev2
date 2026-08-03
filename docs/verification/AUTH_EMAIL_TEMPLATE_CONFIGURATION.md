# 認証メールテンプレートとURL設定

- **対象**: `flowrev-dev`（ref: `swqturmapwbkjkhzzbxe`）／ `flowrev-prod`（ref: `ntvjontoezepcbnbxhgg`）
- **確認日**: 2026-08-03
- **記載方針**: APIキー・SMTP認証情報・テストユーザーのメールアドレスは記載しない。ドメイン名のみ記載する。

---

## 1. 結論

| 項目 | prod | dev |
|---|---|---|
| Site URL | ✅ 本番URLに修正済み | ⚠️ 未確認 |
| Invite user テンプレート（`token_hash`方式） | ✅ 変更済み・動作確認済み | ⚠️ 未確認 |
| Magic Link テンプレート | ✅ 変更済み | ⚠️ 再検証が必要（§5） |
| Reset Password テンプレート | ⚠️ 未確認 | ⚠️ 未確認 |
| Confirm signup テンプレート | ⚠️ 未確認 | ⚠️ 未確認 |
| カスタムSMTP | ✅ 設定済み | ⚠️ 未確認 |

**本作業環境からは Supabase Dashboard にアクセスできない**ため、上表のうち ✅ はこのセッション中に利用者が実施し結果を報告した項目、⚠️ は未確認項目である。⚠️ の項目については §3 に実施手順を示す。

加えて、**パスワードリセット導線にコード側の不具合を発見し修正した**（§4）。テンプレートを正しく設定してもリセットは完了できない状態だった。

---

## 2. なぜ `token_hash` 方式が必要か

Supabase の既定のメールリンク（`{{ .ConfirmationURL }}`）は、トークンを **URLフラグメント** (`#access_token=...`) で返す。

フラグメントはブラウザがサーバーへ送信しない。FlowRev は SSR 構成で、セッションCookieの発行は Route Handler（サーバー側）で行うため、**サーバーからはトークンを読み取れない**。結果、リンクを踏んでもセッションが確立されずログイン画面に戻る。

実際にこの環境では、招待メール・マジックリンクの双方でこの症状が出ていた。

`{{ .TokenHash }}` はクエリ文字列で渡されるためサーバーで受け取れる。`app/auth/confirm/route.ts` が `verifyOtp({ type, token_hash })` を実行してCookieを発行する。

```ts
const tokenHash = searchParams.get("token_hash");
const type = searchParams.get("type") as EmailOtpType | null;
if (!tokenHash || !type) return NextResponse.redirect(`${origin}/login?error=invalid_link`);
const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
if (error) return NextResponse.redirect(`${origin}/login?error=link_expired`);
```

`/auth/callback`（`?code=` を交換するPKCE用）は OAuth 等で使う可能性があるため残してある。

---

## 3. 設定手順（未確認環境で実施すること）

### 3.1 URL Configuration

`Authentication → URL Configuration`

| 項目 | 設定値 |
|---|---|
| Site URL | 本番FlowRevのURL（`localhost:3000` のままにしない） |
| Redirect URLs | 本番URL＋`/auth/confirm` を含むパターン。Preview環境を使う場合はそのURLも登録 |

Redirect URLs には少なくとも以下を登録する。

```
https://<本番ドメイン>/**
```

`redirectTo` に渡す値が Redirect URLs に一致しない場合、Supabase は Site URL へフォールバックする。この挙動が原因で `next` が失われ、認証はできてもログイン画面に着地することがある。

### 3.2 メールテンプレート

`Authentication → Email Templates`

**Invite user**

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite">
  アカウントを有効化する
</a>
```

**Magic Link**

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink">
  ログインする
</a>
```

**Reset Password**

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">
  パスワードを再設定する
</a>
```

**Confirm signup**

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup">
  メールアドレスを確認する
</a>
```

`&` を使うのは、アプリが渡す `redirectTo` に既にクエリ文字列が含まれているため。

| 送信元 | `redirectTo` |
|---|---|
| 購入者・LP登録者の招待 | `<origin>/auth/confirm?next=/my` |
| パスワードリセット | `<origin>/auth/confirm?next=/update-password` |

**ダッシュボードから手動送信した場合、`RedirectTo` が空になる。** その場合は `&` の連結が壊れるため、手動送信を使う運用があるなら `SiteURL` 方式に切り替える。

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">
  ログインする
</a>
```

テンプレートに秘密情報を書かないこと。

### 3.3 カスタムSMTP

組み込みメーラーには送信上限があり、検証中に `email rate limit exceeded` に到達した。実運用では `Authentication → Emails → SMTP Settings` で自前のSMTPを設定する。

---

## 4. パスワードリセット導線の不具合（本タスクで発見・修正／2件）

### 4-0. PKCEに紐付いたトークンは `verifyOtp` で検証できない

**症状**: テンプレートを `token_hash` 方式に変更し、Site URL・Redirect URLs も正しく設定した状態で、パスワードリセットのリンクを踏むと `/login?error=link_expired` になる。何度送り直しても、別のメールアドレスに送っても同じ。招待メールは同じ仕組みで成功する。

**原因**: インストール済みライブラリの実装で確認した。

1. `@supabase/ssr` の `createServerClient` は **`flowType: "pkce"` を固定で設定する**
   （`dist/main/createServerClient.js`）
2. PKCEのとき `resetPasswordForEmail` は `code_challenge` をSupabaseへ送る
   （`GoTrueClient.js` の `resetPasswordForEmail`）
3. その結果Supabaseは**PKCEに紐付いたトークン**を発行し、メールの `{{ .TokenHash }}` もそれになる
4. ところが `verifyOtp` は `POST /verify` に `{ type, token_hash }` を送るだけで、
   **`code_verifier` を一切送らない**（`GoTrueClient.js` の `verifyOtp` にPKCE分岐が存在しない）

したがって、PKCEで発行されたトークンは `/auth/confirm` で**構造的に検証できない**。リンクが新しかろうが、何度送り直そうが必ず失敗する。

**招待メールだけが動いていた理由**: `inviteUserByEmail` は `service_role` の管理クライアント（`createAdminClient`）経由で呼ばれる。こちらは `@supabase/ssr` を通らないためPKCEが働かず、`{{ .TokenHash }}` が通常のトークンになる。**同じ `token_hash` 方式なのに招待だけ成功しリセットだけ失敗する**という切り分けにくい差は、ここから出ていた。

**修正**: `lib/supabase/email-auth.ts` を新設し、認証メール送信専用の匿名クライアント（`flowType: "implicit"`、`persistSession: false`）を使う。`code_challenge` を送らなくなるため `{{ .TokenHash }}` は招待と同じ通常のトークンになり、`/auth/confirm` で検証できる。

```ts
return createSupabaseClient(normalizeSupabaseUrl(url), anonKey, {
  auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false },
});
```

セッションを発行しない送信専用の用途なので、Cookieの読み書きも不要になる。

**注意**: `/auth/callback`（`?code=` を `exchangeCodeForSession` で交換する）はPKCE用として残してある。今回の変更はパスワードリセットの送信経路のみに閉じている。

### 4-1. リンク先が存在しないURLを指していた

### 症状

パスワードリセットメールのリンクを踏むと、`token_hash` の検証は成功するが、**直後のリダイレクト先が404になる**。新しいパスワードを設定できない。

### 原因

`features/auth/actions.ts` の `redirectTo` が `next=/auth/update-password` を指していた。

新パスワード設定画面の実体は `app/(auth)/update-password/page.tsx` にある。`(auth)` は **Next.js のルートグループ**で、URLには現れない。したがって実際のURLは `/update-password` であり、`/auth/update-password` は存在しない。

`app/auth/` 配下にあるのは `callback` と `confirm` の2つのみ。ビルド出力のルート一覧でも `/update-password` として出力されている。

送信処理はエラーにならず、`/auth/confirm` の検証も成功するため、**リンクを踏んだ利用者だけが404に出会う**という形で表に出ない。

### 修正

```ts
redirectTo: `${origin}/auth/confirm?next=/update-password`,
```

### 再発防止

`features/auth/actions.test.ts`（3件・新規）を追加した。文字列を突き合わせるだけでは同じ誤りを書き写しかねないため、**`app` ディレクトリを走査して実在するURLを組み立て、`next` がその集合に含まれることを検証する**。ルートグループ `(...)` はURLに寄与しない、という規則もこの走査に含めている。

| テスト | 内容 |
|---|---|
| `/auth/confirm` を経由する | token_hash を検証できるルートを通っている |
| next が実在するページを指している | `app` から組み立てた実URL集合との突き合わせ |
| next が認証不要パスに含まれている | `middleware.ts` の `PUBLIC_PREFIXES` と照合。パスワードを忘れた利用者はログインできないため、遷移先が認証必須だと弾かれる |

**検証済み**: `next=/auth/update-password` に戻したところ「next が実在するページを指している」が失敗した。テストが不具合を実際に検出することを確認済み。

---

## 5. 認証リンクの受入テスト状況

### 5.1 招待メール — ✅ 実施済み（prod）

| 確認項目 | 結果 |
|---|---|
| ログイン画面へ戻らない | ✅ |
| `token_hash` が検証される | ✅ |
| `/my` へ移動する | ✅（`CUSTOMER_TENANT_REPAIR_REPORT.md` のテナント復旧後） |
| 再読み込み後もログイン状態を維持 | ⚠️ 未確認 |
| 使用済みリンクの再利用を拒否 | ⚠️ 実環境では未確認（自動テストで検証済み） |
| 期限切れリンクを拒否 | ⚠️ 実環境では未確認（自動テストで検証済み） |

使用済み・期限切れはいずれも `verifyOtp` がエラーを返し、`/login?error=link_expired` へ送られる。`app/auth/confirm/route.test.ts` の「期限切れ・使用済みのリンクはログイン画面へ戻す」で、**検証失敗時に `next` へ進ませない**ことを確認している。

### 5.2 Magic Link — ⚠️ 再検証が必要

テンプレート修正前に「メールは届くがリンクを踏むとログイン画面が表示される」症状が確認され、その後 `token_hash` 方式へ変更した。ただし**変更後にMagic Linkで再テストした記録がない**（再テストしたのは招待メール）。

以下は自動テストで検証済み：

| 確認項目 | 検証 |
|---|---|
| ロールに対応した画面へ遷移 | `next` 無しの場合 `roleHomePath()` へ送る |
| 外部URLへリダイレクトされない | `next=https://evil.example.net/...` を拒否 |
| `//example.com` 形式も拒否 | `!next.startsWith("//")` |

```ts
const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
```

`//evil.example.net` は `/` 始まりだがブラウザは外部ホストとして解釈するため、`!startsWith("//")` が要点。

### 5.3 パスワードリセット — ⚠️ 未実施

**§4 の不具合により、修正前は完了できなかった。** 修正をデプロイした上で以下を実施すること。

1. `/reset-password` からメールを送信する
2. リンクを踏み、`/auth/confirm` を経て `/update-password` に着地することを確認する
3. 8文字以上の新パスワードを設定する
4. `/login` から新パスワードでログインできることを確認する

---

## 6. 残る確認事項

| 項目 | 対応 |
|---|---|
| dev環境のテンプレート・URL設定 | §3 の手順で設定 |
| Magic Link の実環境再テスト | §5.2 |
| パスワードリセットの実環境テスト | §5.3（修正のデプロイ後） |
| Confirm signup テンプレート | 現在の導線は招待中心のため未使用の可能性が高い。自己サインアップを開放する場合は必須 |
| 再読み込み後のセッション維持 | 実ブラウザでの確認が必要 |
