-- Índice único para upsert multi-tenant por (establecimiento_id, articulo).
-- Ejecutar en Supabase SQL Editor si la importación CSV devuelve error de conflicto
-- (p. ej. no existe restricción única para onConflict).

create unique index if not exists productos_establecimiento_articulo_uq
  on public.productos (establecimiento_id, articulo);
