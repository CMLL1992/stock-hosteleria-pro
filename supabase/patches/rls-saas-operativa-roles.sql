-- OPS SaaS: RLS operativo por roles (Staff/Admin/Superadmin) + override global
-- Objetivo:
-- - Aislamiento total por establecimiento_id (seguridad infra, no solo UI)
-- - Staff: SELECT por establecimiento; INSERT/UPDATE solo en tablas operativas
-- - DELETE: solo Admin o Superadmin
-- - Superadmin: override global (cross-establecimiento)
--
-- Ejecutar en Supabase SQL Editor.

-- 0) Helpers (SECURITY DEFINER) para evitar recursión RLS en public.usuarios
create or replace function public.is_superadmin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and coalesce(u.rol::text, '') = 'superadmin'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and coalesce(u.rol::text, '') in ('admin', 'superadmin')
  );
$$;

create or replace function public.my_establecimiento_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select u.establecimiento_id
  from public.usuarios u
  where u.id = auth.uid()
  limit 1;
$$;

grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_establecimiento_id() to authenticated;

-- 1) SALA_MESAS (operativo: Staff puede insertar/actualizar estado/posiciones)
do $$
begin
  if to_regclass('public.sala_mesas') is null then
    return;
  end if;

  execute 'alter table public.sala_mesas enable row level security';

  execute 'drop policy if exists sala_mesas_select_est_or_superadmin on public.sala_mesas';
  execute 'drop policy if exists sala_mesas_insert_operativo on public.sala_mesas';
  execute 'drop policy if exists sala_mesas_update_operativo on public.sala_mesas';
  execute 'drop policy if exists sala_mesas_delete_admin_only on public.sala_mesas';

  execute $pol$
    create policy sala_mesas_select_est_or_superadmin
    on public.sala_mesas
    for select
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy sala_mesas_insert_operativo
    on public.sala_mesas
    for insert
    to authenticated
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy sala_mesas_update_operativo
    on public.sala_mesas
    for update
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy sala_mesas_delete_admin_only
    on public.sala_mesas
    for delete
    to authenticated
    using (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;
end $$;

-- 2) SALA_RESERVAS (operativo: Staff puede crear/actualizar; delete admin)
do $$
begin
  if to_regclass('public.sala_reservas') is null then
    return;
  end if;

  execute 'alter table public.sala_reservas enable row level security';

  execute 'drop policy if exists sala_reservas_select_est_or_superadmin on public.sala_reservas';
  execute 'drop policy if exists sala_reservas_insert_operativo on public.sala_reservas';
  execute 'drop policy if exists sala_reservas_update_operativo on public.sala_reservas';
  execute 'drop policy if exists sala_reservas_delete_admin_only on public.sala_reservas';

  execute $pol$
    create policy sala_reservas_select_est_or_superadmin
    on public.sala_reservas
    for select
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy sala_reservas_insert_operativo
    on public.sala_reservas
    for insert
    to authenticated
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy sala_reservas_update_operativo
    on public.sala_reservas
    for update
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy sala_reservas_delete_admin_only
    on public.sala_reservas
    for delete
    to authenticated
    using (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;
end $$;

-- 3) PRODUCTOS (stock: Staff puede actualizar; delete admin)
do $$
begin
  if to_regclass('public.productos') is null then
    return;
  end if;

  execute 'alter table public.productos enable row level security';

  execute 'drop policy if exists productos_select_est_or_superadmin on public.productos';
  execute 'drop policy if exists productos_insert_admin_only on public.productos';
  execute 'drop policy if exists productos_update_operativo on public.productos';
  execute 'drop policy if exists productos_delete_admin_only on public.productos';

  execute $pol$
    create policy productos_select_est_or_superadmin
    on public.productos
    for select
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  -- Crear productos (catálogo): solo admin/superadmin
  execute $pol$
    create policy productos_insert_admin_only
    on public.productos
    for insert
    to authenticated
    with check (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;

  -- Actualizar productos: Staff permitido (operativa de stock) pero siempre en su establecimiento
  execute $pol$
    create policy productos_update_operativo
    on public.productos
    for update
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy productos_delete_admin_only
    on public.productos
    for delete
    to authenticated
    using (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;
end $$;

-- 4) MOVIMIENTOS (operativo: Staff puede insertar; delete admin)
do $$
begin
  if to_regclass('public.movimientos') is null then
    return;
  end if;

  execute 'alter table public.movimientos enable row level security';

  execute 'drop policy if exists movimientos_select_est_or_superadmin on public.movimientos';
  execute 'drop policy if exists movimientos_insert_operativo on public.movimientos';
  execute 'drop policy if exists movimientos_update_admin_only on public.movimientos';
  execute 'drop policy if exists movimientos_delete_admin_only on public.movimientos';

  execute $pol$
    create policy movimientos_select_est_or_superadmin
    on public.movimientos
    for select
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy movimientos_insert_operativo
    on public.movimientos
    for insert
    to authenticated
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  -- Si alguna parte del sistema necesita editar movimientos, limitamos a admin/superadmin
  execute $pol$
    create policy movimientos_update_admin_only
    on public.movimientos
    for update
    to authenticated
    using (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
    with check (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;

  execute $pol$
    create policy movimientos_delete_admin_only
    on public.movimientos
    for delete
    to authenticated
    using (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;
end $$;

-- 5) STOCK_MOVIMIENTOS (si existe) - tratamos como “stock” (operativo: staff puede escribir; delete admin)
do $$
begin
  if to_regclass('public.stock_movimientos') is null then
    return;
  end if;

  execute 'alter table public.stock_movimientos enable row level security';

  execute 'drop policy if exists stock_movimientos_select_est_or_superadmin on public.stock_movimientos';
  execute 'drop policy if exists stock_movimientos_insert_operativo on public.stock_movimientos';
  execute 'drop policy if exists stock_movimientos_update_operativo on public.stock_movimientos';
  execute 'drop policy if exists stock_movimientos_delete_admin_only on public.stock_movimientos';

  execute $pol$
    create policy stock_movimientos_select_est_or_superadmin
    on public.stock_movimientos
    for select
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy stock_movimientos_insert_operativo
    on public.stock_movimientos
    for insert
    to authenticated
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy stock_movimientos_update_operativo
    on public.stock_movimientos
    for update
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy stock_movimientos_delete_admin_only
    on public.stock_movimientos
    for delete
    to authenticated
    using (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;
end $$;

