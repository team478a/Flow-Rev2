-- ============================================================
-- FlowRev DB Migration 0002: 商品テーブル
-- Supabase ダッシュボードの SQL Editor で実行する。
-- ============================================================

-- ⑥ 商品
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  price_type TEXT DEFAULT 'one_time',    -- 'one_time' | 'recurring' | 'free'
  recurring_interval TEXT,
  thumbnail_url TEXT,
  category TEXT,
  status TEXT DEFAULT 'draft',           -- 'draft' | 'published' | 'archived'
  ai_generated BOOLEAN DEFAULT FALSE,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_products_client_id       ON products(client_id);
CREATE INDEX idx_products_white_label_id  ON products(white_label_id);
CREATE INDEX idx_products_status          ON products(status);

-- RLS 有効化
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- client_owner：自テナントの商品のみ操作
DROP POLICY IF EXISTS "client_owner：自商品のみ操作" ON products;
CREATE POLICY "client_owner：自商品のみ操作" ON products
  FOR ALL
  USING (client_id = get_user_client_id())
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
  );

-- white_label_owner：配下商品を参照のみ
DROP POLICY IF EXISTS "white_label_owner：配下商品参照" ON products;
CREATE POLICY "white_label_owner：配下商品参照" ON products
  FOR SELECT USING (white_label_id = get_user_white_label_id());

-- system_admin：全件参照
DROP POLICY IF EXISTS "system_admin：全参照" ON products;
CREATE POLICY "system_admin：全参照" ON products
  FOR SELECT USING (get_user_role() = 'system_admin');
