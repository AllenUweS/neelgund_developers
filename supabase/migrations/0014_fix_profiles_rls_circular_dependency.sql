-- Fix circular dependency in profiles RLS policies by using the current_role() function
-- Drop existing policies
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_admin_select on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;

-- Create new policies using current_role() function to avoid circular dependency
create policy profiles_self_select on public.profiles
for select to authenticated
using (id = auth.uid());

create policy profiles_admin_select on public.profiles
for select to authenticated
using (public.current_role() = 'admin');

create policy profiles_admin_update on public.profiles
for update to authenticated
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');
