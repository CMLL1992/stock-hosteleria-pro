-- Sistema de Gestión de Stock Hostelería (Supabase)
-- Incluye tablas, trigger para mantener stock_actual y RLS por roles.

create extension if not exists pgcrypto;

-- Roles de aplicación
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'staff');
  end if;
end $$;

create table if not exists public.usuarios (
  id uuid primary key,
  email text unique,
  rol public.user_role not null default 'staff',
  created_at timestamptz not null default now()
);

create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono_whatsapp text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  stock_actual integer not null default 0,
  stock_minimo integer,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  qr_code_uid text not null unique,
  -- Finanzas / Escandallos
  precio_tarifa numeric(12,2) not null default 0,
  descuento_valor numeric(12,2) not null default 0,
  descuento_tipo text not null default '%',
  iva_compra integer not null default 10,
  pvp numeric(12,2) not null default 0,
  iva_venta integer not null default 10,
  created_at timestamptz not null default now()
);

do $$
begin
  begin
    alter table public.productos
      add constraint productos_descuento_tipo_chk check (descuento_tipo in ('%','€'));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.productos
      add constraint productos_iva_compra_chk check (iva_compra in (4,10,21));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.productos
      add constraint productos_iva_venta_chk check (iva_venta in (4,10,21));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.productos
      add constraint productos_precios_nonneg_chk check (
        precio_tarifa >= 0 and descuento_valor >= 0 and pvp >= 0
      );
  exception when duplicate_object then null;
  end;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'movimiento_tipo') then
    create type public.movimiento_tipo as enum ('entrada', 'salida', 'pedido');
  end if;
end $$;

create table if not exists public.movimientos (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete restrict,
  tipo public.movimiento_tipo not null,
  cantidad integer not null check (cantidad > 0),
  usuario_id uuid not null,
  timestamp timestamptz not null default now()
);

create index if not exists movimientos_producto_ts_idx on public.movimientos(producto_id, timestamp desc);

-- Helper: es admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.rol = 'admin'
  );
$$;

-- Trigger: mantener stock_actual a partir de movimientos (entrada suma; salida/pedido resta)
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    if new.tipo = 'entrada' then
      update public.productos set stock_actual = stock_actual + new.cantidad where id = new.producto_id;
    else
      update public.productos set stock_actual = stock_actual - new.cantidad where id = new.producto_id;
    end if;
    return new;
  end if;

  return null;
end;
$$;

drop trigger if exists movimientos_apply_stock on public.movimientos;
create trigger movimientos_apply_stock
after insert on public.movimientos
for each row execute function public.apply_stock_movement();

-- RLS
alter table public.usuarios enable row level security;
alter table public.proveedores enable row level security;
alter table public.productos enable row level security;
alter table public.movimientos enable row level security;

-- usuarios: cada usuario puede leer su fila; solo admin puede gestionar roles.
drop policy if exists "usuarios_select_own" on public.usuarios;
create policy "usuarios_select_own"
on public.usuarios
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "usuarios_admin_write" on public.usuarios;
create policy "usuarios_admin_write"
on public.usuarios
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- proveedores: staff puede leer; admin CRUD
drop policy if exists "proveedores_read_all" on public.proveedores;
create policy "proveedores_read_all"
on public.proveedores
for select
to authenticated
using (true);

drop policy if exists "proveedores_admin_write" on public.proveedores;
create policy "proveedores_admin_write"
on public.proveedores
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "proveedores_admin_update" on public.proveedores;
create policy "proveedores_admin_update"
on public.proveedores
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "proveedores_admin_delete" on public.proveedores;
create policy "proveedores_admin_delete"
on public.proveedores
for delete
to authenticated
using (public.is_admin());

-- productos: staff puede leer; admin CRUD
drop policy if exists "productos_read_all" on public.productos;
create policy "productos_read_all"
on public.productos
for select
to authenticated
using (true);

drop policy if exists "productos_admin_insert" on public.productos;
create policy "productos_admin_insert"
on public.productos
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "productos_admin_update" on public.productos;
create policy "productos_admin_update"
on public.productos
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "productos_admin_delete" on public.productos;
create policy "productos_admin_delete"
on public.productos
for delete
to authenticated
using (public.is_admin());

-- movimientos: staff y admin pueden insertar movimientos para sí mismos; lectura según rol (admin ve todo)
drop policy if exists "movimientos_insert_own" on public.movimientos;
create policy "movimientos_insert_own"
on public.movimientos
for insert
to authenticated
with check (usuario_id = auth.uid());

drop policy if exists "movimientos_select_admin_all_or_own" on public.movimientos;
create policy "movimientos_select_admin_all_or_own"
on public.movimientos
for select
to authenticated
using (public.is_admin() or usuario_id = auth.uid());

-- Bloquear updates/deletes (inmutable). Solo admin podría borrar si lo quisieras; por defecto, nadie.

