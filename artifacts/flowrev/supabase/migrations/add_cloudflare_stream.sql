-- ============================================================
-- Cloudflare Stream 動画ホスティング対応マイグレーション
-- Supabase SQL Editor で実行する。
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

DROP POLICY IF EXISTS "system_admin: cloudflare_settings 全操作" ON cloudflare_settings;
CREATE POLICY "system_admin: cloudflare_settings 全操作"
  ON cloudflare_settings FOR ALL
  USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

-- レッスンテーブルに動画タイプと Cloudflare 動画 ID カラムを追加
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS video_type TEXT DEFAULT 'url';
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS cloudflare_video_id TEXT;

-- Cloudflare Stream トランスコードステータス
-- pending  : アップロード済み、トランスコード待ちまたは処理中
-- ready    : トランスコード完了、再生可能
-- error    : トランスコード失敗
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS cloudflare_video_status TEXT DEFAULT 'pending';

-- 既存の Cloudflare 動画はすでに再生可能な状態で運用されているため
-- バックフィルで ready にセットする（DEFAULT 'pending' で追加されたカラムを上書き）
UPDATE lessons
SET cloudflare_video_status = 'ready'
WHERE cloudflare_video_id IS NOT NULL;

-- Webhook シークレット（暗号化保存）— Stream Webhook の署名検証に使用
ALTER TABLE cloudflare_settings ADD COLUMN IF NOT EXISTS webhook_secret_enc TEXT;
