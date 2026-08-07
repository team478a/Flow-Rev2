# Phase 2 本番受入確認

- **ブランチ**: `chore/phase2-production-acceptance`
- **基準コミット**: `3bf43c4`（PR #22 マージ後の `main`）
- **確認日**: 2026-08-03
- **記載方針**: 本番APIキー・暗号化値・顧客メールアドレス・決済情報は記載しない。

---

## 1. 判定

**Phase 2 は「実装完了」だが「本番利用可能」とはまだ判定できない。**

コード側の不具合は本タスクで1件発見・修正し、自動検証（typecheck / test 70件 / build）はすべて成功している。判定を保留する理由は、**残る確認項目が実ブラウザ・実メール受信・Supabase Dashboard を要し、この作業環境から実行できない**ことにある。実行できない項目は憶測で埋めず、手順を添えて未実施として残した。

Phase 3a への可否判断は `PHASE3A_READINESS_DECISION.md` を参照。

---

## 2. 受入項目と結果

凡例: ✅ 実環境で確認済み ／ 🧪 自動テストで検証済み（実環境未確認） ／ ⚠️ 未実施 ／ 🔧 本タスクで修正

| # | 受入項目 | 結果 | 詳細 |
|---|---|---|---|
| 1 | 認証メールのテンプレート管理 | ✅ 🔧 | **管理画面へ移設**（PR #25）。Supabase側のテンプレートは不使用に |
| 2 | 同（Magic Link） | ⚠️ | アプリからは送っていない。ダッシュボード送信のみ |
| 3 | 同（Confirm signup） | — | 自己サインアップが無いため未使用 |
| 4 | Site URL / Redirect URLs | ✅ prod / ⚠️ dev | prodは `localhost:3000` から本番URLへ修正済み |
| 5 | 招待メールからの認証 | ✅ | `/auth/confirm` で `token_hash` を検証し `/my` へ着地 |
| 6 | Magic Link 認証 | ⚠️ | 修正前の失敗は確認済み。修正後は未テスト |
| 7 | パスワードリセット | ✅ 🔧 | **原因3件を修正し、一気通貫で成功**（PR #23・#24・#25） |
| 8 | Stripeテスト購入 | ✅ | OEM階層の設定で Checkout → 決済成立 |
| 9 | Webhook受信・署名検証 | ✅ | Stripe配信ログで 200 |
| 10 | `purchases.payment_status = paid` | ✅ | `paid_at` も設定 |
| 11 | 顧客テナント所属 | ✅ 🔧 | **購入者が `/my` に入れない不具合を修正済み**（PR #15） |
| 12 | `/my` へログイン可能 | ✅ | テナント復旧後 |
| 13 | 購入商品の表示・レッスン・進捗 | ⚠️ | ログイン成立までは確認。その先は未確認 |
| 14 | 無料登録導線 | 🧪 | 画面操作は未実施。分岐は自動テスト5件で検証 |
| 15 | OEMブランドが顧客画面まで反映 | 🧪 | コードレベルで確認。目視未確認 |
| 16 | 未設定OEMのFlowRev既定表示 | 🧪 | フォールバック実装を確認。目視未確認 |
| 17 | Migration 0019 | ✅ | 5列とも prod・dev に存在 |
| 18 | Migration 0020 | ⚠️ | **未適用**。コードは当該列を参照しないため影響なし |
| 18-B | Migration 0021（認証メールテンプレート） | ✅ | prod適用済み。テーブル/インデックス2/ポリシー2を確認 |
| 19 | 顧客データ不整合の件数確認 | ✅ | 1件検出 → 1件補正 → 残0件 |
| 20 | OEM API設定画面の回帰 | 🧪 | 越境防止を自動テスト11件で検証。目視未確認 |
| 21 | Cloudflare未設定時の安全な失敗 | 🧪 | — |
| 22 | typecheck | ✅ | 成功 |
| 23 | test | ✅ | 70件成功 |
| 24 | build | ✅ | 成功 |

---

## 3. 本タスクで発見・修正した不具合

### パスワードリセットのリンク先が存在しないURLを指していた

