# 購入から会員サイトまでの受入確認

- **対象**: `flowrev-prod`（ref: `ntvjontoezepcbnbxhgg`）
- **実施日**: 2026-08-03
- **決済モード**: Stripe **テストモード（サンドボックス）**。本番キーでの実顧客決済は未実施。
- **記載方針**: メールアドレス・氏名・APIキー・Webhookシークレット・暗号化値は本書に記載しない。テナントIDとセッションIDの形式のみ示す。

---

## 1. 結論

| 導線 | 状態 |
|---|---|
| 有料購入（Stripe Checkout → Webhook → 購入確定 → `/my`） | ✅ **サンドボックスで一気通貫の成功を確認** |
| 無料登録（価格0 / 商品未紐付けLP → 招待 → `/my`） | ⚠️ **画面からの実行は未実施**。自動テストで分岐のみ検証（§5） |
| 再ログイン後の進捗保持 | ⚠️ **未実施**（§6） |
| 再招待（既存ユーザーへの2回目の招待） | ⚠️ **未実施**（§7） |

有料購入の検証中に、**購入者が `/my` に入れない本番影響のあるバグを1件発見**した。原因と修正は §3、既存データの復旧は `CUSTOMER_TENANT_REPAIR_REPORT.md` を参照。

---

## 2. 有料購入の実行結果（実施済み）

### 前提条件

| 項目 | 設定 |
|---|---|
| Stripe設定の解決階層 | **OEM（white_label）階層** — クライアント個別設定なし、OEM行にテストキーを設定 |
| 商品価格 | ¥100（Stripe のJPY最低課金額 ¥50 を上回る値） |
| Webhookエンドポイント | `https://<本番ドメイン>/api/webhooks/stripe` |
| 購読イベント | `checkout.session.completed` |

> ¥1 で作成した最初の商品は Stripe 側で `Amount must be at least ¥50` となり Checkout を作成できなかった。JPY の最低課金額に注意。

### 実行ステップと結果

| # | 手順 | 期待 | 結果 |
|---|---|---|---|
| 1 | 公開LP `/p/<slug>` のフォームから登録 | `customers` に行が作られ、Checkout URL が返る | ✅ `checkoutUrl` を受領 |
| 2 | Stripe設定の解決 | クライアント設定が無いのでOEM行が使われる | ✅ OEM階層のキーで Checkout 作成 |
| 3 | `purchases` の先行レコード | `payment_status = 'pending'` で作成 | ✅ 作成を確認 |
| 4 | テストカード `4242 4242 4242 4242` で決済 | Stripe 側で成功 | ✅ 成功 |
| 5 | Webhook 受信 | 署名検証を通過し 200 | ✅ Stripe ダッシュボードの配信ログで 200 |
| 6 | 購入確定 | `payment_status = 'paid'`、`paid_at` が入る | ✅ 両方更新済み |
| 7 | `payment_logs` | `event_type = 'checkout.session.completed'` が記録される | ✅ 記録あり |
| 8 | 招待メール | 購入者宛に届く | ✅ 届いた（§4のSMTP設定後） |
| 9 | 招待リンク → `/my` | 会員エリアが開く | ❌ → **§3のバグ**。修正・データ復旧後に ✅ |

確認に使ったSQL（結果に個人情報を含めない形）:

```sql
SELECT payment_status, paid_at IS NOT NULL AS paid_at_set, amount
FROM purchases
WHERE stripe_session_id = 'cs_test_...';
```

> `purchases` の状態列は `status` ではなく **`payment_status`**。

---

## 3. 検証で発見したバグ（修正済み）

### 症状

決済は成立し `payment_status = 'paid'` になるが、購入者が招待リンクからログインしても `/my` に入れない。

### 原因

`auth.users` へのINSERTは `on_auth_user_created` トリガーを起動し、トリガーは `raw_user_meta_data` を読んで `user_profiles` を作る。招待時のメタデータに `role` しか渡していなかったため、トリガーは **`client_id` が NULL の行**を作っていた。

その直後のアプリ側 upsert は `ignoreDuplicates: true` のため、**既に行が存在する場合は何もしない**。結果として `client_id` は NULL のまま残り、`/my` が必須とする `session.clientId` が得られなかった。

「upsert を書いてあるから大丈夫」に見えて、実際には一度も効いていないという形の失敗で、正常系のテストでは検出できない。

### 修正

`lib/repositories/customer-onboarding.ts` に `inviteCustomerWithTenant()` を新設し、有料・無料の両導線をここに集約した。

