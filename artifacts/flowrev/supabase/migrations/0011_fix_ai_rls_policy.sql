-- ========================================
-- 0011_fix_ai_rls_policy.sql
-- ai_provider_settings の RLS ポリシー不具合を修正する
-- 前提: 0008_ai_rls.sql 適用済み
-- ========================================
--
-- 0008_ai_rls.sql で作成されたポリシー「system_admin：AI設定全操作」は
-- USING (TRUE) / WITH CHECK (TRUE) となっており、名前に反して system_admin 以外の
-- 全ロールが anon/authenticated キー経由で読み書きできてしまう不具合があった
-- （docs/audit/05_SECURITY_FINDINGS.md M-5）。
-- アプリコードは常に service_role クライアント経由でアクセスするため実害はなかったが、
-- 本来の意図どおり system_admin ロールのみに制限する。

DROP POLICY IF EXISTS "system_admin：AI設定全操作" ON ai_provider_settings;
CREATE POLICY "system_admin：AI設定全操作" ON ai_provider_settings
  FOR ALL
  USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');
