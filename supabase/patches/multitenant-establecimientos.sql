-- OPS SaaS: Multi-establecimiento + Superadmin + RLS por establecimiento
-- Ejecuta esto en Supabase SQL Editor (en orden).

create extension if not exists pgcrypto;

-- 1) Tabla establecimientos
create table if not exists public.establecimientos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  plan_suscripcion text not null default 'free',
  created_at timestamptz not null default now()
);

-- 2) Rol superadmin (si el enum existe)
do $$
begin
  if exists (select 1 from pg_type where typname = 'user_role') then
    begin
      alter type public.user_role add value if not exists 'superadmin';
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- 3) Crea establecimiento default y úsalo para backfill
do $$
declare
  default_est uuid;
begin
  select id into default_est from public.establecimientos order by created_at asc limit 1;
  if default_est is null then
    insert into public.establecimientos(nombre, plan_suscripcion)
    values ('Default', 'free')
    returning id into default_est;
  end if;

  -- 4) Añade establecimiento_id a tablas (incluyendo proveedores por consistencia)
  alter table public.usuarios add column if not exists establecimiento_id uuid;
  alter table public.productos add column if not exists establecimiento_id uuid;
  alter table public.movimientos add column if not exists establecimiento_id uuid;
  alter table public.proveedores add column if not exists establecimiento_id uuid;

  -- Backfill existentes
  update public.usuarios set establecimiento_id = default_est where establecimiento_id is null;
  update public.productos set establecimiento_id = default_est where establecimiento_id is null;
  update public.movimientos set establecimiento_id = default_est where establecimiento_id is null;
  update public.proveedores set establecimiento_id = default_est where establecimiento_id is null;

  -- FK + NOT NULL
  alter table public.usuarios
    add constraint if not exists usuarios_establecimiento_fk
      foreign key (establecimiento_id) references public.establecimientos(id) on delete restrict;
  alter table public.productos
    add constraint if not exists productos_establecimiento_fk
      foreign key (establecimiento_id) references public.establecimientos(id) on delete restrict;
  alter table public.movimientos
    add constraint if not exists movimientos_establecimiento_fk
      foreign key (establecimiento_id) references public.establecimientos(id) on delete restrict;
  alter table public.proveedores
    add constraint if not exists proveedores_establecimiento_fk
      foreign key (establecimiento_id) references public.establecimientos(id) on delete restrict;

  alter table public.usuarios alter column establecimiento_id set not null;
  alter table public.productos alter column establecimiento_id set not null;
  alter table public.movimientos alter column establecimiento_id set not null;
  alter table public.proveedores alter column establecimiento_id set not null;
end $$;

-- 5) Helpers para RLS (SECURITY DEFINER evita recursión: la lectura de usuarios no aplica
--    otra evaluación de RLS vía is_superadmin/my_establecimiento_id).
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

-- 6) RLS: establecimientos visibles solo para miembros; superadmin ve todo
alter table public.establecimientos enable row level security;

drop policy if exists "establecimientos_select_own_or_superadmin" on public.establecimientos;
create policy "establecimientos_select_own_or_superadmin"
on public.establecimientos
for select
to authenticated
using (public.is_superadmin() or id = public.my_establecimiento_id());

-- 7) RLS: usuarios por establecimiento; superadmin CRUD
alter table public.usuarios enable row level security;

drop policy if exists "usuarios_select_est_or_superadmin" on public.usuarios;
create policy "usuarios_select_est_or_superadmin"
on public.usuarios
for select
to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

drop policy if exists "usuarios_superadmin_write" on public.usuarios;
create policy "usuarios_superadmin_write"
on public.usuarios
for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

-- 8) RLS: proveedores/productos por establecimiento; admin CRUD dentro del est; superadmin todo
alter table public.proveedores enable row level security;
alter table public.productos enable row level security;

drop policy if exists "proveedores_select_est_or_superadmin" on public.proveedores;
create policy "proveedores_select_est_or_superadmin"
on public.proveedores
for select
to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

drop policy if exists "proveedores_admin_write_est" on public.proveedores;
create policy "proveedores_admin_write_est"
on public.proveedores
for insert
to authenticated
with check ((public.is_superadmin() or public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists "proveedores_admin_update_est" on public.proveedores;
create policy "proveedores_admin_update_est"
on public.proveedores
for update
to authenticated
using ((public.is_superadmin() or public.is_admin()) and establecimiento_id = public.my_establecimiento_id())
with check ((public.is_superadmin() or public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists "proveedores_admin_delete_est" on public.proveedores;
create policy "proveedores_admin_delete_est"
on public.proveedores
for delete
to authenticated
using ((public.is_superadmin() or public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists "productos_select_est_or_superadmin" on public.productos;
create policy "productos_select_est_or_superadmin"
on public.productos
for select
to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

drop policy if exists "productos_admin_insert_est" on public.productos;
create policy "productos_admin_insert_est"
on public.productos
for insert
to authenticated
with check ((public.is_superadmin() or public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists "productos_admin_update_est" on public.productos;
create policy "productos_admin_update_est"
on public.productos
for update
to authenticated
using ((public.is_superadmin() or public.is_admin()) and establecimiento_id = public.my_establecimiento_id())
with check ((public.is_superadmin() or public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists "productos_admin_delete_est" on public.productos;
create policy "productos_admin_delete_est"
on public.productos
for delete
to authenticated
using ((public.is_superadmin() or public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

-- 9) RLS: movimientos por establecimiento; inserción obliga establecimiento correcto
alter table public.movimientos enable row level security;

drop policy if exists "movimientos_select_est_or_superadmin" on public.movimientos;
create policy "movimientos_select_est_or_superadmin"
on public.movimientos
for select
to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

drop policy if exists "movimientos_insert_own_est" on public.movimientos;
create policy "movimientos_insert_own_est"
on public.movimientos
for insert
to authenticated
with check (usuario_id = auth.uid() and establecimiento_id = public.my_establecimiento_id());

