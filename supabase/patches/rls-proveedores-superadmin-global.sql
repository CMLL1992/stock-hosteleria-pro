-- Fix RLS: allow superadmin to manage proveedores across establishments.
-- Admin stays scoped to their own establecimiento.
--
-- Apply in Supabase SQL Editor.

-- INSERT
drop policy if exists "proveedores_admin_write_est" on public.proveedores;
create policy "proveedores_admin_write_est"
on public.proveedores
for insert
to authenticated
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

-- UPDATE
drop policy if exists "proveedores_admin_update_est" on public.proveedores;
create policy "proveedores_admin_update_est"
on public.proveedores
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

-- DELETE
drop policy if exists "proveedores_admin_delete_est" on public.proveedores;
create policy "proveedores_admin_delete_est"
on public.proveedores
for delete
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

