-- Idempotencia de movimientos + índices de rendimiento (OPS)
-- Ejecutar en Supabase SQL Editor tras multitenant + envases + recepción.

-- 1) Idempotencia: UUID generado en cliente para deduplicar reintentos offline/online
alter table public.movimientos
  add column if not exists client_uuid uuid;

-- Unicidad solo si hay valor (compatibilidad con filas antiguas)
create unique index if not exists movimientos_client_uuid_uq
  on public.movimientos (client_uuid)
  where client_uuid is not null;

-- 2) Índices: MOVIMIENTOS (consultas por tenant e histórico)
create index if not exists movimientos_establecimiento_ts_idx
  on public.movimientos (establecimiento_id, "timestamp" desc);

-- 3) Índices: PRODUCTOS (búsqueda/listados por tenant)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'productos' and column_name = 'articulo'
  ) then
    execute 'create index if not exists productos_establecimiento_articulo_idx on public.productos (establecimiento_id, articulo)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'productos' and column_name = 'nombre'
  ) then
    execute 'create index if not exists productos_establecimiento_nombre_idx on public.productos (establecimiento_id, nombre)';
  end if;
end $$;

