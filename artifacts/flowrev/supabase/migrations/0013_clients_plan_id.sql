-- ========================================
-- 0013_clients_plan_id.sql
-- clients.plan_id 列を追加する（欠落していた列）
-- 前提: 0001_core_tenant.sql 適用済み
-- ========================================
--
-- 背景: lib/repositories/clients.ts の createClientForOwner() は、招待に
-- プラン（invitations.plan_id）が設定されている場合 clients.plan_id へ書き込むが、
-- この列はどの migration ファイル（prod_setup.sql 含む）にも定義されていなかった。
-- プラン付き招待を承諾すると「column clients.plan_id does not exist」で
-- クライアント作成が失敗する実行時バグだった。

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id);
