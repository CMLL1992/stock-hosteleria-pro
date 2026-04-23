-- Fix escandallos.establecimiento_id visibility issues (admin vs superadmin)
-- Objetivo:
-- - Asegurar que `public.escandallos` tenga `establecimiento_id`
-- - Backfill de filas existentes (NULL o desalineadas) usando `public.productos.establecimiento_id`
-- - Enforce: al insertar/actualizar, el establecimiento del escandallo debe coincidir con el del producto
-- - RLS: admin ve/edita solo su establecimiento; superadmin bypass global
--
-- Ejecuta este patch en Supabase SQL Editor. Es idempotente.

-- 1) Columna + FK (si la tabla existe)
do $$
begin
  if to_regclass('public.escandallos') is null then
    raise notice 'Tabla public.escandallos no existe; omitiendo patch.';
    return;
  end if;

  -- Añadir columna si falta (nullable inicialmente para permitir backfill)
  execute 'alter table public.escandallos add column if not exists establecimiento_id uuid';

  -- FK a establecimientos (si existe la tabla establecimientos)
  if to_regclass('public.establecimientos') is not null then
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where c.conname = 'escandallos_establecimiento_fk'
        and n.nspname = 'public'
        and t.relname = 'escandallos'
    ) then
      execute 'alter table public.escandallos add constraint escandallos_establecimiento_fk foreign key (establecimiento_id) references public.establecimientos(id) on delete restrict';
    end if;
  end if;
end $$;

-- 2) Backfill: NULL o desalineado -> productos.establecimiento_id
do $$
begin
  if to_regclass('public.escandallos') is null then
    return;
  end if;
  if to_regclass('public.productos') is null then
    return;
  end if;

  -- (a) NULL => establecimiento del producto
  execute $sql$
    update public.escandallos e
    set establecimiento_id = p.establecimiento_id
    from public.productos p
    where p.id = e.producto_id
      and e.establecimiento_id is null
  $sql$;

  -- (b) Desalineado (superadmin pudo insertar con establecimiento activo incorrecto)
  execute $sql$
    update public.escandallos e
    set establecimiento_id = p.establecimiento_id
    from public.productos p
    where p.id = e.producto_id
      and e.establecimiento_id is not null
      and p.establecimiento_id is not null
      and e.establecimiento_id <> p.establecimiento_id
  $sql$;
end $$;

-- 3) Enforce consistencia con trigger
create or replace function public.escandallos_force_establecimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Si el producto existe, forzamos establecimiento_id = productos.establecimiento_id
  select p.establecimiento_id into new.establecimiento_id
  from public.productos p
  where p.id = new.producto_id
  limit 1;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.escandallos') is null then
    return;
  end if;
  execute 'drop trigger if exists escandallos_force_establecimiento_trg on public.escandallos';
  execute 'create trigger escandallos_force_establecimiento_trg before insert or update of producto_id on public.escandallos for each row execute function public.escandallos_force_establecimiento()';
end $$;

-- 4) NOT NULL (solo si ya no quedan NULLs)
do $$
declare
  remaining int;
begin
  if to_regclass('public.escandallos') is null then
    return;
  end if;
  execute 'select count(*) from public.escandallos where establecimiento_id is null' into remaining;
  if remaining = 0 then
    execute 'alter table public.escandallos alter column establecimiento_id set not null';
  else
    raise notice 'Quedan % filas con establecimiento_id NULL en escandallos; no se aplica NOT NULL todavía.', remaining;
  end if;
end $$;

-- 5) RLS policies (alineadas con el patch rls-superadmin-global-bypass.sql)
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

