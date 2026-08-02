-- 0010_stripe_payments.sql
-- Stripe 決済サポート追加

-- purchases テーブルに stripe_session_id カラムを追加
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

-- stripe_accounts テーブルに webhook_secret_enc カラムを追加
ALTER TABLE stripe_accounts ADD COLUMN IF NOT EXISTS webhook_secret_enc TEXT;

-- ========================================
-- RLS ポリシー: payment_providers
-- ========================================
DROP POLICY IF EXISTS "client_owner: payment_providers管理" ON payment_providers;
CREATE POLICY "client_owner: payment_providers管理" ON payment_providers
  FOR ALL
  USING (
    get_user_role() = 'client_owner'
    AND client_id = get_user_client_id()
  )
  WITH CHECK (
    get_user_role() = 'client_owner'
    AND client_id = get_user_client_id()
  );

DROP POLICY IF EXISTS "service_role: bypass payment_providers" ON payment_providers;
CREATE POLICY "service_role: bypass payment_providers" ON payment_providers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ========================================
-- RLS ポリシー: stripe_accounts
-- ========================================
DROP POLICY IF EXISTS "client_owner: stripe_accounts管理" ON stripe_accounts;
CREATE POLICY "client_owner: stripe_accounts管理" ON stripe_accounts
  FOR ALL
  USING (
    get_user_role() = 'client_owner'
    AND client_id = get_user_client_id()
  )
  WITH CHECK (
    get_user_role() = 'client_owner'
    AND client_id = get_user_client_id()
  );

DROP POLICY IF EXISTS "service_role: bypass stripe_accounts" ON stripe_accounts;
CREATE POLICY "service_role: bypass stripe_accounts" ON stripe_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ========================================
-- RLS ポリシー: payment_logs
-- ========================================
DROP POLICY IF EXISTS "client_owner: payment_logs閲覧" ON payment_logs;
CREATE POLICY "client_owner: payment_logs閲覧" ON payment_logs
  FOR SELECT
  USING (
    get_user_role() = 'client_owner'
    AND client_id = get_user_client_id()
  );

DROP POLICY IF EXISTS "service_role: bypass payment_logs" ON payment_logs;
CREATE POLICY "service_role: bypass payment_logs" ON payment_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ========================================
-- RLS ポリシー: purchases（service_role bypass）
-- ========================================
DROP POLICY IF EXISTS "service_role: bypass purchases" ON purchases;
CREATE POLICY "service_role: bypass purchases" ON purchases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- stripe_session_id のインデックス
CREATE INDEX IF NOT EXISTS idx_purchases_stripe_session_id
  ON purchases(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
