-- cloudflare_protect_logs: 一括保護実行履歴テーブル
create table if not exists cloudflare_protect_logs (
  id          uuid primary key default gen_random_uuid(),
  executed_at timestamptz not null default now(),
  executed_by uuid references auth.users(id) on delete set null,
  total       integer not null default 0,
  updated     integer not null default 0,
  failed      integer not null default 0
);

-- system_admin のみ参照・挿入可（RLS）
alter table cloudflare_protect_logs enable row level security;

DROP POLICY IF EXISTS "system_admin can select protect logs" ON cloudflare_protect_logs;
create policy "system_admin can select protect logs"
  on cloudflare_protect_logs for select
  using (get_user_role() = 'system_admin');

DROP POLICY IF EXISTS "system_admin can insert protect logs" ON cloudflare_protect_logs;
create policy "system_admin can insert protect logs"
  on cloudflare_protect_logs for insert
  with check (get_user_role() = 'system_admin');
