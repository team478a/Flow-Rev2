-- ============================================================
-- FlowRev DB Migration 0004: Supabase Storage バケット + ポリシー
-- Supabase ダッシュボードの SQL Editor で実行する。
-- ============================================================

-- 商品画像バケット（非公開）
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', false)
ON CONFLICT (id) DO NOTHING;

-- client_owner：自 client_id フォルダのみアップロード可
DROP POLICY IF EXISTS "client_owner：自フォルダのみアップロード可" ON storage.objects;
CREATE POLICY "client_owner：自フォルダのみアップロード可"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = get_user_client_id()::text
);

-- client_owner：自 client_id フォルダのみ参照可
DROP POLICY IF EXISTS "client_owner：自フォルダのみ参照可" ON storage.objects;
CREATE POLICY "client_owner：自フォルダのみ参照可"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = get_user_client_id()::text
);

-- client_owner：自 client_id フォルダのみ削除可
DROP POLICY IF EXISTS "client_owner：自フォルダのみ削除可" ON storage.objects;
CREATE POLICY "client_owner：自フォルダのみ削除可"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = get_user_client_id()::text
);
