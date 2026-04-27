-- Reservas públicas: lectura pública del establecimiento por slug (anon)
-- Objetivo UX: que cualquier cliente pueda cargar nombre/logo del local al abrir /reservar/[slug]
--
-- Recomendación SaaS:
-- - Preferir RPC SECURITY DEFINER (ya existe: get_establecimiento_public / get_disponibilidad_public).
-- - Si aun así quieres permitir SELECT anon directo, hazlo solo para filas con slug publicado.
--
-- Ejecutar en Supabase SQL Editor.

-- 1) View pública con solo campos básicos (recomendado)
create or replace view public.establecimientos_public as
select
  e.id,
  e.nombre,
  e.slug,
  e.logo_url
from public.establecimientos e
where e.slug is not null and length(trim(e.slug)) > 0;

grant select on public.establecimientos_public to anon;
grant select on public.establecimientos_public to authenticated;

-- 2) (Opcional) Política RLS en la tabla base para anon
-- ATENCIÓN: RLS no limita columnas; si habilitas SELECT anon en la tabla,
-- un usuario público podría leer otros campos del establecimiento (plan, etc.)
-- si existen y si tienen permisos de SELECT.
--
-- Si decides habilitarlo igualmente, descomenta:
-- alter table public.establecimientos enable row level security;
-- drop policy if exists establecimientos_select_public_by_slug on public.establecimientos;
-- create policy establecimientos_select_public_by_slug
-- on public.establecimientos
-- for select
-- to anon
-- using (slug is not null and length(trim(slug)) > 0);

