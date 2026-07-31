-- ============================================================
-- FlowRev 本番DB セットアップ（統合版）
-- 新規 Supabase プロジェクトの SQL Editor に貼り付けて実行する。
-- 実行順: このファイル1本のみ。分割して実行しないこと。
-- ============================================================

-- ============================================================
-- 0: 拡張機能
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1: コアテナントテーブル
-- ============================================================

-- ① プラン（white_label_id は white_labels 作成後に ALTER TABLE で追加）
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  max_clients INTEGER NOT NULL,
  max_products INTEGER NOT NULL,
  max_customers INTEGER NOT NULL,
  price_monthly INTEGER NOT NULL,
  features JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ② ホワイトラベル事業者
CREATE TABLE white_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES plans(id),
  brand_name TEXT NOT NULL,
  brand_logo_url TEXT,
  brand_color TEXT DEFAULT '#3B82F6',
  brand_domain TEXT,
  status TEXT DEFAULT 'active',
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- plans に white_label_id を追加（white_labels 作成後）
ALTER TABLE plans ADD COLUMN white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE;

-- ③ クライアント
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  business_logo_url TEXT,
  status TEXT DEFAULT 'active',
  plan_id UUID REFERENCES plans(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ④ ユーザープロフィール
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  white_label_id UUID REFERENCES white_labels(id),
  client_id UUID REFERENCES clients(id),
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ⑤ クライアント招待
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES auth.users(id),
  email TEXT NOT NULL,
  client_name TEXT NOT NULL,
  representative_name TEXT,
  plan_id UUID REFERENCES plans(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI プロバイダ設定
CREATE TABLE ai_provider_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  model TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_ai_provider_hq
  ON ai_provider_settings(provider) WHERE white_label_id IS NULL;
CREATE UNIQUE INDEX uq_ai_provider_wl
  ON ai_provider_settings(white_label_id, provider) WHERE white_label_id IS NOT NULL;

-- メール（Resend）設定
CREATE TABLE email_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'resend',
  api_key_enc TEXT NOT NULL,
  from_email TEXT,
  from_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_email_settings_hq
  ON email_settings(provider) WHERE white_label_id IS NULL;
CREATE UNIQUE INDEX uq_email_settings_wl
  ON email_settings(white_label_id, provider) WHERE white_label_id IS NOT NULL;

-- ============================================================
-- 2: コンテンツテーブル（商品 / LP / フォーム / 顧客 / 購入）
-- ============================================================

-- ⑥ 商品
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  price_type TEXT DEFAULT 'one_time',
  recurring_interval TEXT,
  thumbnail_url TEXT,
  category TEXT,
  status TEXT DEFAULT 'draft',
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
  design_style_name TEXT,
  design_color_primary TEXT,
  design_color_bg TEXT,
  design_color_accent TEXT,
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
  source TEXT DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  last_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
  payment_method TEXT,
  payment_status TEXT DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  stripe_session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3: 会員サイト（コース / レッスン / 進捗）+ シナリオ
-- ============================================================

-- ⑪ コース
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⑫ レッスン
CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'video',
  video_url TEXT,
  text_content TEXT,
  file_url TEXT,
  duration_seconds INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⑬ 受講進捗
CREATE TABLE lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  watch_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer_id, lesson_id)
);

-- ⑭ フォローシナリオ
CREATE TABLE follow_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  trigger_config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⑮ シナリオステップ
CREATE TABLE scenario_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES follow_scenarios(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  delay_days INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'email',
  subject TEXT,
  body TEXT NOT NULL,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scenario_id, step_number)
);

-- ⑯ シナリオ実行ログ
CREATE TABLE scenario_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  scenario_id UUID REFERENCES follow_scenarios(id),
  step_id UUID REFERENCES scenario_steps(id),
  customer_id UUID REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4: 決済テーブル
-- ============================================================

-- ⑰ 決済プロバイダ設定
CREATE TABLE payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ⑱ Stripeアカウント設定
CREATE TABLE stripe_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  stripe_account_id TEXT,
  access_token_enc TEXT,
  webhook_secret_enc TEXT,
  is_live BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ⑲ 銀行振込設定
CREATE TABLE bank_transfer_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  bank_name TEXT,
  branch_name TEXT,
  account_type TEXT,
  account_number TEXT,
  account_holder TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ⑳ 決済ログ
CREATE TABLE payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES purchases(id),
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ㉑ レートリミット管理
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(key)
);

-- ============================================================
-- 5: インデックス
-- ============================================================
CREATE INDEX idx_products_client_id       ON products(client_id);
CREATE INDEX idx_products_white_label_id  ON products(white_label_id);
CREATE INDEX idx_products_status          ON products(status);

