-- Add separate platform roles for HR and Super Admin.
alter type public.app_role add value if not exists 'hr';
alter type public.app_role add value if not exists 'super_admin';

-- Profiles visibility/update permissions
drop policy if exists profiles_team_select on public.profiles;
create policy profiles_team_select on public.profiles
for select to authenticated
using (
  public.current_role() in ('admin', 'super_admin')
  or (public.current_role() = 'hr' and role in ('manager', 'employee'))
  or id = auth.uid()
  or manager_id = auth.uid()
);

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using (
  public.current_role() in ('admin', 'super_admin')
  or (public.current_role() = 'hr' and role in ('manager', 'employee'))
)
with check (
  public.current_role() in ('admin', 'super_admin')
  or (public.current_role() = 'hr' and role in ('manager', 'employee'))
);

-- Leads scope:
-- - Super Admin/Admin can manage all leads.
-- - HR can only manage leads owned by manager/employee users.
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
for insert to authenticated
with check (
  not public.is_transport()
  and (
    employee_id = auth.uid()
    or public.current_role() in ('admin', 'super_admin', 'manager')
    or (
      public.current_role() = 'hr'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id
          and p.role in ('manager', 'employee')
      )
    )
  )
);

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
for select to authenticated
using (
  public.current_role() in ('admin', 'super_admin', 'hr')
  and (
    public.current_role() != 'hr'
    or exists (
      select 1 from public.profiles p
      where p.id = employee_id
        and p.role in ('manager', 'employee')
    )
  )
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
  (
    public.current_role() in ('admin', 'super_admin')
    or (
      public.current_role() = 'hr'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id
          and p.role in ('manager', 'employee')
      )
    )
  )
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
)
with check (
  (
    public.current_role() in ('admin', 'super_admin')
    or (
      public.current_role() = 'hr'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id
          and p.role in ('manager', 'employee')
      )
    )
  )
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
  (
    public.current_role() in ('admin', 'super_admin')
    or (
      public.current_role() = 'hr'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id
          and p.role in ('manager', 'employee')
      )
    )
  )
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

-- Lead child tables follow the same elevated role scope.
drop policy if exists lead_meetings_rw on public.lead_meetings;
create policy lead_meetings_rw on public.lead_meetings
for all to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
      and (
        public.current_role() in ('admin', 'super_admin', 'hr', 'manager')
        and (
          public.current_role() != 'hr'
          or exists (
            select 1 from public.profiles p
            where p.id = l.employee_id
              and p.role in ('manager', 'employee')
          )
        )
        or l.employee_id = auth.uid()
      )
  )
)
with check (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
      and (
        public.current_role() in ('admin', 'super_admin', 'hr', 'manager')
        and (
          public.current_role() != 'hr'
          or exists (
            select 1 from public.profiles p
            where p.id = l.employee_id
              and p.role in ('manager', 'employee')
          )
        )
        or l.employee_id = auth.uid()
      )
  )
);

drop policy if exists lead_documents_rw on public.lead_documents;
create policy lead_documents_rw on public.lead_documents
for all to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
      and (
        public.current_role() in ('admin', 'super_admin', 'hr', 'manager')
        and (
          public.current_role() != 'hr'
          or exists (
            select 1 from public.profiles p
            where p.id = l.employee_id
              and p.role in ('manager', 'employee')
          )
        )
        or l.employee_id = auth.uid()
      )
  )
)
with check (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
      and (
        public.current_role() in ('admin', 'super_admin', 'hr', 'manager')
        and (
          public.current_role() != 'hr'
          or exists (
            select 1 from public.profiles p
            where p.id = l.employee_id
              and p.role in ('manager', 'employee')
          )
        )
        or l.employee_id = auth.uid()
      )
  )
);

drop policy if exists lead_activities_rw on public.lead_activities;
create policy lead_activities_rw on public.lead_activities
for all to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
      and (
        public.current_role() in ('admin', 'super_admin', 'hr', 'manager')
        and (
          public.current_role() != 'hr'
          or exists (
            select 1 from public.profiles p
            where p.id = l.employee_id
              and p.role in ('manager', 'employee')
          )
        )
        or l.employee_id = auth.uid()
      )
  )
)
with check (
  exists (
    select 1
    from public.leads l
    where l.id = lead_id
      and (
        public.current_role() in ('admin', 'super_admin', 'hr', 'manager')
        and (
          public.current_role() != 'hr'
          or exists (
            select 1 from public.profiles p
            where p.id = l.employee_id
              and p.role in ('manager', 'employee')
          )
        )
        or l.employee_id = auth.uid()
      )
  )
);

-- Super Admin can use global tracking/location tools like legacy admin.
drop policy if exists location_select_scope on public.location_points;
create policy location_select_scope on public.location_points
for select to authenticated
using (
  public.current_role() in ('admin', 'super_admin')
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

drop policy if exists tracking_status_select_scope on public.tracking_status;
create policy tracking_status_select_scope on public.tracking_status
for select to authenticated
using (
  public.current_role() in ('admin', 'super_admin')
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

drop policy if exists attendance_rw_scope on public.attendance;
create policy attendance_rw_scope on public.attendance
for all to authenticated
using (
  public.current_role() in ('admin', 'super_admin')
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
)
with check (
  public.current_role() in ('admin', 'super_admin')
  or employee_id = auth.uid()
  or (public.current_role() = 'manager'
      and exists (
        select 1 from public.profiles p
        where p.id = employee_id and p.manager_id = auth.uid()
      ))
);

-- Super Admin should manage company documents in place of legacy admin.
drop policy if exists company_docs_admin_write on public.company_documents;
create policy company_docs_admin_write on public.company_documents
for all to authenticated
using (public.current_role() in ('admin', 'super_admin'))
with check (public.current_role() in ('admin', 'super_admin'));
