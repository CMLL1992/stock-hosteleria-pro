-- Escandallos de cocina (cálculo teórico; no afecta al stock).
-- Nota: este módulo NO reutiliza `public.escandallos` (finanzas de compra) para evitar colisiones.
-- Crea:
-- - public.escandallos_cocina (1 por nombre de plato y establecimiento; sin producto_id / sin stock)
-- - public.escandallo_ingredientes (líneas por escandallo)
--
-- Ejecuta en Supabase → SQL Editor. Idempotente.
-- Si ya tenías la versión antigua con `producto_id`, ejecuta también:
--   supabase/patches/escandallos-cocina-nombre-plato.sql

create extension if not exists pgcrypto;

-- 1) Tabla principal
create table if not exists public.escandallos_cocina (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete restrict,
  nombre_plato text not null,
  raciones_lote numeric(12,3) not null default 1,
  multiplicador numeric(12,3) not null default 3.5,
  iva_final integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  -- Un escandallo por nombre de plato y establecimiento
  if not exists (select 1 from pg_constraint where conname = 'escandallos_cocina_unique_est_nombre') then
    alter table public.escandallos_cocina
      add constraint escandallos_cocina_unique_est_nombre unique (establecimiento_id, nombre_plato);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'escandallos_cocina_iva_chk') then
    alter table public.escandallos_cocina
      add constraint escandallos_cocina_iva_chk check (iva_final in (0,4,10,21));
  end if;
end $$;

-- updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists escandallos_cocina_touch on public.escandallos_cocina;
create trigger escandallos_cocina_touch
before update on public.escandallos_cocina
for each row execute function public.touch_updated_at();

-- 2) Ingredientes
create table if not exists public.escandallo_ingredientes (
  id uuid primary key default gen_random_uuid(),
  escandallo_id uuid not null references public.escandallos_cocina(id) on delete cascade,
  establecimiento_id uuid not null references public.establecimientos(id) on delete restrict,
  nombre_ingrediente text not null,
  cantidad_gramos_ml numeric(12,3) not null default 0,
  precio_compra_sin_iva numeric(12,4) not null default 0, -- €/kg o €/L (sin IVA)
  porcentaje_merma numeric(12,3) not null default 0,
  iva_ingrediente integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'escandallo_ingredientes_iva_chk') then
    alter table public.escandallo_ingredientes
      add constraint escandallo_ingredientes_iva_chk check (iva_ingrediente in (0,4,10,21));
  end if;
end $$;

drop trigger if exists escandallo_ingredientes_touch on public.escandallo_ingredientes;
create trigger escandallo_ingredientes_touch
before update on public.escandallo_ingredientes
for each row execute function public.touch_updated_at();

-- 3) RLS
alter table public.escandallos_cocina enable row level security;
alter table public.escandallo_ingredientes enable row level security;

-- Policies: admin/superadmin dentro de establecimiento; superadmin bypass global
drop policy if exists esc_cocina_select on public.escandallos_cocina;
create policy esc_cocina_select
on public.escandallos_cocina
for select
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

drop policy if exists esc_cocina_insert on public.escandallos_cocina;
create policy esc_cocina_insert
on public.escandallos_cocina
for insert
to authenticated
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

drop policy if exists esc_cocina_update on public.escandallos_cocina;
create policy esc_cocina_update
on public.escandallos_cocina
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

drop policy if exists esc_cocina_delete on public.escandallos_cocina;
create policy esc_cocina_delete
on public.escandallos_cocina
for delete
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

drop policy if exists esc_ing_select on public.escandallo_ingredientes;
create policy esc_ing_select
on public.escandallo_ingredientes
for select
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

drop policy if exists esc_ing_insert on public.escandallo_ingredientes;
create policy esc_ing_insert
on public.escandallo_ingredientes
for insert
to authenticated
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

drop policy if exists esc_ing_update on public.escandallo_ingredientes;
create policy esc_ing_update
on public.escandallo_ingredientes
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

drop policy if exists esc_ing_delete on public.escandallo_ingredientes;
create policy esc_ing_delete
on public.escandallo_ingredientes
for delete
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