CREATE INDEX idx_landing_pages_client_id      ON landing_pages(client_id);
CREATE INDEX idx_landing_pages_white_label_id ON landing_pages(white_label_id);
CREATE INDEX idx_landing_pages_status         ON landing_pages(status);
CREATE INDEX idx_landing_pages_slug           ON landing_pages(slug);

CREATE INDEX idx_customers_client_id      ON customers(client_id);
CREATE INDEX idx_customers_email          ON customers(client_id, email);
CREATE INDEX idx_customers_status         ON customers(status);
CREATE INDEX idx_customers_last_action_at ON customers(last_action_at);
CREATE INDEX idx_customers_created_at     ON customers(created_at);

CREATE INDEX idx_purchases_customer_id      ON purchases(customer_id);
CREATE INDEX idx_purchases_client_id        ON purchases(client_id);
CREATE INDEX idx_purchases_payment_status   ON purchases(payment_status);
CREATE INDEX idx_purchases_stripe_session_id ON purchases(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

CREATE INDEX idx_courses_client_id        ON courses(client_id);
CREATE INDEX idx_lessons_course_id        ON lessons(course_id);
CREATE INDEX idx_lesson_progress_customer_id ON lesson_progress(customer_id);
CREATE INDEX idx_lesson_progress_course_id   ON lesson_progress(course_id);

CREATE INDEX idx_follow_scenarios_client_id ON follow_scenarios(client_id);
CREATE INDEX idx_follow_scenarios_status    ON follow_scenarios(status);
CREATE INDEX idx_scenario_steps_scenario_id ON scenario_steps(scenario_id);
CREATE INDEX idx_scenario_logs_customer_id  ON scenario_logs(customer_id);
CREATE INDEX idx_scenario_logs_status       ON scenario_logs(status);
CREATE INDEX idx_scenario_logs_created_at   ON scenario_logs(created_at);

CREATE INDEX idx_invitations_token  ON invitations(token);
CREATE INDEX idx_invitations_email  ON invitations(email);
CREATE INDEX idx_invitations_status ON invitations(status);

CREATE INDEX idx_rate_limits_key          ON rate_limits(key);
CREATE INDEX idx_rate_limits_window_start ON rate_limits(window_start);

-- ============================================================
-- 6: RLS 有効化
-- ============================================================
ALTER TABLE plans                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE white_labels           ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products               ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_pages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases              ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses                ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons                ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress        ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_scenarios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_steps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_providers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transfer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits            ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7: ヘルパー関数（RLS ポリシーより前に定義すること）
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION get_user_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM public.user_profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION get_user_white_label_id()
RETURNS UUID AS $$
  SELECT white_label_id FROM public.user_profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public, pg_temp;

-- ============================================================
-- 8: RLS ポリシー
-- ============================================================

-- user_profiles
CREATE POLICY "自分のプロフィール参照" ON user_profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "system_admin：全参照" ON user_profiles
  FOR SELECT USING (get_user_role() = 'system_admin');

CREATE POLICY "自分のプロフィール更新" ON user_profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = get_user_role()
    AND white_label_id IS NOT DISTINCT FROM get_user_white_label_id()
    AND client_id IS NOT DISTINCT FROM get_user_client_id()
  );

CREATE POLICY "system_admin：プロフィール全操作" ON user_profiles
  FOR ALL USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- plans
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

CREATE POLICY "client_owner：所属プラン参照" ON plans
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

CREATE POLICY "system_admin：plans全操作" ON plans
  FOR ALL USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- white_labels
CREATE POLICY "white_label_owner：自テナント参照" ON white_labels
  FOR SELECT USING (owner_user_id = auth.uid());

CREATE POLICY "client_owner：所属テナント参照" ON white_labels
  FOR SELECT USING (id = get_user_white_label_id());

CREATE POLICY "system_admin：全操作" ON white_labels
  FOR ALL USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- clients
CREATE POLICY "client_owner：自クライアント参照" ON clients
  FOR SELECT USING (owner_user_id = auth.uid());

CREATE POLICY "white_label_owner：配下クライアント参照" ON clients
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

