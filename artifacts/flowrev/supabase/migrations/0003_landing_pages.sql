-- ============================================================
-- FlowRev DB Migration 0003: LP（ランディングページ）テーブル
-- 前提: 0001_core_tenant.sql と 0002_products.sql を実行済みであること
-- Supabase ダッシュボードの SQL Editor で実行する。
-- ============================================================

-- ⑦ LP
CREATE TABLE landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  html_content TEXT,
  form_fields JSONB DEFAULT '[]',
  status TEXT DEFAULT 'draft',           -- 'draft' | 'published' | 'archived'
  views INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  ai_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, slug)
);

-- インデックス
CREATE INDEX idx_landing_pages_client_id      ON landing_pages(client_id);
CREATE INDEX idx_landing_pages_white_label_id ON landing_pages(white_label_id);
CREATE INDEX idx_landing_pages_status         ON landing_pages(status);
CREATE INDEX idx_landing_pages_slug           ON landing_pages(slug);

-- RLS 有効化
ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;

-- client_owner：自テナントのLPのみ操作
DROP POLICY IF EXISTS "client_owner：自LPのみ操作" ON landing_pages;
CREATE POLICY "client_owner：自LPのみ操作" ON landing_pages
  FOR ALL
  USING (client_id = get_user_client_id())
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
  );

-- white_label_owner：配下LP参照のみ
DROP POLICY IF EXISTS "white_label_owner：配下LP参照" ON landing_pages;
CREATE POLICY "white_label_owner：配下LP参照" ON landing_pages
  FOR SELECT USING (white_label_id = get_user_white_label_id());

-- system_admin：全件参照
DROP POLICY IF EXISTS "system_admin：全参照" ON landing_pages;
CREATE POLICY "system_admin：全参照" ON landing_pages
  FOR SELECT USING (get_user_role() = 'system_admin');

-- 公開LP：認証なしで published のみ参照可（公開ページ用）
DROP POLICY IF EXISTS "public：published LP参照" ON landing_pages;
CREATE POLICY "public：published LP参照" ON landing_pages
  FOR SELECT USING (status = 'published');
