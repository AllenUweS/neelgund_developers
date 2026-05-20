create extension if not exists "pgcrypto";

create type public.app_role as enum ('admin', 'manager', 'employee');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  name text not null,
  role public.app_role not null default 'employee',
  phone text,
  department text,
  designation text,
  joining_date date,
  profile_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_self_select on public.profiles
for select to authenticated
using (id = auth.uid());

create policy profiles_admin_select on public.profiles
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) = 'admin');

create policy profiles_admin_update on public.profiles
for update to authenticated
using ((select role from public.profiles where id = auth.uid()) = 'admin')
with check ((select role from public.profiles where id = auth.uid()) = 'admin');

create table if not exists public.leads (
  id bigserial primary key,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  phone text not null,
  email text,
  property_interest text,
  status text not null default 'new',
  notes text,
  latitude double precision,
  longitude double precision,
  source text,
  budget text,
  priority text,
  follow_up_date date,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_meetings (
  id bigserial primary key,
  lead_id bigint not null references public.leads(id) on delete cascade,
  scheduled_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_documents (
  id bigserial primary key,
  lead_id bigint not null references public.leads(id) on delete cascade,
  name text not null,
  url text not null,
  mime_type text,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_activities (
  id bigserial primary key,
  lead_id bigint not null references public.leads(id) on delete cascade,
  type text not null default 'note',
  description text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.location_points (
  id bigserial primary key,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision,
  address text,
  recorded_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id bigserial primary key,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  check_in_time timestamptz,
  check_out_time timestamptz,
  check_in_latitude double precision,
  check_in_longitude double precision,
  check_out_latitude double precision,
  check_out_longitude double precision,
  status text default 'present',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_documents (
  id bigserial primary key,
  name text not null,
  url text not null,
  mime_type text,
  category text,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;
alter table public.lead_meetings enable row level security;
alter table public.lead_documents enable row level security;
alter table public.lead_activities enable row level security;
alter table public.location_points enable row level security;
alter table public.attendance enable row level security;
alter table public.company_documents enable row level security;

create or replace function public.current_role() returns public.app_role
language sql stable as $$
  select role from public.profiles where id = auth.uid()
$$;

create policy leads_select on public.leads
for select to authenticated
using (public.current_role() in ('admin','manager') or employee_id = auth.uid());
create policy leads_insert on public.leads
for insert to authenticated
with check (employee_id = auth.uid() or public.current_role() in ('admin','manager'));
create policy leads_update on public.leads
for update to authenticated
using (public.current_role() in ('admin','manager') or employee_id = auth.uid())
with check (public.current_role() in ('admin','manager') or employee_id = auth.uid());
create policy leads_delete on public.leads
for delete to authenticated
using (public.current_role() in ('admin','manager') or employee_id = auth.uid());

create policy lead_meetings_rw on public.lead_meetings
for all to authenticated
using (exists (select 1 from public.leads l where l.id = lead_id and (public.current_role() in ('admin','manager') or l.employee_id = auth.uid())))
with check (exists (select 1 from public.leads l where l.id = lead_id and (public.current_role() in ('admin','manager') or l.employee_id = auth.uid())));

create policy lead_documents_rw on public.lead_documents
for all to authenticated
using (exists (select 1 from public.leads l where l.id = lead_id and (public.current_role() in ('admin','manager') or l.employee_id = auth.uid())))
with check (exists (select 1 from public.leads l where l.id = lead_id and (public.current_role() in ('admin','manager') or l.employee_id = auth.uid())));

create policy lead_activities_rw on public.lead_activities
for all to authenticated
using (exists (select 1 from public.leads l where l.id = lead_id and (public.current_role() in ('admin','manager') or l.employee_id = auth.uid())))
with check (exists (select 1 from public.leads l where l.id = lead_id and (public.current_role() in ('admin','manager') or l.employee_id = auth.uid())));

create policy location_insert_own on public.location_points
for insert to authenticated
with check (employee_id = auth.uid());
create policy location_select_scope on public.location_points
for select to authenticated
using (public.current_role() in ('admin','manager') or employee_id = auth.uid());

create policy attendance_rw_scope on public.attendance
for all to authenticated
using (public.current_role() in ('admin','manager') or employee_id = auth.uid())
with check (public.current_role() in ('admin','manager') or employee_id = auth.uid());

create policy company_docs_select on public.company_documents
for select to authenticated
using (true);
create policy company_docs_admin_write on public.company_documents
for all to authenticated
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

create index if not exists idx_location_points_employee_recorded_at on public.location_points(employee_id, recorded_at);
create index if not exists idx_attendance_employee_date on public.attendance(employee_id, date);
create index if not exists idx_leads_employee_created_at on public.leads(employee_id, created_at desc);
create index if not exists idx_leads_status on public.leads(status);

create or replace view public.leads_with_employee as
select
  l.*,
  p.name as employee_name
from public.leads l
left join public.profiles p on p.id = l.employee_id;

create or replace function public.get_leaderboard()
returns table (
  "employeeId" uuid,
  "employeeName" text,
  "totalLeads" integer,
  "closedWon" integer,
  rank integer
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as "employeeId",
    p.name as "employeeName",
    count(l.id)::int as "totalLeads",
    count(case when l.status = 'closed_won' then 1 end)::int as "closedWon",
    rank() over (order by count(l.id) desc, count(case when l.status = 'closed_won' then 1 end) desc)::int as rank
  from public.profiles p
  left join public.leads l on l.employee_id = p.id
  where p.role = 'employee'
  group by p.id, p.name
  order by rank asc
$$;

revoke all on function public.get_leaderboard() from public;
grant execute on function public.get_leaderboard() to authenticated;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

create policy docs_upload_policy on storage.objects
for insert to authenticated
with check (bucket_id = 'documents');

create policy docs_select_policy on storage.objects
for select to authenticated
using (bucket_id = 'documents');
