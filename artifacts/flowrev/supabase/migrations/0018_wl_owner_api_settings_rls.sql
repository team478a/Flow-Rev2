-- ============================================================
-- FlowRev DB Migration 0018: OEM（WL）オーナー向けAPI設定のRLSポリシー
-- 前提: 0001〜0017 適用済み
--
-- ai_provider_settings と email_settings は、テーブル自体は最初から
-- white_label_id 列と (white_label_id, provider) のユニーク制約を持っていたが、
-- WLオーナーがその行を操作するためのRLSポリシーが存在しなかった。
--   - ai_provider_settings: system_admin のポリシーのみ（0011で修正済み）
--   - email_settings: RLS有効だがポリシーが1つも無い（＝service_role以外は全拒否）
--
-- アプリは service_role クライアント経由で読み書きするため、これらのポリシーが
-- 無くても /wl/settings/* の画面は動作する。多層防御として、
-- 0015・0016・0017 と同じ形のポリシーをここで揃える。
-- ============================================================

DROP POLICY IF EXISTS "white_label_owner: ai_provider_settings 自OEM設定管理" ON ai_provider_settings;
CREATE POLICY "white_label_owner: ai_provider_settings 自OEM設定管理"
  ON ai_provider_settings FOR ALL
  USING (
    get_user_role() = 'white_label_owner'
    AND white_label_id = get_user_white_label_id()
  )
  WITH CHECK (
    get_user_role() = 'white_label_owner'
    AND white_label_id = get_user_white_label_id()
  );

DROP POLICY IF EXISTS "white_label_owner: email_settings 自OEM設定管理" ON email_settings;
CREATE POLICY "white_label_owner: email_settings 自OEM設定管理"
  ON email_settings FOR ALL
  USING (
    get_user_role() = 'white_label_owner'
    AND white_label_id = get_user_white_label_id()
  )
  WITH CHECK (
    get_user_role() = 'white_label_owner'
    AND white_label_id = get_user_white_label_id()
  );

-- system_admin 向けのポリシーも email_settings には存在しなかったため併せて追加する。
-- （ai_provider_settings 側は 0011_fix_ai_rls_policy.sql で定義済み）
DROP POLICY IF EXISTS "system_admin: email_settings 全操作" ON email_settings;
CREATE POLICY "system_admin: email_settings 全操作"
  ON email_settings FOR ALL
  USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');
