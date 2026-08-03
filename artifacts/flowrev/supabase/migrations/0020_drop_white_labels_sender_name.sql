-- ============================================================
-- FlowRev DB Migration 0020: white_labels.sender_name を削除する
-- 前提: 0019 適用済み
--
-- 0019 でこの列を追加したが、メール差出人名は既に email_settings.from_name が
-- 担っていた（lib/email/send-*.ts は from_name のみを読む）。
-- email_settings は white_label_id を持ちHQ/WLの階層があるため、
-- OEMごとの差出人名は追加列なしで実現できている。
--
-- 同じ意味を持つ列が2つあり、どちらが優先かのルールも無い状態を解消するため、
-- 使われていない側（white_labels.sender_name）を削除する。
--
-- この列はどのコードからも読み書きされていないため、削除によって失われる
-- 動作は無い。値が入っている場合に備え、削除前に確認するクエリを下に添える。
-- ============================================================

-- 削除前の確認（実行は任意）:
--   SELECT id, brand_name, sender_name
--   FROM white_labels
--   WHERE sender_name IS NOT NULL;
--
--   値が入っていた場合、その内容は email_settings.from_name へ
--   手動で移してから本migrationを適用すること。

ALTER TABLE white_labels
  DROP COLUMN IF EXISTS sender_name;
