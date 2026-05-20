-- Guarantee one attendance row per employee per day.
-- Keep the most recently updated row if duplicates exist.
with ranked as (
  select
    id,
    row_number() over (
      partition by employee_id, date
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.attendance
)
delete from public.attendance a
using ranked r
where a.id = r.id
  and r.rn > 1;

alter table public.attendance
add constraint attendance_employee_date_unique unique (employee_id, date);
