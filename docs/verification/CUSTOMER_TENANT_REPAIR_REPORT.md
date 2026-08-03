# 顧客テナント紐付けの点検と復旧

- **対象**: `flowrev-prod`（ref: `ntvjontoezepcbnbxhgg`）
- **実施日**: 2026-08-03
- **記載方針**: メールアドレス・氏名・ユーザーIDは本書に記載しない。件数と、影響したテナントの範囲のみ示す。

---

## 1. 背景

`user_profiles.client_id` が NULL のまま作られた `customer` ロールのユーザーは、`/my` が必須とする `session.clientId` を得られず、**会員エリアに一切入れない**。

原因と修正は `PURCHASE_FLOW_ACCEPTANCE_TEST.md` §3 を参照。要点は、招待時のメタデータにテナント情報が含まれておらず `on_auth_user_created` トリガーが NULL の行を作り、後続の upsert が `ignoreDuplicates: true` で何もしていなかったこと。

コード修正だけでは**既に作られてしまった行は直らない**ため、既存データの点検と復旧を行った。

---

## 2. 点検（Task A）

### 使用したクエリ

個人情報を返さず、件数と分布だけを見る形にした。

```sql
-- テナント未設定の customer ロールが何件あるか
SELECT count(*) AS orphan_count
FROM user_profiles
WHERE role = 'customer'
  AND client_id IS NULL;

-- そのうち customers 行から所属を特定できるものが何件あるか
SELECT count(DISTINCT p.id) AS recoverable_count
FROM user_profiles p
JOIN customers c ON c.user_id = p.id
WHERE p.role = 'customer'
  AND p.client_id IS NULL
  AND c.client_id IS NOT NULL;

-- customers 側の紐付け欠落（user_id が付いていない行）
SELECT client_id, count(*) AS unlinked
FROM customers
WHERE user_id IS NULL
GROUP BY client_id;
```

### 結果

| 項目 | 件数 |
|---|---|
| `client_id` が NULL の `customer` ロール | **1** |
| うち `customers` から所属を特定できたもの | **1** |
| 所属を特定できず手動判断が必要だったもの | **0** |

該当は §2 のサンドボックス決済で作成した検証用アカウント1件のみ。**実顧客への影響は無かった。** これは本番でまだ実決済を受け付けていないためで、検証を先に行ったことでバグが実害を出す前に捕捉できた形になる。

`customers.user_id` が NULL の行は、招待前の見込み客（LP登録のみでまだ認証ユーザーが無い状態）を含むため、NULL であること自体は異常ではない。今回は特定のテナントに偏った異常な件数は見られなかった。

---

## 3. 復旧（Task B）

### 方針

ユーザーの指示に従い、以下を厳守した。

- **既に `client_id` が入っているユーザーを上書きしない**
- **ユーザーを別テナントへ移動しない**
- 所属の根拠は `customers.client_id`（そのユーザーが実際に登録した先）に限る
- 根拠が無いものは自動で埋めず、手動判断へ回す

### 実行したSQL

```sql
UPDATE user_profiles p
SET client_id       = c.client_id,
    white_label_id  = c.white_label_id,
    updated_at      = now()
FROM customers c
WHERE c.user_id = p.id
  AND p.role = 'customer'
  AND p.client_id IS NULL          -- ← 既存の所属は絶対に触らない
  AND c.client_id IS NOT NULL;
```

`p.client_id IS NULL` が安全装置。この条件が無いと、`customers` 側に別テナントの行がある場合に既存ユーザーの所属を書き換えてしまう。

### 結果

| 項目 | 件数 |
|---|---|
| 更新された行 | **1** |
| 既存の所属が変更された行 | **0** |
| 手動判断へ回した行 | **0** |

復旧後、対象アカウントで `/my` にアクセスでき、購入済み商品が表示されることを確認した。

### 復旧後の確認

```sql
-- 0件になっていること
SELECT count(*) AS remaining_orphans
FROM user_profiles
WHERE role = 'customer' AND client_id IS NULL;
```

結果: **0件**。

---

## 4. 再発防止

| 層 | 対策 |
|---|---|
| コード | `inviteCustomerWithTenant()` に招待経路を集約。有料（Stripe Webhook）・無料（LP登録）の両方が同じ関数を通る |
| コード | 招待メタデータに `client_id` / `white_label_id` を含め、トリガーが最初から正しい行を作る |
| コード | `.is("client_id", null)` 付きUPDATEで補正。既存の所属は書き換えない |
| テスト | `lib/repositories/customer-onboarding.test.ts`（8件）— メタデータの内容、`ignoreDuplicates` の挙動、既存テナント保護、`customers.user_id` 紐付けを検証 |
| テスト | `app/api/p/register/route.test.ts`（5件・本タスクで追加）— 無料登録経路でもテナント情報が渡ることを検証 |
| テスト | `app/api/webhooks/stripe/route.test.ts`（9件）— 有料経路でのテナント紐付けを検証 |

いずれのテストも、**実装を意図的に壊して失敗することを確認済み**。テストが該当のガードを実際に検出していることを保証している。

---

## 5. 定期点検クエリ

同種の問題が再び発生していないかを確認するためのクエリ。個人情報を返さない。

```sql
SELECT
  (SELECT count(*) FROM user_profiles
     WHERE role = 'customer' AND client_id IS NULL)          AS orphan_profiles,
  (SELECT count(*) FROM purchases
     WHERE payment_status = 'paid'
       AND customer_id NOT IN (SELECT id FROM customers
                                WHERE user_id IS NOT NULL))  AS paid_without_account;
```

`paid_without_account` は「決済済みなのに認証ユーザーが紐付いていない購入」を示す。**招待メールの送信失敗はWebhookの成功に影響させない設計**（`route.ts` で例外を握りつぶす）のため、招待だけが落ちた場合はこのクエリでしか検出できない。0以外が出た場合は該当顧客への再招待が必要。
