-- ============================================================
-- FlowRev DB Migration 0019: white_labels にブランド設定列を追加
-- 前提: 0001〜0018 適用済み
--
-- Phase 2（OEMブランド設定）で必要になる列を追加する。
-- brand_name / brand_logo_url / brand_color / brand_domain は 0001 で作成済みのため
-- ここでは追加しない（ただし logo/domain は設定フォームに項目が無く、
-- 値を入れる手段が存在しなかった。フォーム側はコードで対応する）。
--
-- すべて NULL 許容の列追加のみで、既存データは変更しない。
-- 未設定のOEMは従来どおり本部（FlowRev）の既定表示にフォールバックする。
-- ============================================================

ALTER TABLE white_labels
  -- ブラウザタブのファビコン
  ADD COLUMN IF NOT EXISTS brand_favicon_url TEXT,
  -- メール送信時の差出人名（Resendの from_name を上書きする用途）
  ADD COLUMN IF NOT EXISTS sender_name TEXT,
  -- 問い合わせ先として画面・メールに表示するアドレス
  ADD COLUMN IF NOT EXISTS support_email TEXT,
  -- 特定商取引法表記等で使う運営会社名
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  -- 利用規約・プライバシーポリシーのURL
  ADD COLUMN IF NOT EXISTS terms_url TEXT,
  ADD COLUMN IF NOT EXISTS privacy_url TEXT;

COMMENT ON COLUMN white_labels.brand_favicon_url IS 'ブラウザタブに表示するファビコンのURL。未設定時は本部の既定を使う。';
COMMENT ON COLUMN white_labels.sender_name IS 'メール差出人名。未設定時はメール設定側の from_name を使う。';
COMMENT ON COLUMN white_labels.support_email IS '顧客向けに表示する問い合わせ先アドレス。';
COMMENT ON COLUMN white_labels.company_name IS '運営会社名（特商法表記等で使用）。';
COMMENT ON COLUMN white_labels.terms_url IS '利用規約のURL。';
COMMENT ON COLUMN white_labels.privacy_url IS 'プライバシーポリシーのURL。';
