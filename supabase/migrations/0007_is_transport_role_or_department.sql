-- Legacy: some accounts used department "Transport" before app_role had `transport`.
create or replace function public.is_transport()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'transport'::public.app_role
        or lower(trim(coalesce(p.department, ''))) = 'transport'
      )
  );
$$;