CREATE POLICY "white_label_owner：配下クライアント作成" ON clients
  FOR INSERT WITH CHECK (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

CREATE POLICY "system_admin：clients全操作" ON clients
  FOR ALL USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- invitations
CREATE POLICY "white_label_owner：自テナントの招待管理" ON invitations
  FOR ALL
  USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  )
  WITH CHECK (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

CREATE POLICY "system_admin：invitations全操作" ON invitations
  FOR ALL USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- products
CREATE POLICY "client_owner：自商品のみ操作" ON products
  FOR ALL
  USING (client_id = get_user_client_id() AND get_user_role() = 'client_owner')
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

CREATE POLICY "white_label_owner：配下商品参照" ON products
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

CREATE POLICY "system_admin：products全参照" ON products
  FOR SELECT USING (get_user_role() = 'system_admin');

-- landing_pages
CREATE POLICY "client_owner：自LPのみ操作" ON landing_pages
  FOR ALL
  USING (client_id = get_user_client_id() AND get_user_role() = 'client_owner')
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

CREATE POLICY "white_label_owner：配下LP参照" ON landing_pages
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

-- customers
CREATE POLICY "client_owner：自顧客のみ操作" ON customers
  FOR ALL
  USING (client_id = get_user_client_id() AND get_user_role() = 'client_owner')
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

CREATE POLICY "customer：自分のレコード参照" ON customers
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "white_label_owner：配下顧客参照" ON customers
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

-- purchases
CREATE POLICY "client_owner：自購入記録のみ操作" ON purchases
  FOR ALL
  USING (client_id = get_user_client_id() AND get_user_role() = 'client_owner')
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

CREATE POLICY "white_label_owner：配下購入記録参照" ON purchases
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

CREATE POLICY "customer：自分の購入記録参照" ON purchases
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = purchases.customer_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "service_role: bypass purchases" ON purchases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- courses
CREATE POLICY "client_owner：コース操作" ON courses
  FOR ALL
  USING (client_id = get_user_client_id() AND get_user_role() = 'client_owner')
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

CREATE POLICY "white_label_owner：配下コース参照" ON courses
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

CREATE POLICY "customer：購入済みコース参照" ON courses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM purchases p
      JOIN customers c ON c.id = p.customer_id
      WHERE p.product_id = courses.product_id
        AND c.user_id = auth.uid()
        AND p.payment_status = 'paid'
    )
  );

-- lessons
CREATE POLICY "client_owner：レッスン操作" ON lessons
  FOR ALL
  USING (client_id = get_user_client_id() AND get_user_role() = 'client_owner')
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

CREATE POLICY "white_label_owner：配下レッスン参照" ON lessons
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

CREATE POLICY "customer：購入済みレッスン参照" ON lessons
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM courses co
      JOIN purchases p ON p.product_id = co.product_id
      JOIN customers c ON c.id = p.customer_id
      WHERE co.id = lessons.course_id
        AND c.user_id = auth.uid()
        AND p.payment_status = 'paid'
    )
  );

-- lesson_progress
CREATE POLICY "customer：自分の進捗のみ操作" ON lesson_progress
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = lesson_progress.customer_id AND c.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = lesson_progress.customer_id AND c.user_id = auth.uid())
  );

CREATE POLICY "client_owner：進捗参照" ON lesson_progress
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() IN ('client_owner', 'white_label_owner')
  );

-- follow_scenarios
CREATE POLICY "client_owner：シナリオ操作" ON follow_scenarios
  FOR ALL
  USING (client_id = get_user_client_id() AND get_user_role() = 'client_owner')
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

CREATE POLICY "white_label_owner：配下シナリオ参照" ON follow_scenarios
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

