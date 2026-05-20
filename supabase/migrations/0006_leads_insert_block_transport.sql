drop policy if exists leads_insert on public.leads;

create policy leads_insert on public.leads
for insert to authenticated
with check (
  not public.is_transport()
  and (
    employee_id = auth.uid()
    or public.current_role() in ('admin', 'manager')
  )
);
