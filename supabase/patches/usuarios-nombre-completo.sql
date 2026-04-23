-- Añadir trazabilidad humana: nombre completo en usuarios (OPS SaaS)
-- Ejecutar en Supabase SQL editor.

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS nombre_completo text;

