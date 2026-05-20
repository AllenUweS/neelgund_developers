-- Fix recursive RLS evaluation on profiles/current_role().
-- The prior current_role() ran as invoker and selected from profiles, which
-- can recurse through profiles policies and cause stack depth errors.

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on function public.current_role() from public;
grant execute on function public.current_role() to authenticated;
