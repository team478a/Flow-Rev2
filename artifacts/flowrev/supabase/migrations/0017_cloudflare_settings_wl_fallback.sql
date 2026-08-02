-- ============================================================
-- FlowRev DB Migration 0017: cloudflare_settings のクライアント→WL→HQ フォールバック対応
-- 前提: 0001〜0016 および add_cloudflare_stream.sql 系を実行済み
--
-- cloudflare_settings は他の設定テーブルと異なり、テナント列を一切持たず
-- 「全体で1行」を前提に運用されてきた（読み取り側も .limit(1) で取得していた）。
-- 本migrationでテナント列を追加し、既存の1行はそのままHQ共通設定として機能させる
-- （新規列はNULLで追加されるため、既存行は client_id IS NULL AND white_label_id IS NULL
--   すなわちHQ階層の行として解釈される。データ移行や値の書き換えは発生しない）。
-- ============================================================

ALTER TABLE cloudflare_settings
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE;

-- クライアント単位は client_id ごとに1件
CREATE UNIQUE INDEX IF NOT EXISTS uq_cloudflare_settings_client
  ON cloudflare_settings(client_id)
  WHERE client_id IS NOT NULL;

-- WL単位は client_id が無い行について white_label_id ごとに1件
CREATE UNIQUE INDEX IF NOT EXISTS uq_cloudflare_settings_wl
  ON cloudflare_settings(white_label_id)
  WHERE client_id IS NULL AND white_label_id IS NOT NULL;

-- HQ共通は client_id・white_label_id が共にNULLの行が全体で1件のみ
-- （従来の「全体で1行」という運用上の前提を、ここで初めて制約として明文化する）
CREATE UNIQUE INDEX IF NOT EXISTS uq_cloudflare_settings_hq
  ON cloudflare_settings((true))
  WHERE client_id IS NULL AND white_label_id IS NULL;

-- 解決時の検索を支えるインデックス
CREATE INDEX IF NOT EXISTS idx_cloudflare_settings_client_id
  ON cloudflare_settings(client_id);

-- white_label_owner: 自OEM単位の行（client_id IS NULL かつ自分のwhite_label_id）のみ管理可
DROP POLICY IF EXISTS "white_label_owner: cloudflare_settings 自OEM設定管理" ON cloudflare_settings;
CREATE POLICY "white_label_owner: cloudflare_settings 自OEM設定管理"
  ON cloudflare_settings FOR ALL
  USING (
    get_user_role() = 'white_label_owner'
    AND client_id IS NULL
    AND white_label_id = get_user_white_label_id()
  )
  WITH CHECK (
    get_user_role() = 'white_label_owner'
    AND client_id IS NULL
    AND white_label_id = get_user_white_label_id()
  );

-- 注: client_owner 向けのポリシーは意図的に追加していない。
-- Cloudflare設定の管理画面は現状 system_admin 専用（/admin/settings/cloudflare・
-- /admin/settings/video）であり、クライアント単位の設定を作成するUIが存在しないため。
-- 0015（LINE）・0016（Stripe）と同じく、本migrationのスコープは
-- 「読み取り側の3階層フォールバックを可能にすること」に限定する。
