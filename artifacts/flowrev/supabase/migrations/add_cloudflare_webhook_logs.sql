-- ============================================================
-- Cloudflare Webhook 受信ログテーブル
-- Supabase SQL Editor で実行する。
-- ============================================================

CREATE TABLE IF NOT EXISTS cloudflare_webhook_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  video_id    TEXT,
  status      TEXT,
  result      TEXT NOT NULL,  -- 'success' | 'sig_error' | 'db_error' | 'parse_error'
  detail      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cloudflare_webhook_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_admin: cloudflare_webhook_logs 全操作" ON cloudflare_webhook_logs;
CREATE POLICY "system_admin: cloudflare_webhook_logs 全操作"
  ON cloudflare_webhook_logs FOR ALL
  USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- 管理画面が直近ログを取得するためのインデックス
CREATE INDEX IF NOT EXISTS cloudflare_webhook_logs_received_at_idx
  ON cloudflare_webhook_logs (received_at DESC);
