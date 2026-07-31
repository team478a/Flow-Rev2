-- ========================================
-- 0014_lp_design_columns.sql
-- LPのAIデザインシステム設定を landing_pages に列として保存できるようにする
-- 前提: 0001_core_tenant.sql, 0003_landing_pages.sql, 0009_public_lp_policy.sql 適用済み
-- ========================================
--
-- 背景（docs/audit/05_SECURITY_FINDINGS.md L-2）:
-- これまでAI生成LPのCSSは <style> タグとして html_content の中に埋め込んで保存して
-- いたが、公開ページ（/p/[slug]）のサニタイザー sanitizeLpHtml() は <style> タグを
-- 許可リストに含めておらずタグごと除去するため、公開した瞬間にAIデザインが
-- 丸ごと失われる機能バグがあった。
--
-- このmigrationでは、デザイン設定（配色・スタイル名）をHTMLとは別の列として保存し、
-- CSSは保存されたパラメータからアプリ自身が生成する「信頼できる」文字列として
-- レンダリング時に組み立てる方式に変更する（サニタイズ対象の html_content には
-- 含めない）。これにより、ユーザー/AI制御下のHTMLとアプリが所有するCSSを
-- 明確に分離し、サニタイザーを経由させずに安全にCSSを配信できるようにする。

ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS design_style_name TEXT,
  ADD COLUMN IF NOT EXISTS design_color_primary TEXT,
  ADD COLUMN IF NOT EXISTS design_color_bg TEXT,
  ADD COLUMN IF NOT EXISTS design_color_accent TEXT;

-- 公開ビューにもデザイン列を追加する（配色・スタイル名は非機密情報であり、
-- 既に生成後CSSとして訪問者に配信されている情報そのものなので、公開しても問題ない）。
CREATE OR REPLACE VIEW public_landing_pages AS
SELECT
  id, title, slug, html_content,
  design_style_name, design_color_primary, design_color_bg, design_color_accent
FROM landing_pages
WHERE status = 'published';

ALTER VIEW public_landing_pages SET (security_invoker = off);
GRANT SELECT ON public_landing_pages TO anon, authenticated;