1. 招待メタデータに `client_id` / `white_label_id` / `display_name` を含める（トリガーが正しい行を作る）
2. 行が無い環境向けに upsert（`ignoreDuplicates: true` のまま）
3. **`.is("client_id", null)` を付けた UPDATE** で、テナント未設定の行だけを補正する
4. `customers.user_id` を認証ユーザーに紐付ける

3 の `.is("client_id", null)` は、**既に別テナントに属しているユーザーの所属を書き換えない**ためのガード。これが無いと、同じメールアドレスで別テナントのLPに登録した既存ユーザーが、後から登録したテナントへ移動してしまう。

`lib/repositories/customer-onboarding.test.ts`（8件）でこのガードを含めて検証している。

---

## 4. 認証メールリンクの問題（修正済み）

購入検証の副産物として、**この環境では認証メールのリンクが一度も機能していなかった**ことが判明した。段階的に3つの別問題があった。

| # | 症状 | 原因 | 対応 |
|---|---|---|---|
| 1 | リンク先が `localhost:3000` | Supabase の Site URL が未設定 | 本番URLを設定 |
| 2 | リンクを踏むとログイン画面に戻る | 既定のメールリンクは `#access_token=` の**URLフラグメント**を返す。フラグメントはサーバへ送信されないため、SSRのコールバックからは読めない | メールテンプレートを `token_hash` 方式に変更し、`app/auth/confirm/route.ts` で `verifyOtp()` を実行 |
| 3 | `email rate limit exceeded` | Supabase 組み込みメーラーの送信上限 | カスタムSMTPを設定 |

`app/auth/confirm/route.ts` では、`next` パラメータによるオープンリダイレクトを防いでいる:

```ts
const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
```

`//evil.example.com` を弾くための `!next.startsWith("//")` が要点。`app/auth/confirm/route.test.ts`（7件）で検証済み。

---

## 5. 無料登録（画面からは未実施）

画面操作は未実施だが、分岐の性質上こちらの方が事故が起きやすいため、**自動テストで押さえた**（`app/api/p/register/route.test.ts`、5件・本タスクで追加）。

| テスト | 目的 |
|---|---|
| 価格0の商品ならCheckoutを作らず登録を完了する | 無料商品が決済に回らない |
| 商品が紐付いていないLPでも登録を完了する | `product_id` が NULL のLPで落ちない |
| 招待にテナント情報を渡す | 無料登録者にも `client_id` / `white_label_id` が付く（§3の再発防止） |
| **Stripe未設定ならCheckoutを作らず拒否する** | 有料商品が無料で配布されない |
| **Webhookシークレット未設定なら拒否する** | 課金だけされて購入確定が起きない状態を作らない |

下2件が本質的に重要で、「決済に失敗したら無料フローへ流す」というフォールスルーは実装中に混入しやすく、正常系のテストでは絶対に検出できない。`app/api/p/register/route.ts` の該当ブロックは `price > 0` なら必ず return する構造にしてある。

**検証済みであること**: 上記のガードを意図的に無効化したところ、期待通り2件が失敗した。テストがガードの存在を実際に検出していることを確認済み。

### 画面から実施する場合の手順

1. 価格0の商品を紐付けたLP（または商品未紐付けLP）を公開する
2. 未登録のアドレスでLPフォームから登録する
3. `customers` に行が作られ、`user_profiles.client_id` にLPのテナントが入っていることを確認する

```sql
-- 個人情報を出さない確認クエリ
SELECT p.role, p.client_id, p.white_label_id
FROM user_profiles p
JOIN customers c ON c.user_id = p.id
WHERE c.client_id = '<client_id>'
ORDER BY p.created_at DESC
LIMIT 5;
```

4. `purchases` に行が作られていない（無料なので決済レコードは不要）ことを確認する

---

## 6. 再ログイン後の進捗保持（未実施）

### 手順

1. §2 で作成した購入者アカウントで `/my` にログインする
2. レッスンを1つ視聴し、進捗が記録されることを確認する
3. ログアウトし、再度ログインする
4. 進捗が保持されていることを確認する

### 注意

初回は招待リンク経由のセッションで、2回目以降はパスワードまたはマジックリンクでのログインになる。招待直後にパスワードを設定していない場合、2回目のログイン手段が無いため先にパスワード設定が必要。

---

## 7. 再招待の挙動（未実施）

既にアカウントを持つアドレスに対し、同じLPからもう一度登録した場合の挙動。

### 期待される挙動

