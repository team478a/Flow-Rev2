-- ========================================
-- 0008_ai_rls.sql
-- ai_provider_settings に RLS ポリシーを追加
-- ========================================

-- system_admin（service_role）はRLSをバイパスするため、
-- client_owner 向けの参照ポリシーのみ追加する（将来のWL上書き対応）
--
-- 既知の不具合（docs/audit/05_SECURITY_FINDINGS.md M-5）:
-- 下記ポリシーは USING (TRUE) / WITH CHECK (TRUE) となっており、
-- 名前に反して実際には system_admin 以外の全ロールが読み書き可能になっている。
-- アプリコードは常に service_role クライアント経由でこのテーブルにアクセスするため
-- 現状は実害がないが、将来 anon/authenticated キー経由のコードが追加された場合に
-- 危険になる。正しい条件への修正は 0011_fix_ai_rls_policy.sql で行う
-- （このファイル自体は過去に適用された可能性があるため書き換えない）。

CREATE POLICY "system_admin：AI設定全操作"
  ON ai_provider_settings
  FOR ALL
  USING (TRUE)
  WITH CHECK (TRUE);
