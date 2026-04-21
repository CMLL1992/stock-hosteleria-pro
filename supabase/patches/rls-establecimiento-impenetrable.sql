-- OPS SaaS: RLS impenetrable por establecimiento (con bypass superadmin)
-- Ejecuta tras la migración multitenant.

-- Regla base solicitada (con excepción superadmin):
-- USING ( public.is_superadmin() OR auth.uid() IN (SELECT id FROM usuarios WHERE establecimiento_id = TABLE.establecimiento_id) )

-- PRODUCTOS
alter table public.productos enable row level security;
drop policy if exists "productos_select_est_or_superadmin" on public.productos;
create policy "productos_select_est_or_superadmin"
on public.productos
for select
to authenticated
using (
  public.is_superadmin()
  OR auth.uid() in (
    select u.id from public.usuarios u where u.establecimiento_id = public.productos.establecimiento_id
  )
);

-- PROVEEDORES
alter table public.proveedores enable row level security;
drop policy if exists "proveedores_select_est_or_superadmin" on public.proveedores;
create policy "proveedores_select_est_or_superadmin"
on public.proveedores
for select
to authenticated
using (
  public.is_superadmin()
  OR auth.uid() in (
    select u.id from public.usuarios u where u.establecimiento_id = public.proveedores.establecimiento_id
  )
);

-- MOVIMIENTOS
alter table public.movimientos enable row level security;
drop policy if exists "movimientos_select_est_or_superadmin" on public.movimientos;
create policy "movimientos_select_est_or_superadmin"
on public.movimientos
for select
to authenticated
using (
  public.is_superadmin()
  OR auth.uid() in (
    select u.id from public.usuarios u where u.establecimiento_id = public.movimientos.establecimiento_id
  )
);

