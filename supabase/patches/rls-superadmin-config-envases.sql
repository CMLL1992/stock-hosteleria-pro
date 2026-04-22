-- Security: RLS bypass for superadmin on config_precios_envases.
-- Objective:
-- - Superadmin: unrestricted access across establishments.
-- - Admin/staff: restricted to my_establecimiento_id().
--
-- Apply in Supabase SQL Editor.

do $$
begin
  if to_regclass('public.config_precios_envases') is null then
    return;
  end if;
end $$;

alter table public.config_precios_envases enable row level security;

drop policy if exists config_precios_envases_select_same_est on public.config_precios_envases;
drop policy if exists config_precios_envases_upsert_same_est on public.config_precios_envases;
drop policy if exists config_precios_envases_update_same_est on public.config_precios_envases;
drop policy if exists config_precios_envases_delete_same_est on public.config_precios_envases;

create policy config_precios_envases_select_same_est
on public.config_precios_envases
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

create policy config_precios_envases_upsert_same_est
on public.config_precios_envases
for insert
to authenticated
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

create policy config_precios_envases_update_same_est
on public.config_precios_envases
for update
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
)
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

create policy config_precios_envases_delete_same_est
on public.config_precios_envases
for delete
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

