-- ========================================
-- 0006_customers.sql
-- 顧客テーブル + RLS + インデックス
-- ========================================

CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id  UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id),
  email           TEXT NOT NULL,
  name            TEXT,
  phone           TEXT,
  source          TEXT DEFAULT 'manual',
  status          TEXT NOT NULL DEFAULT 'active',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  notes           TEXT,
  last_action_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, email)
);

-- RLS 有効化
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- client_owner：自テナント顧客を全操作
DROP POLICY IF EXISTS "client_owner：自顧客のみ操作" ON customers;
CREATE POLICY "client_owner：自顧客のみ操作" ON customers
  FOR ALL
  USING (client_id = get_user_client_id())
  WITH CHECK (
    client_id      = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
  );

-- customer：自分のレコードを参照のみ
DROP POLICY IF EXISTS "customer：自分のレコード参照" ON customers;
CREATE POLICY "customer：自分のレコード参照" ON customers
  FOR SELECT
  USING (user_id = auth.uid());

-- white_label_owner：配下顧客を参照のみ
DROP POLICY IF EXISTS "white_label_owner：配下顧客参照" ON customers;
CREATE POLICY "white_label_owner：配下顧客参照" ON customers
  FOR SELECT
  USING (white_label_id = get_user_white_label_id());

-- インデックス
CREATE INDEX IF NOT EXISTS idx_customers_client_id      ON customers(client_id);
CREATE INDEX IF NOT EXISTS idx_customers_email          ON customers(client_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_status         ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_last_action_at ON customers(last_action_at);
CREATE INDEX IF NOT EXISTS idx_customers_created_at     ON customers(created_at);
