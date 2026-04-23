-- Añadir unidad 'unidades' permitiendo NULL en `unidad` (OPS)
-- Útil si tu BD ya permitía `unidad` vacío / null antes.

ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_unidad_check;
ALTER TABLE public.productos
  ADD CONSTRAINT productos_unidad_check
  CHECK (unidad IS NULL OR unidad IN ('botella', 'caja', 'barril', 'unidad', 'unidades', 'bolsa', 'gas'));

