-- Rotación de elementos en el plano (p. ej. paredes), en grados.
-- Idempotente: ejecutar en Supabase SQL Editor.

alter table public.sala_mesas
  add column if not exists rotacion_deg double precision not null default 0;

comment on column public.sala_mesas.rotacion_deg is 'Rotación visual en grados (0–359 típico); paredes y decorativos.';
