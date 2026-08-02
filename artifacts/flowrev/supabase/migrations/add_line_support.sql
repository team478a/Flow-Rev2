-- ============================================================
-- LINE 連携サポートの追加マイグレーション
-- Supabase SQL Editor で実行する。
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

-- RLS ポリシー
DROP POLICY IF EXISTS "client_owner: line_accounts 自テナント管理" ON line_accounts;
CREATE POLICY "client_owner: line_accounts 自テナント管理"
  ON line_accounts FOR ALL
  USING (get_user_role() = 'client_owner' AND client_id = get_user_client_id())
  WITH CHECK (get_user_role() = 'client_owner' AND client_id = get_user_client_id());

DROP POLICY IF EXISTS "system_admin: line_accounts 全操作" ON line_accounts;
CREATE POLICY "system_admin: line_accounts 全操作"
  ON line_accounts FOR ALL
  USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- 顧客テーブルに LINE ユーザー ID カラムを追加
ALTER TABLE customers ADD COLUMN IF NOT EXISTS line_user_id TEXT;

-- LP テーブルに LINE 友だち追加 URL カラムを追加
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS line_add_url TEXT;
