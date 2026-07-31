-- ========================================
-- 0012_plans_white_label_id.sql
-- plans.white_label_id 列と、代理店(white_label_owner)向けプラン管理ポリシーを追加する
-- 前提: 0001_core_tenant.sql, 0007_rls_policies.sql 適用済み
-- ========================================
--
-- 背景（docs/audit/04_DATABASE_AND_AUTH.md, docs/audit/05_SECURITY_FINDINGS.md M-1）:
-- plans.white_label_id 列と、それに対応する RLS ポリシーは
-- supabase/prod_setup.sql（一括セットアップ用スクリプト）にのみ存在し、
-- SUPABASE_SETUP.md の手順どおり個別ファイルを順番に適用した場合には
-- 作られない。しかしアプリコード（lib/repositories/plans.ts の代理店向け
-- プランCRUD機能）はこの列の存在を前提にしており、未適用の環境では
-- 「column does not exist」エラーで実行時に失敗する。
-- このファイルは個別適用パスと prod_setup.sql の内容を一致させるための
-- 追いつき migration。

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "white_label_owner：自テナントのプラン管理" ON plans;
CREATE POLICY "white_label_owner：自テナントのプラン管理" ON plans
  FOR ALL
  USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  )
  WITH CHECK (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

DROP POLICY IF EXISTS "client_owner：所属プラン参照" ON plans;
CREATE POLICY "client_owner：所属プラン参照" ON plans
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

DROP POLICY IF EXISTS "system_admin：plans全操作" ON plans;
CREATE POLICY "system_admin：plans全操作" ON plans
  FOR ALL USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');