-- scenario_steps
CREATE POLICY "client_owner：ステップ操作" ON scenario_steps
  FOR ALL
  USING (
    get_user_role() = 'client_owner'
    AND EXISTS (
      SELECT 1 FROM follow_scenarios s
      WHERE s.id = scenario_steps.scenario_id AND s.client_id = get_user_client_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'client_owner'
    AND EXISTS (
      SELECT 1 FROM follow_scenarios s
      WHERE s.id = scenario_steps.scenario_id
        AND s.client_id = get_user_client_id()
        AND s.white_label_id = get_user_white_label_id()
    )
  );

CREATE POLICY "white_label_owner：配下ステップ参照" ON scenario_steps
  FOR SELECT USING (
    white_label_id = get_user_white_label_id()
    AND get_user_role() = 'white_label_owner'
  );

-- scenario_logs
CREATE POLICY "client_owner：ログ参照" ON scenario_logs
  FOR SELECT USING (white_label_id = get_user_white_label_id());

-- payment_providers
CREATE POLICY "client_owner: payment_providers管理" ON payment_providers
  FOR ALL
  USING (get_user_role() = 'client_owner' AND client_id = get_user_client_id())
  WITH CHECK (get_user_role() = 'client_owner' AND client_id = get_user_client_id());

CREATE POLICY "service_role: bypass payment_providers" ON payment_providers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- bank_transfer_settings
CREATE POLICY "client_owner：銀行振込設定操作" ON bank_transfer_settings
  FOR ALL
  USING (client_id = get_user_client_id() AND get_user_role() = 'client_owner')
  WITH CHECK (
    client_id = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
    AND get_user_role() = 'client_owner'
  );

-- stripe_accounts
CREATE POLICY "client_owner: stripe_accounts管理" ON stripe_accounts
  FOR ALL
  USING (get_user_role() = 'client_owner' AND client_id = get_user_client_id())
  WITH CHECK (get_user_role() = 'client_owner' AND client_id = get_user_client_id());

CREATE POLICY "service_role: bypass stripe_accounts" ON stripe_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- payment_logs
CREATE POLICY "client_owner: payment_logs閲覧" ON payment_logs
  FOR SELECT USING (
    get_user_role() = 'client_owner' AND client_id = get_user_client_id()
  );

CREATE POLICY "service_role: bypass payment_logs" ON payment_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ai_provider_settings（system_admin のみ。service_role は RLS バイパス）
CREATE POLICY "system_admin：AI設定全操作" ON ai_provider_settings
  FOR ALL USING (get_user_role() = 'system_admin') WITH CHECK (get_user_role() = 'system_admin');

-- ============================================================
-- 9: ユーザー作成トリガー
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  requested_role TEXT := NEW.raw_user_meta_data->>'role';
  safe_role TEXT;
BEGIN
  IF requested_role IN ('white_label_owner', 'client_owner', 'customer') THEN
    safe_role := requested_role;
  ELSE
    safe_role := 'customer';
  END IF;

  INSERT INTO public.user_profiles (id, role, white_label_id, client_id, display_name)
  VALUES (
    NEW.id,
    safe_role,
    (NEW.raw_user_meta_data->>'white_label_id')::UUID,
    (NEW.raw_user_meta_data->>'client_id')::UUID,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 10: 公開LP ビュー（anon 向け）
-- ============================================================
CREATE OR REPLACE VIEW public_landing_pages AS
SELECT
  id, title, slug, html_content,
  design_style_name, design_color_primary, design_color_bg, design_color_accent
FROM landing_pages
WHERE status = 'published';

ALTER VIEW public_landing_pages SET (security_invoker = off);
GRANT SELECT ON public_landing_pages TO anon, authenticated;

-- ============================================================
-- 11: Supabase Storage バケット
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "client_owner：自フォルダのみアップロード可"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = get_user_client_id()::text
);

CREATE POLICY "client_owner：自フォルダのみ参照可"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = get_user_client_id()::text
);

CREATE POLICY "client_owner：自フォルダのみ削除可"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = get_user_client_id()::text
);

-- ============================================================
-- 12: LINE 連携サポート（add_line_support.sql と同内容）
-- ============================================================

-- LINE アカウント設定テーブル
CREATE TABLE IF NOT EXISTS line_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE UNIQUE,
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  channel_access_token_enc TEXT,
  channel_secret_enc TEXT,
  line_friend_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE line_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_line_accounts_client_id ON line_accounts(client_id);

CREATE POLICY "client_owner: line_accounts 自テナント管理"
  ON line_accounts FOR ALL
  USING (get_user_role() = 'client_owner' AND client_id = get_user_client_id())
  WITH CHECK (get_user_role() = 'client_owner' AND client_id = get_user_client_id());

CREATE POLICY "system_admin: line_accounts 全操作"
  ON line_accounts FOR ALL
  USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- 顧客テーブルに LINE ユーザー ID カラムを追加
ALTER TABLE customers ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- LP テーブルに LINE 友だち追加 URL カラムを追加
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS line_add_url TEXT;

-- ============================================================
-- 13: Cloudflare Stream 動画ホスティング対応
-- ============================================================

-- Cloudflare システム設定テーブル（system_admin のみ管理）
CREATE TABLE IF NOT EXISTS cloudflare_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT,
  api_token_enc TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cloudflare_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_admin: cloudflare_settings 全操作"
  ON cloudflare_settings FOR ALL
  USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- lessons テーブルに動画タイプ・Cloudflare 動画 ID カラムを追加
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS video_type TEXT DEFAULT 'url';
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS cloudflare_video_id TEXT;

-- ============================================================
-- 完了
-- ============================================================
-- このSQLを実行後、Supabase Auth の設定で以下を行うこと:
--   1. Email auth を有効化
--   2. 「Confirm email」を必要に応じてオフ（招待フローは Supabase 側が処理）
--   3. Public signup を OFF（招待のみ登録）
--   4. Additional redirect URLs に本番ドメインを追加
--      例: https://your-domain.vercel.app/auth/callback
-- ============================================================
