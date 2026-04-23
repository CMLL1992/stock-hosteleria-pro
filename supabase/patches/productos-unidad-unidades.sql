-- Añadir unidad 'unidades' al CHECK constraint de productos (OPS)
-- Ejecutar en Supabase SQL editor.

ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_unidad_check;
ALTER TABLE public.productos
  ADD CONSTRAINT productos_unidad_check
  CHECK (unidad IN ('botella', 'caja', 'barril', 'unidad', 'unidades', 'bolsa', 'gas'));

