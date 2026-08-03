# 本番スキーマの実適用状況（Migration 0011〜0020）

- **対象環境**: `flowrev-prod`（ref: `ntvjontoezepcbnbxhgg`）、`flowrev-dev`（ref: `swqturmapwbkjkhzzbxe`）
- **確認日**: 2026-08-03
- **確認方法**: ファイル名ではなく、`information_schema` / `pg_indexes` / `pg_policies` による**実スキーマ照会**

---

## 1. 結論

**0011〜0019はprod・devとも適用済み。0020のみ未適用。** 棚卸しの過程で3件の欠落を発見し、いずれも適用済み。

| Migration | 内容 | 種別 | prod | dev |
|---|---|---|---|---|
| 0011 | AI設定のRLS修正 | RLS | ✅ | ✅ |
| 0012 | `plans.white_label_id` | 列 | ✅ | ✅ |
| 0013 | `clients.plan_id` | 列 | ✅ | ✅ |
| 0014 | LPデザイン列 | 列 | ✅ | ✅ |
| 0015 | LINE設定の階層フォールバック | 一意インデックス＋RLS | ✅ | ✅ |
| 0016 | Stripe設定の階層フォールバック | 一意インデックス＋RLS | ✅ | ✅ |
| 0017 | Cloudflare設定の階層フォールバック | 列＋一意インデックス＋RLS | ✅ | ✅ |
| 0018 | OEMオーナー向けAPI設定RLS | RLS | ✅ | ✅ |
| 0019 | ブランド列5本 | 列 | ✅ | ✅ |
| 0020 | `sender_name` 削除 | 列削除 | ⛔ **未適用** | ⛔ **未適用** |

| 発見した欠落 | 環境 | 状態 |
|---|---|---|
| `line_accounts` テーブル自体が存在しない（`add_line_support.sql` 未適用） | dev | 適用済み |
| Cloudflare関連テーブル一式が存在しない（基盤7本 未適用） | prod・dev | 適用済み |
| `0017` のテナント列・インデックスが未適用 | **prod のみ** | 適用済み |

最後の1件は、基盤7本と0017を1つのスクリプトにまとめて配布した際、prodで0017部分が適用されないまま残っていたもの。`/admin/white-labels` が落ちた PR #8 と同種の「コードが前提とする列がDBに無い」状態だった。

---

## 2. 実スキーマ確認結果

以下のクエリで確認（列を直接参照せず、未適用環境でもエラーで停止しない形）。

```sql
SELECT
  to_regclass('public.line_accounts')       IS NOT NULL AS t_line_accounts,
  to_regclass('public.cloudflare_settings') IS NOT NULL AS t_cloudflare,
  to_regclass('public.video_check_logs')    IS NOT NULL AS t_video_logs,
  (SELECT count(*) FROM pg_indexes WHERE tablename='line_accounts'
     AND indexname IN ('uq_line_accounts_wl','uq_line_accounts_hq')) AS m0015_index,
  (SELECT count(*) FROM pg_indexes WHERE tablename='stripe_accounts'
     AND indexname LIKE 'uq_stripe_accounts%') AS m0016_index,
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='cloudflare_settings' AND column_name='client_id') AS m0017_client_id,
  (SELECT count(*) FROM pg_indexes WHERE tablename='cloudflare_settings'
     AND indexname LIKE 'uq_cloudflare_settings%') AS m0017_index,
  (SELECT count(*) FROM pg_policies WHERE tablename='ai_provider_settings') AS m0018_ai_policy,
  (SELECT count(*) FROM pg_policies WHERE tablename='email_settings')       AS m0018_email_policy,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name='white_labels'
      AND column_name IN ('brand_favicon_url','support_email',
                          'company_name','terms_url','privacy_url')) AS m0019_列;
```

### 最終結果（2026-08-03 時点・修正適用後）

| 項目 | 期待 | prod | dev |
|---|---|---|---|
| `line_accounts` | true | ✅ | ✅ |
| `cloudflare_settings` | true | ✅ | ✅ |
| `video_check_logs` | true | ✅ | ✅ |
| 0015 index | 2 | ✅ 2 | ✅ 2 |
| 0016 index | 3 | ✅ 3 | ✅ 3 |
| 0017 `client_id` 列 | true | ✅ | ✅ |
| 0017 index | 3 | ✅ 3 | ✅ 3 |
| 0018 ai policy | 2 | ✅ 2 | ✅ 2 |
| 0018 email policy | 2 | ✅ 2 | ✅ 2 |
| 0019 列 | 5 | ✅ | ✅ |

0019の列数を5としているのは、`sender_name` を **PR #22 で削除**したため（下記 §5）。

### 0011〜0014

| Migration | 確認方法 | prod | dev |
|---|---|---|---|
| 0011 AI RLS修正 | `pg_policies` の `qual` が `true` でないこと | ✅ | ✅ |
| 0012 `plans.white_label_id` | 列の存在 | ✅ | ✅ |
| 0013 `clients.plan_id` | 列の存在 | ✅ | ✅ |
| 0014 LPデザイン列 | `landing_pages.design_style_name` の存在 | ✅ | ✅ |

---

## 3. 前提Migrationと適用順序

番号付きmigrationの前に、番号なしの基盤migrationが必要。

