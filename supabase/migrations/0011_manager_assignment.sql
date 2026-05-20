-- Manager assignment & manager-scoped visibility.
--
-- An admin assigns each employee (or transport user) to a manager via
-- profiles.manager_id. Managers can only see the profiles, location, trail,
-- leads, and attendance of their direct reports (plus themselves). Admins
-- still see everything. Regular employees still only see their own data.

-- 1. manager_id column
alter table public.profiles
  add column if not exists manager_id uuid
  references public.profiles(id) on delete set null;

create index if not exists idx_profiles_manager_id on public.profiles(manager_id);

-- 2. Replace the admin-only select so managers can also see their reports.
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_team_select on public.profiles
for select to authenticated
using (
  public.current_role() = 'admin'
  or manager_id = auth.uid()
);
-- (profiles_self_select from 0001 still lets users see their own row.)

-- 3. location_points SELECT — admin all, self own, manager only their reports.
drop policy if exists location_select_scope on public.location_points;
create policy location_select_scope on public.location_points
for select to authenticated
using (
  public.current_role() = 'admin'
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

-- 4. tracking_status SELECT — same scoping
drop policy if exists tracking_status_select_scope on public.tracking_status;
create policy tracking_status_select_scope on public.tracking_status
for select to authenticated
using (
  public.current_role() = 'admin'
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

-- 5. leads — admin all, owner, manager of owner
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
for select to authenticated
using (
  public.current_role() = 'admin'
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
for update to authenticated
using (
  public.current_role() = 'admin'
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
)
with check (
  public.current_role() = 'admin'
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
for delete to authenticated
using (
  public.current_role() = 'admin'
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

-- 6. attendance — same scoping
drop policy if exists attendance_rw_scope on public.attendance;
create policy attendance_rw_scope on public.attendance
for all to authenticated
using (
  public.current_role() = 'admin'
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
)
with check (
  public.current_role() = 'admin'
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

-- 7. Make the leads_with_employee view honor RLS of the caller, not the owner.
alter view public.leads_with_employee set (security_invoker = true);

-- 8. Scope get_leaderboard() to the caller's visible team.
create or replace function public.get_leaderboard()
returns table (
  "employeeId" uuid,
  "employeeName" text,
  "totalLeads" integer,
  "closedWon" integer,
  rank integer
)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select id, role from public.profiles where id = auth.uid()
  ),
  visible as (
    select p.id, p.name
    from public.profiles p, caller c
    where p.role = 'employee'
      and (
        c.role = 'admin'
        or p.id = c.id
        or (c.role = 'manager' and p.manager_id = c.id)
      )
  )
  select
    v.id as "employeeId",
    v.name as "employeeName",
    count(l.id)::int as "totalLeads",
    count(case when l.status = 'closed_won' then 1 end)::int as "closedWon",
    rank() over (
      order by count(l.id) desc,
               count(case when l.status = 'closed_won' then 1 end) desc
    )::int as rank
  from visible v
  left join public.leads l on l.employee_id = v.id
  group by v.id, v.name
  order by rank asc
$$;
