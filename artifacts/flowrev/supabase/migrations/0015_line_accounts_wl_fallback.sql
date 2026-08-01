-- ============================================================
-- FlowRev DB Migration 0015: line_accounts のクライアント→WL→HQ フォールバック対応
-- 前提: 0001〜0014 および add_line_support.sql を実行済み
-- ============================================================

-- client_id 列は UNIQUE 制約済みだが、NULL は複数許容されるため
-- WL単位・HQ単位の一意性は別途 partial unique index で保証する。
-- （ai_provider_settings の uq_ai_provider_wl / uq_ai_provider_hq と同じ考え方。
--   line_accounts には provider 列が無く1テナントにつき1チャネルのため、
--   HQ側は「client_id/white_label_id が共にNULLの行は高々1件」という
--   シングルトン制約を定数式のユニークインデックスで表現する）

-- WL単位は white_label_id ごとに1件
CREATE UNIQUE INDEX IF NOT EXISTS uq_line_accounts_wl
  ON line_accounts(white_label_id)
  WHERE client_id IS NULL AND white_label_id IS NOT NULL;

-- HQ共通は全体で1件のみ
CREATE UNIQUE INDEX IF NOT EXISTS uq_line_accounts_hq
  ON line_accounts((true))
  WHERE client_id IS NULL AND white_label_id IS NULL;

-- white_label_owner: 自OEM単位の行（client_id IS NULL かつ自分のwhite_label_id）のみ管理可
DROP POLICY IF EXISTS "white_label_owner: line_accounts 自OEM設定管理" ON line_accounts;
CREATE POLICY "white_label_owner: line_accounts 自OEM設定管理"
  ON line_accounts FOR ALL
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
