-- ============================================================
-- FlowRev DB Migration 0021: 認証メールテンプレート（OEM単位）
-- 前提: 0001〜0020 適用済み
--
-- 招待メール・パスワードリセットメールは、これまで Supabase の
-- メーラーとプロジェクト共通のテンプレートで送っていた。
-- Supabase のテンプレートは**プロジェクト単位**のため、OEMごとに
-- 文面やブランドを変えることが構造的にできない。
--
-- 送信を自前（Resend）に切り替え、テンプレートをこのテーブルで
-- OEM単位に持つ。解決順は他の設定と同じ WL → HQ。
-- どちらも無い場合はコード内の既定テンプレートにフォールバックするため、
-- このテーブルが空でも動作する。
--
-- template_key に 'magiclink' / 'signup' を許可しているのは将来用。
-- 現在アプリが送るのは 'invite' と 'recovery' の2種類のみ。
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_email_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id uuid REFERENCES white_labels(id) ON DELETE CASCADE,
  template_key   text NOT NULL,
  subject        text NOT NULL,
  body_html      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_email_templates_key_check
    CHECK (template_key IN ('invite', 'recovery', 'magiclink', 'signup'))
);

-- OEM単位で1テンプレート種別につき1行。
-- white_label_id が NULL の行は本部（HQ）の既定として全OEMのフォールバックになる。
-- NULL は一意制約で重複扱いにならないため、HQ側は部分インデックスで単一行に固定する。
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_email_templates_wl
  ON auth_email_templates (white_label_id, template_key)
  WHERE white_label_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_email_templates_hq
  ON auth_email_templates (template_key)
  WHERE white_label_id IS NULL;

ALTER TABLE auth_email_templates ENABLE ROW LEVEL SECURITY;

-- アプリは service_role で読み書きするため、以下は多層防御。
-- 0018 と同じ形に揃える。
DROP POLICY IF EXISTS "system_admin: auth_email_templates 全操作" ON auth_email_templates;
CREATE POLICY "system_admin: auth_email_templates 全操作"
  ON auth_email_templates FOR ALL
  USING (get_user_role() = 'system_admin')
  WITH CHECK (get_user_role() = 'system_admin');

DROP POLICY IF EXISTS "white_label_owner: auth_email_templates 自OEM管理" ON auth_email_templates;
CREATE POLICY "white_label_owner: auth_email_templates 自OEM管理"
  ON auth_email_templates FOR ALL
  USING (
    get_user_role() = 'white_label_owner'
    AND white_label_id = get_user_white_label_id()
  )
  WITH CHECK (
    get_user_role() = 'white_label_owner'
    AND white_label_id = get_user_white_label_id()
  );
