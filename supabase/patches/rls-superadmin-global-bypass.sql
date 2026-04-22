-- Security: Full RLS bypass for superadmin (global, cross-establecimiento).
-- Objective:
-- - Superadmin: unrestricted SELECT/INSERT/UPDATE/DELETE across establishments.
-- - Admin: restricted to own establecimiento (my_establecimiento_id()).
-- - Staff: read-only where applicable + operational inserts (movimientos) scoped.
--
-- Apply in Supabase SQL Editor.

-- 0) Ensure helpers exist and are SECURITY DEFINER (avoid RLS recursion).
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

-- 1) PRODUCTOS
alter table public.productos enable row level security;

drop policy if exists "productos_select_est_or_superadmin" on public.productos;
drop policy if exists "productos_admin_insert_est" on public.productos;
drop policy if exists "productos_admin_update_est" on public.productos;
drop policy if exists "productos_admin_delete_est" on public.productos;

create policy "productos_select_est_or_superadmin"
on public.productos
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

create policy "productos_admin_insert_est"
on public.productos
for insert
to authenticated
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

create policy "productos_admin_update_est"
on public.productos
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

create policy "productos_admin_delete_est"
on public.productos
for delete
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

-- 2) ESCANDALLOS (si existe)
do $$
begin
  if to_regclass('public.escandallos') is null then
    return;
  end if;

  execute 'alter table public.escandallos enable row level security';

  execute 'drop policy if exists escandallos_select_admin_est on public.escandallos';
  execute 'drop policy if exists escandallos_insert_admin_est on public.escandallos';
  execute 'drop policy if exists escandallos_update_admin_est on public.escandallos';
  execute 'drop policy if exists escandallos_delete_admin_est on public.escandallos';

  execute $pol$
    create policy escandallos_select_admin_est
    on public.escandallos
    for select
    to authenticated
    using (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;

  execute $pol$
    create policy escandallos_insert_admin_est
    on public.escandallos
    for insert
    to authenticated
    with check (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;

  execute $pol$
    create policy escandallos_update_admin_est
    on public.escandallos
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
    create policy escandallos_delete_admin_est
    on public.escandallos
    for delete
    to authenticated
    using (
      public.is_superadmin()
      or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;
end $$;

-- 3) MOVIMIENTOS
alter table public.movimientos enable row level security;

drop policy if exists "movimientos_select_est_or_superadmin" on public.movimientos;
drop policy if exists "movimientos_insert_own_est" on public.movimientos;

create policy "movimientos_select_est_or_superadmin"
on public.movimientos
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

create policy "movimientos_insert_own_est"
on public.movimientos
for insert
to authenticated
with check (
  usuario_id = auth.uid()
  and (
    public.is_superadmin()
    or establecimiento_id = public.my_establecimiento_id()
  )
);

-- 4) STOCK_MOVIMIENTOS (si existe)
do $$
begin
  if to_regclass('public.stock_movimientos') is null then
    return;
  end if;

  -- Best-effort: unify select/write policies to bypass for superadmin.
  execute 'alter table public.stock_movimientos enable row level security';

  execute 'drop policy if exists "stock_movimientos_select_est_or_superadmin" on public.stock_movimientos';
  execute 'drop policy if exists "stock_movimientos_insert_est" on public.stock_movimientos';
  execute 'drop policy if exists "stock_movimientos_update_est" on public.stock_movimientos';
  execute 'drop policy if exists "stock_movimientos_delete_est" on public.stock_movimientos';

  execute $pol$
    create policy "stock_movimientos_select_est_or_superadmin"
    on public.stock_movimientos
    for select
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy "stock_movimientos_insert_est"
    on public.stock_movimientos
    for insert
    to authenticated
    with check (
      public.is_superadmin()
      or (establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;

  execute $pol$
    create policy "stock_movimientos_update_est"
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
    create policy "stock_movimientos_delete_est"
    on public.stock_movimientos
    for delete
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;
end $$;

-- 5) PEDIDOS (si existe)
do $$
begin
  if to_regclass('public.pedidos') is null then
    return;
  end if;

  execute 'alter table public.pedidos enable row level security';

  execute 'drop policy if exists "pedidos_select_est_or_superadmin" on public.pedidos';
  execute 'drop policy if exists "pedidos_insert_est" on public.pedidos';
  execute 'drop policy if exists "pedidos_update_est" on public.pedidos';
  execute 'drop policy if exists "pedidos_delete_est" on public.pedidos';

  execute $pol$
    create policy "pedidos_select_est_or_superadmin"
    on public.pedidos
    for select
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy "pedidos_insert_est"
    on public.pedidos
    for insert
    to authenticated
    with check (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;

  execute $pol$
    create policy "pedidos_update_est"
    on public.pedidos
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
    create policy "pedidos_delete_est"
    on public.pedidos
    for delete
    to authenticated
    using (
      public.is_superadmin()
      or establecimiento_id = public.my_establecimiento_id()
    )
  $pol$;
end $$;

