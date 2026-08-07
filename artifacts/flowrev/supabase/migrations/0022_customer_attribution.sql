-- ============================================================
-- FlowRev DB Migration 0022: 顧客の流入元（アトリビューション）
-- 前提: 0001〜0021 適用済み
--
-- LP登録時、customers.source は 'lp' 固定で保存していた。
-- そのため「広告からか、SNSからか、メールからか」を一切区別できず、
-- どの集客が効いたのかを後から分析できない。
--
-- しかもこの情報は**遡って取得できない**。登録の瞬間にしか存在せず、
-- 保存しなければ永久に失われる。
--
-- UTMパラメータ・リファラ・流入したLPを登録時に記録する。
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS utm_source      TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium      TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign    TEXT,
  ADD COLUMN IF NOT EXISTS utm_term        TEXT,
  ADD COLUMN IF NOT EXISTS utm_content     TEXT,
  ADD COLUMN IF NOT EXISTS referrer        TEXT,
  ADD COLUMN IF NOT EXISTS landing_page_id UUID REFERENCES landing_pages(id) ON DELETE SET NULL;

-- 流入元の集計は「このLPの登録を utm_source ごとに数える」形になる。
CREATE INDEX IF NOT EXISTS idx_customers_landing_page
  ON customers (landing_page_id)
  WHERE landing_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_client_utm_source
  ON customers (client_id, utm_source)
  WHERE utm_source IS NOT NULL;

-- 補足:
--   LPが削除されても顧客は残す（ON DELETE SET NULL）。
--   登録済みの顧客をLPの削除で失うほうが損害が大きい。
--
--   アトリビューションは「初回接触」を採る。既存顧客の再登録では
--   customers の upsert が ignoreDuplicates で何もしないため、
--   最初に記録された流入元がそのまま残る。