```
0001〜0010（コア）
  ↓
add_line_support.sql                      ← line_accounts を作る。0015の前提
  ↓
add_cloudflare_stream.sql                 ← cloudflare_settings と lessons の動画列
add_alert_emails_to_cloudflare_settings.sql
add_cron_timestamps_to_cloudflare_settings.sql
add_cloudflare_protect_logs.sql
add_error_details_to_protect_logs.sql      ← protect_logs の後でないと失敗
add_cloudflare_webhook_logs.sql
add_video_check_logs.sql                  ← ここまでが0017の前提
  ↓
0011 → 0012 → 0013 → 0014
  ↓
0015（LINE）/ 0016（Stripe）/ 0017（Cloudflare）  ← 相互に独立
  ↓
0018（WL向けRLS）
  ↓
0019（ブランド列） → 0020（sender_name削除）
```

**注意**: `add_error_details_to_protect_logs.sql` は `add_cloudflare_protect_logs.sql` が作るテーブルに列を足すため、順序を守る必要がある。

---

## 4. 冪等性について

**PR #10 以前、13ファイル・35個の `CREATE POLICY` に `DROP POLICY IF EXISTS` が無く、再実行できない状態だった。** 今回の棚卸しで Cloudflare 基盤7本を適用する際、全ファイルを手で冪等化してから適用する必要が生じた。

PR #10 でリポジトリ内の全migrationにガードを追加済み。以降は再実行しても `policy already exists` で停止しない。

---

## 5. 未適用項目

**0020（`sender_name` 削除）が prod・dev とも未適用。**

```sql
-- 適用前の確認（アプリはこの列を書き込んでいないため、通常は0件）
SELECT id, brand_name, sender_name FROM white_labels WHERE sender_name IS NOT NULL;

-- 適用
ALTER TABLE white_labels DROP COLUMN IF EXISTS sender_name;
```

コードは既にこの列を参照していない（PR #22マージ済み）ため、**適用は任意のタイミングでよい**。列が残っていても動作に影響しない。

値が入っていた場合は、内容を `email_settings.from_name` へ移してから削除すること。

---

## 6. ロールバック

| Migration | ロールバック方法 | 安全性 |
|---|---|---|
| 0011 | 旧ポリシーを再作成 | 安全（ポリシーのみ） |
| 0012・0013・0014・0019 | `ALTER TABLE ... DROP COLUMN` | **列に値が入っている場合はデータ損失** |
| 0015・0016・0017 | `DROP INDEX` + `DROP POLICY` | 安全（制約とポリシーのみ。列は0017のみ追加） |
| 0018 | `DROP POLICY` | 安全 |
| 0020 | 列を再追加（値は復元不可） | 値が無いため実質安全 |

0016は `stripe_accounts` に**初めて一意性制約を導入**したもの。ロールバックすると「1テナントに複数行」が再び可能になり、`.maybeSingle()` を使う読み取りが実行時エラーになりうる。

---

## 7. 適用時に失敗しうる条件

partial unique index の作成は、既存データに重複があると失敗する。

| Index | 失敗条件 |
|---|---|
| `uq_stripe_accounts_client` | 同一 `client_id` の行が2件以上 |
| `uq_stripe_accounts_wl` | `client_id IS NULL` で同一 `white_label_id` の行が2件以上 |
| `uq_stripe_accounts_hq` | `client_id`・`white_label_id` が共にNULLの行が2件以上 |
| `uq_line_accounts_*` | 同上（LINE） |
| `uq_cloudflare_settings_*` | 同上（Cloudflare） |

適用前に必ず重複を確認すること。今回は prod・dev とも該当テーブルが0行または1行だったため、いずれも問題なく適用できた。

---

## 8. バックアップ要否

今回適用した範囲（列追加・インデックス追加・ポリシー追加）は**すべて非破壊**で、既存行の値を変更しない。バックアップ無しで適用した。

**0020（列削除）は破壊的操作**にあたるため、適用前に §5 の確認クエリで値の有無を確かめること。

---

## 9. 手動で加えた変更

リポジトリ内のmigrationファイルと1対1で対応しない変更を、記録として残す。

| 変更 | 環境 | 理由 |
|---|---|---|
| `add_line_support.sql` の適用 | dev | 未適用のまま0015が前提としていた |
| Cloudflare基盤7本の適用 | prod・dev | 未適用のまま0017が前提としていた |
| 上記7本の冪等化（`DROP POLICY IF EXISTS` を手で追加） | 適用時のみ | PR #10 以前のファイルは再実行できなかった。リポジトリ側はPR #10で修正済み |
| 0017 の再適用 | prod | 基盤7本と同梱配布した際に0017部分が適用されていなかった |

いずれも DDL のみで、既存行の値は変更していない。

---

## 10. RLSポリシーの確認

| テーブル | ポリシー数 | 由来 |
|---|---|---|
| `ai_provider_settings` | 2 | 0011・0018 |
| `email_settings` | 2 | 0018 |
| `line_accounts` | 0015・0018 由来のポリシーを確認 | — |
| `stripe_accounts` | 0016・0018 由来のポリシーを確認 | — |
| `cloudflare_settings` | 0017・0018 由来のポリシーを確認 | — |

アプリは `service_role` クライアントで接続するため RLS はバイパスされる。**RLSは多層防御であって唯一の境界ではない**。テナント境界の一次的な担保はリポジトリ層のクエリ条件（`.eq("white_label_id", ...)` / `.is("client_id", null)`）であり、こちらは `lib/repositories/wl-tier-writes.test.ts`（11件）と `settings-fallback.test.ts`（9件）で検証している。

---

## 11. 未適用項目のまとめ

| 項目 | 状態 | 影響 | 対応 |
|---|---|---|---|
| 0020（`sender_name` 削除） | 未適用 | **無し。** コードはこの列を参照していない | §5 の確認後、任意のタイミングで適用 |

他に未適用のmigrationは無い。
