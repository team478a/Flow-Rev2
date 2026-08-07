-- ============================================================
-- FlowRev DB Migration 0023: PV加算をアトミックにする
-- 前提: 0001〜0022 適用済み
--
-- これまでの実装は「SELECT views → +1 → UPDATE」だった。
-- 同時に複数のアクセスがあると全員が同じ値を読み、同じ値を書き戻すため
-- カウントが落ちる（lost update）。広告出稿直後など、同時アクセスが
-- 増える場面ほど落ち方が大きくなる。
--
-- PVは登録数の分母なので、落ちるとCVRが実際より高く出る。
-- 「効いている」と誤認して出稿を増やす方向の誤りになるため、直しておく。
--
-- PostgREST から `views = views + 1` を発行する手段が無いため、
-- 関数として定義して RPC で呼ぶ。
-- ============================================================

CREATE OR REPLACE FUNCTION increment_lp_views(lp_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE landing_pages
  SET views = COALESCE(views, 0) + 1
  WHERE id = lp_id;
$$;

-- 公開ページ（未ログイン）から呼ばれるため anon にも実行を許可する。
-- 影響範囲は views の加算のみで、他の列は書き換えられない。
GRANT EXECUTE ON FUNCTION increment_lp_views(UUID) TO anon, authenticated, service_role;

-- 補足:
--   SECURITY DEFINER にしているのは、landing_pages のRLSが匿名の更新を
--   許可していないため。関数の中身をこの1文に限定することで、
--   RLSを迂回できる範囲を「PVの加算」だけに閉じている。
