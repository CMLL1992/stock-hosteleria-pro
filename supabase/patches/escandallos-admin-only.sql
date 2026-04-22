-- Escandallos separados de productos (admin-only).
-- Objetivo: evitar que usuarios 'staff' puedan leer márgenes/precios vía SELECT en public.productos.
--
-- Pasos:
-- 1) Crear tabla public.escandallos (1:1 con producto_id).
-- 2) Backfill desde columnas financieras existentes en public.productos (si existen).
-- 3) (Opcional recomendado) Drop columnas financieras de public.productos cuando el código ya use escandallos.
-- 4) RLS: solo admin/superadmin (y del mismo establecimiento) puede SELECT/WRITE.

create table if not exists public.escandallos (
  producto_id uuid primary key references public.productos(id) on delete cascade,
  establecimiento_id uuid not null references public.establecimientos(id) on delete restrict,
  precio_tarifa numeric(12,2) not null default 0,
  uds_caja integer not null default 1,
  descuento_valor numeric(12,2) not null default 0,
  descuento_tipo text not null default '%',
  rappel_valor numeric(12,2) not null default 0,
  iva_compra integer not null default 10,
  pvp numeric(12,2) not null default 0,
  iva_venta integer not null default 10,
  updated_at timestamptz not null default now()
);

do $$
begin
  begin
    alter table public.escandallos
      add constraint escandallos_descuento_tipo_chk check (descuento_tipo in ('%','€'));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.escandallos
      add constraint escandallos_iva_compra_chk check (iva_compra in (4,10,21));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.escandallos
      add constraint escandallos_iva_venta_chk check (iva_venta in (4,10,21));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.escandallos
      add constraint escandallos_precios_nonneg_chk check (
        precio_tarifa >= 0 and descuento_valor >= 0 and rappel_valor >= 0 and pvp >= 0 and uds_caja >= 1
      );
  exception when duplicate_object then null;
  end;
end $$;

-- Mantener updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists escandallos_touch on public.escandallos;
create trigger escandallos_touch
before update on public.escandallos
for each row execute function public.touch_updated_at();

-- Backfill (idempotente): si existen columnas financieras en productos, las copiamos.
-- Nota: esta parte asume que 'public.productos' todavía contiene esas columnas.
insert into public.escandallos (
  producto_id,
  establecimiento_id,
  precio_tarifa,
  uds_caja,
  descuento_valor,
  descuento_tipo,
  rappel_valor,
  iva_compra,
  pvp,
  iva_venta
)
select
  p.id,
  p.establecimiento_id,
  coalesce(p.precio_tarifa, 0),
  greatest(coalesce(p.uds_caja, 1), 1),
  coalesce(p.descuento_valor, 0),
  coalesce(p.descuento_tipo, '%'),
  coalesce(p.rappel_valor, 0),
  coalesce(p.iva_compra, 10),
  coalesce(p.pvp, 0),
  coalesce(p.iva_venta, 10)
from public.productos p
on conflict (producto_id) do nothing;

-- RLS
alter table public.escandallos enable row level security;

drop policy if exists escandallos_select_admin_est on public.escandallos;
create policy escandallos_select_admin_est
on public.escandallos
for select
to authenticated
using (
  (public.is_superadmin() or public.is_admin())
  and establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists escandallos_insert_admin_est on public.escandallos;
create policy escandallos_insert_admin_est
on public.escandallos
for insert
to authenticated
with check (
  (public.is_superadmin() or public.is_admin())
  and establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists escandallos_update_admin_est on public.escandallos;
create policy escandallos_update_admin_est
on public.escandallos
for update
to authenticated
using (
  (public.is_superadmin() or public.is_admin())
  and establecimiento_id = public.my_establecimiento_id()
)
with check (
  (public.is_superadmin() or public.is_admin())
  and establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists escandallos_delete_admin_est on public.escandallos;
create policy escandallos_delete_admin_est
on public.escandallos
for delete
to authenticated
using (
  (public.is_superadmin() or public.is_admin())
  and establecimiento_id = public.my_establecimiento_id()
);

-- Recomendación final (cuando el código ya no lea finanzas desde productos):
-- alter table public.productos
--   drop column if exists precio_tarifa,
--   drop column if exists descuento_valor,
--   drop column if exists descuento_tipo,
--   drop column if exists iva_compra,
--   drop column if exists pvp,
--   drop column if exists iva_venta,
--   drop column if exists uds_caja,
--   drop column if exists rappel_valor;

