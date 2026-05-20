create table if not exists public.tracking_status (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  permission_state text not null default 'unknown',
  tracker_state text not null default 'stopped',
  platform text,
  last_ping_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.tracking_status enable row level security;

create policy tracking_status_select_scope on public.tracking_status
for select to authenticated
using (public.current_role() in ('admin','manager') or employee_id = auth.uid());

create policy tracking_status_upsert_own on public.tracking_status
for insert to authenticated
with check (employee_id = auth.uid());

create policy tracking_status_update_own on public.tracking_status
for update to authenticated
using (employee_id = auth.uid())
with check (employee_id = auth.uid());

create index if not exists idx_tracking_status_last_ping on public.tracking_status(last_ping_at desc);
