-- ============================================================
-- FlowRev DB Migration 0002: 商品 / LP / フォーム / 顧客 / 購入
-- 前提: 0001 を実行済み
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

-- ⑦ LP（ランディングページ）
CREATE TABLE landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  html_content TEXT,
  form_fields JSONB DEFAULT '[]',
  status TEXT DEFAULT 'draft',
  views INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  ai_generated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, slug)
);

-- ⑧ フォーム送信
CREATE TABLE form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  landing_page_id UUID REFERENCES landing_pages(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ⑨ 顧客
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  source TEXT,                           -- 'lp' | 'manual' | 'import'
  status TEXT DEFAULT 'active',
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  last_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, email)
);

-- ⑩ 購入記録
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'jpy',
  payment_method TEXT,                   -- 'stripe' | 'bank_transfer' | 'manual'
  payment_status TEXT DEFAULT 'pending', -- 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled'
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
