-- ============================================================
-- FlowRev DB Migration 0016: stripe_accounts のクライアント→WL→HQ フォールバック対応
-- 前提: 0001〜0014 および 0015_line_accounts_wl_fallback.sql を実行済み
-- 決済に関わるテーブルのため、適用前に必ず重複行の有無を確認すること
-- （PRのdev検証手順を参照）。
-- ============================================================

-- stripe_accounts には元々 client_id・white_label_id 双方に一意性制約が
-- 一切無かった（line_accounts の client_id UNIQUE のような制約すら無い）。
-- クライアント単位・WL単位・HQ単位それぞれで「該当テナントにつき1行」を
-- 保証する partial unique index を新設する。

-- クライアント単位は client_id ごとに1件
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_accounts_client
  ON stripe_accounts(client_id)
  WHERE client_id IS NOT NULL;

-- WL単位は client_id が無い行について white_label_id ごとに1件
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_accounts_wl
  ON stripe_accounts(white_label_id)
  WHERE client_id IS NULL AND white_label_id IS NOT NULL;

-- HQ共通は client_id・white_label_id が共にNULLの行が全体で1件のみ
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_accounts_hq
  ON stripe_accounts((true))
  WHERE client_id IS NULL AND white_label_id IS NULL;

-- white_label_owner: 自OEM単位の行（client_id IS NULL かつ自分のwhite_label_id）のみ管理可
DROP POLICY IF EXISTS "white_label_owner: stripe_accounts 自OEM設定管理" ON stripe_accounts;
CREATE POLICY "white_label_owner: stripe_accounts 自OEM設定管理"
  ON stripe_accounts FOR ALL
  USING (
    get_user_role() = 'white_label_owner'
    AND client_id IS NULL
    AND white_label_id = get_user_white_label_id()
  )
  WITH CHECK (
    get_user_role() = 'white_label_owner'
    AND client_id IS NULL
    AND white_label_id = get_user_white_label_id()
  );
