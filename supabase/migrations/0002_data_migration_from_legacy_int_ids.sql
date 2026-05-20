-- One-time helper migration for moving legacy integer user ids to auth UUID ids.
-- Expected inputs:
-- 1) legacy users imported into public.users_legacy with original integer id + email.
-- 2) auth users already created in auth.users with matching email.

create table if not exists public.user_id_map (
  legacy_user_id integer primary key,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade
);

insert into public.user_id_map (legacy_user_id, auth_user_id)
select ul.id, au.id
from public.users_legacy ul
join auth.users au on lower(au.email) = lower(ul.email)
on conflict (legacy_user_id) do update set auth_user_id = excluded.auth_user_id;

insert into public.profiles (
  id, email, name, role, phone, department, designation, joining_date, profile_notes, created_at, updated_at
)
select
  m.auth_user_id,
  ul.email,
  ul.name,
  case
    when lower(ul.role::text) in ('admin', 'manager', 'employee', 'transport')
      then lower(ul.role::text)::public.app_role
    else 'employee'::public.app_role
  end,
  ul.phone,
  ul.department,
  ul.designation,
  ul.joining_date,
  ul.profile_notes,
  coalesce(ul.created_at, now()),
  now()
from public.users_legacy ul
join public.user_id_map m on m.legacy_user_id = ul.id
on conflict (id) do update
set
  email = excluded.email,
  name = excluded.name,
  role = excluded.role,
  phone = excluded.phone,
  department = excluded.department,
  designation = excluded.designation,
  joining_date = excluded.joining_date,
  profile_notes = excluded.profile_notes,
  updated_at = now();

insert into public.leads (
  id, employee_id, name, phone, email, property_interest, status, notes,
  latitude, longitude, source, budget, priority, follow_up_date, address, created_at, updated_at
)
select
  l.id,
  m.auth_user_id,
  l.name,
  l.phone,
  l.email,
  l.property_interest,
  l.status,
  l.notes,
  l.latitude,
  l.longitude,
  l.source,
  l.budget,
  l.priority,
  l.follow_up_date,
  l.address,
  l.created_at,
  l.updated_at
from public.leads_legacy l
join public.user_id_map m on m.legacy_user_id = l.employee_id
on conflict (id) do nothing;

insert into public.attendance (
  id, employee_id, date, check_in_time, check_out_time,
  check_in_latitude, check_in_longitude, check_out_latitude, check_out_longitude,
  status, notes, created_at, updated_at
)
select
  a.id,
  m.auth_user_id,
  a.date,
  a.check_in_time,
  a.check_out_time,
  a.check_in_latitude,
  a.check_in_longitude,
  a.check_out_latitude,
  a.check_out_longitude,
  a.status,
  a.notes,
  a.created_at,
  a.updated_at
from public.attendance_legacy a
join public.user_id_map m on m.legacy_user_id = a.employee_id
on conflict (id) do nothing;

-- Keep sequences in sync after explicit id inserts from legacy tables.
select setval(pg_get_serial_sequence('public.leads', 'id'), coalesce((select max(id) from public.leads), 1), true);
select setval(pg_get_serial_sequence('public.attendance', 'id'), coalesce((select max(id) from public.attendance), 1), true);