`features/auth/actions.ts` の `redirectTo` が `next=/auth/update-password` を指していた。新パスワード設定画面の実体は `app/(auth)/update-password/page.tsx` にあり、`(auth)` は **Next.js のルートグループなのでURLには現れない**。正しいURLは `/update-password`。

メール送信処理はエラーにならず `token_hash` の検証も成功するため、**リンクを踏んだ利用者だけが404に出会う**。ビルド出力のルート一覧でも `/update-password` として出力されており、`app/auth/` 配下にあるのは `callback` と `confirm` のみ。

修正内容と再発防止テストは `AUTH_EMAIL_TEMPLATE_CONFIGURATION.md` §4。

---

## 4. 自動検証

```
pnpm --filter @workspace/flowrev run typecheck   → 成功
pnpm --filter @workspace/flowrev run test        → 9ファイル / 70件 成功
pnpm --filter @workspace/flowrev run build       → 成功
```

### テスト件数の増減

指示書の基準は62件。現在70件で **+8件**。

| 追加 | 件数 | 理由 |
|---|---|---|
| `app/api/p/register/route.test.ts` | +5 | 無料登録のテナント紐付けと、有料商品のfail closed（Stripe未設定・Webhookシークレット未設定で拒否）を検証 |
| `features/auth/actions.test.ts` | +3 | §3 の不具合に対する回帰テスト |

減少は無い。

### 変異検証

追加した各テストは、**実装を意図的に壊して失敗することを確認済み**。

| 壊した箇所 | 失敗したテスト |
|---|---|
| `route.ts` のStripe fail closedガードを無効化 | 2件（Stripe未設定／Webhookシークレット未設定） |
| `redirectTo` を `/auth/update-password` に戻す | 1件（next が実在するページを指している） |

いずれも確認後に元へ戻し、`git diff` が空であることを確認した。

### ローカルビルドの注意

`next build` は Supabase の環境変数が無いと静的生成の段階で失敗する（`/`、`/api/customers/export`、`/api/admin/video/unprotected-count`）。これはビルド時にプレースホルダ値を与えると解消するため、**コードの問題ではなく環境変数の問題**。Vercel側では設定済みのため影響しない。

---

## 5. 未実施項目と実施手順

この作業環境からは、Supabase Dashboard・実ブラウザ・メール受信を伴う操作を実行できない。以下は手順を添えて各文書に残した。

| 項目 | 手順の記載先 |
|---|---|
| dev環境のメールテンプレート／URL設定 | `AUTH_EMAIL_TEMPLATE_CONFIGURATION.md` §3 |
| Magic Link の再テスト | 同 §5.2 |
| パスワードリセットのテスト（修正のデプロイ後） | 同 §5.3 |
| 無料登録の画面操作 | `PURCHASE_TO_MEMBER_ACCEPTANCE.md` §5 |
| 再ログイン後の進捗保持 | 同 §6 |
| 再招待の挙動（別テナント含む） | 同 §7 |
| OEMブランドの目視確認 | `OEM_BRANDING_ACCEPTANCE.md` §5 |
| Migration 0020 の適用 | `PRODUCTION_SCHEMA_STATE.md` §5 |

---

## 6. 仕様判断が必要な項目（コードは変更していない）

| 項目 | 内容 |
|---|---|
| `/wl`・`/dashboard` のフッター | 会社名・問い合わせ先・規約は `/my` にしか出ない。管理画面にも必要か |
| Confirm signup テンプレート | 現在の導線は招待中心。自己サインアップを開放するかどうか |
| OEM別CloudflareアカウントのWebhook分離 | 未設計。`PHASE3A_READINESS_DECISION.md` §3 |

---

## 7. 成果物

```
docs/verification/
├─ PHASE2_PRODUCTION_ACCEPTANCE.md        ← 本書
├─ AUTH_EMAIL_TEMPLATE_CONFIGURATION.md
├─ PURCHASE_TO_MEMBER_ACCEPTANCE.md
├─ OEM_BRANDING_ACCEPTANCE.md
├─ PRODUCTION_SCHEMA_STATE.md
├─ PHASE3A_READINESS_DECISION.md
└─ CUSTOMER_TENANT_REPAIR_REPORT.md       ← 顧客テナント復旧の詳細記録
```
