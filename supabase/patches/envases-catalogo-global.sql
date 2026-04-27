-- Envases globales (establecimiento_id NULL) + RLS SELECT robusto
-- Objetivo:
-- - Permitir un catálogo "global" creado por superadmin (establecimiento_id NULL)
-- - Permitir que cualquier usuario authenticated (staff/admin) pueda LEER:
--   - envases del establecimiento actual
--   - envases globales (NULL)
-- - Mantener escritura restringida:
--   - superadmin: puede escribir global (NULL) o cualquier establecimiento
--   - admin: solo puede escribir en su establecimiento (no global)
--
-- Ejecutar en Supabase SQL Editor.

do $$
begin
  if to_regclass('public.envases_catalogo') is null then
    raise notice 'Tabla public.envases_catalogo no existe. Abortando.';
    return;
  end if;
end $$;

-- Permitir envases globales (NULL) si el esquema original lo impide.
do $$
begin
  begin
    alter table public.envases_catalogo alter column establecimiento_id drop not null;
  exception when others then
    -- si ya es nullable o no se puede, seguimos.
    null;
  end;
end $$;

alter table public.envases_catalogo enable row level security;

-- SELECT: mismo establecimiento o global, o superadmin
drop policy if exists envases_catalogo_select_est_or_superadmin on public.envases_catalogo;
create policy envases_catalogo_select_est_or_superadmin
on public.envases_catalogo
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id is null
  or establecimiento_id = public.my_establecimiento_id()
);

-- INSERT: superadmin (global o cualquiera) o admin en su establecimiento
drop policy if exists envases_catalogo_insert_admin_est on public.envases_catalogo;
create policy envases_catalogo_insert_admin_est
on public.envases_catalogo
for insert
to authenticated
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

-- UPDATE: superadmin o admin en su establecimiento (no global)
drop policy if exists envases_catalogo_update_admin_est on public.envases_catalogo;
create policy envases_catalogo_update_admin_est
on public.envases_catalogo
for update
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
)
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

-- DELETE: superadmin o admin en su establecimiento (no global)
drop policy if exists envases_catalogo_delete_admin_est on public.envases_catalogo;
create policy envases_catalogo_delete_admin_est
on public.envases_catalogo
for delete
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

