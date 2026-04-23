-- Escandallos de cocina: nombre de plato manual (sin producto_id / sin stock).
-- Ejecutar en Supabase → SQL Editor si ya aplicaste escandallos-cocina.sql con `producto_id`.
-- Idempotente.

do $$
begin
  if to_regclass('public.escandallos_cocina') is null then
    raise notice 'Tabla public.escandallos_cocina no existe; aplica antes supabase/patches/escandallos-cocina.sql (versión actual).';
    return;
  end if;
end $$;

-- 1) Columna nombre del plato
alter table public.escandallos_cocina add column if not exists nombre_plato text;

-- 2) Rellenar desde productos solo si aún existe la columna producto_id
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'escandallos_cocina'
      and column_name = 'producto_id'
  ) then
    update public.escandallos_cocina ec
    set nombre_plato = left(coalesce(nullif(trim(p.nombre::text), ''), 'Plato'), 500)
    from public.productos p
    where ec.producto_id is not null
      and p.id = ec.producto_id
      and (ec.nombre_plato is null or trim(ec.nombre_plato) = '');
  end if;
end $$;

update public.escandallos_cocina
set nombre_plato = 'Plato'
where nombre_plato is null or trim(nombre_plato) = '';

alter table public.escandallos_cocina alter column nombre_plato set not null;

-- 3) Quitar unicidad y FK antiguas sobre producto_id
alter table public.escandallos_cocina drop constraint if exists escandallos_cocina_unique_plato_est;

do $$
declare
  cname text;
begin
  for cname in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join unnest(c.conkey) as ak(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ak.attnum
    where n.nspname = 'public'
      and t.relname = 'escandallos_cocina'
      and c.contype = 'f'
      and a.attname = 'producto_id'
  loop
    execute format('alter table public.escandallos_cocina drop constraint if exists %I', cname);
  end loop;
end $$;

alter table public.escandallos_cocina drop column if exists producto_id;

-- Dedupe: mismo nombre en el mismo establecimiento (antes del unique)
with d as (
  select
    id,
    row_number() over (partition by establecimiento_id, trim(nombre_plato) order by created_at) as rn,
    trim(nombre_plato) as base
  from public.escandallos_cocina
)
update public.escandallos_cocina ec
set nombre_plato = left(d.base || ' (' || substring(ec.id::text, 1, 8) || ')', 500)
from d
where ec.id = d.id
  and d.rn > 1;

-- 4) Un escandallo de cocina por nombre dentro del establecimiento
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'escandallos_cocina_unique_est_nombre'
  ) then
    alter table public.escandallos_cocina
      add constraint escandallos_cocina_unique_est_nombre unique (establecimiento_id, nombre_plato);
  end if;
end $$;
