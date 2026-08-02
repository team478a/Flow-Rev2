-- video_check_logs: 未保護動画チェック実行履歴テーブル
create table if not exists video_check_logs (
  id               uuid primary key default gen_random_uuid(),
  checked_at       timestamptz not null default now(),
  unprotected      integer not null default 0,
  total            integer not null default 0,
  notified         boolean not null default false
);

-- system_admin のみ参照・挿入可（RLS）
alter table video_check_logs enable row level security;

DROP POLICY IF EXISTS "system_admin can select video check logs" ON video_check_logs;
create policy "system_admin can select video check logs"
  on video_check_logs for select
  using (get_user_role() = 'system_admin');

DROP POLICY IF EXISTS "system_admin can insert video check logs" ON video_check_logs;
create policy "system_admin can insert video check logs"
  on video_check_logs for insert
  with check (get_user_role() = 'system_admin');