- `customers` は `onConflict: "email,client_id"` + `ignoreDuplicates: true` のため重複行は作られない
- `inviteUserByEmail` は既存ユーザーに対してエラーを返す
- そのエラーは `console.warn` に留め、登録処理自体は成功として扱う（`route.ts` の設計）
- **既存ユーザーの `client_id` は書き換わらない**（§3 の `.is("client_id", null)` ガード）

### 手順

1. §2 または §5 で使ったアドレスで、同じLPからもう一度登録する
2. レスポンスが 200 であることを確認する
3. `user_profiles.client_id` が変わっていないことを確認する
4. `customers` の行数が増えていないことを確認する

**別テナントのLPから同じアドレスで登録するケースも併せて確認すること。** ここがテナント境界越えの最も現実的な経路。

---

## 8. 受入チェックリストの充足状況

### Checkout前

| 確認項目 | 状態 | 根拠 |
|---|---|---|
| 正しい商品名 | ✅ | `product_data.name` に商品名を渡す。実決済画面で確認済み |
| 正しい金額 | ✅ | `unit_amount: price`。¥100 で確認済み |
| 正しい通貨 | ✅ | `currency: "jpy"` 固定 |
| 対象クライアントのStripe設定 | ✅ | `getStripeClient(clientId)` |
| クライアント設定が無ければOEM設定 | ✅ | 実決済がOEM階層の設定で成立（§2） |
| OEM設定も無ければHQ設定 | ⚠️ 実環境未確認 | `settings-fallback.test.ts` で3階層を検証済み |
| Webhook Secret未設定時は決済開始を拒否 | ✅ 自動テスト | `route.test.ts`「Webhookシークレット未設定なら拒否する」 |
| Stripe設定未登録時に有料商品を無料登録しない | ✅ 自動テスト | `route.test.ts`「Stripe未設定ならCheckoutを作らず拒否する」 |

### Checkout後

| 確認項目 | 状態 | 根拠 |
|---|---|---|
| `purchases.payment_status = paid` | ✅ | 実決済後にSQLで確認（§2 手順6） |
| `customers.user_id` が設定される | ✅ | `inviteCustomerWithTenant()` 末尾のUPDATE |
| `user_profiles.role = customer` | ✅ | 招待メタデータ＋トリガー |
| `user_profiles.client_id` が正しい | ✅ | §3の修正後。復旧は `CUSTOMER_TENANT_REPAIR_REPORT.md` |
| `user_profiles.white_label_id` が正しい | ✅ | 同上 |
| 別OEM・別クライアントに紐付かない | ✅ 自動テスト | `.is("client_id", null)` ガード。`customer-onboarding.test.ts` で検証 |

### 会員サイト

| 確認項目 | 状態 |
|---|---|
| `/my` へログイン可能 | ✅（テナント復旧後） |
| 購入した商品・講座が表示される | ⚠️ 未確認 |
| 未購入商品は表示されない | ⚠️ 未確認 |
| レッスンが表示される | ⚠️ 未確認 |
| 進捗更新が可能 | ⚠️ 未確認 |
| ログアウト後の再ログインでも利用可能 | ⚠️ 未確認（§6） |

`/my` へのログイン成立までは確認済みだが、**その先のコンテンツ表示・進捗保存は未確認**。「購入した商品だけが見える」ことは、テナント境界とは別の権限境界であり、実画面での確認が必要。

---

## 9. 顧客データ不整合の件数

`CUSTOMER_TENANT_REPAIR_REPORT.md` に詳細を記載。要約のみ再掲する。

| 項目 | 件数 |
|---|---|
| 不整合（`role='customer'` かつ `client_id IS NULL`） | 1 |
| 自動補正できた件数 | 1 |
| `customers` 側にも所属が無い件数 | 0 |
| 手動確認が必要な件数 | 0 |
| 復旧後の残存不整合 | **0** |

該当はサンドボックス決済で作った検証用アカウント1件のみで、**実顧客への影響は無かった**。

---

## 10. 未実施項目の一覧

本書で「未実施」としたものは、いずれも本番環境のブラウザ操作またはメール受信を要し、この作業環境からは実行できない。

| 項目 | 節 | 代替検証 |
|---|---|---|
| 無料登録の画面操作 | §5 | 自動テスト5件で分岐を検証済み |
| 会員サイトのコンテンツ表示・進捗 | §8 | なし |
| 再ログイン後の進捗保持 | §6 | なし |
| 再招待の挙動 | §7 | `customer-onboarding.test.ts` で `.is("client_id", null)` ガードを検証済み |
| HQ階層へのフォールバック実決済 | §8 | `settings-fallback.test.ts` |
| 本番キーでの実顧客決済 | — | サンドボックスで一気通貫を確認済み |
