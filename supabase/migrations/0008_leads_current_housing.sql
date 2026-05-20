do $$ begin
  create type public.current_housing as enum ('rent', 'owned');
exception
  when duplicate_object then null;
end $$;

alter table public.leads
  add column if not exists current_housing public.current_housing;
