-- Decorativos del plano (paredes, barras, textos) en sala_mesas.
-- Idempotente: ejecutar en Supabase SQL Editor.

alter table public.sala_mesas
  add column if not exists es_decorativo boolean not null default false,
  add column if not exists nombre text;

comment on column public.sala_mesas.es_decorativo is 'True si el registro es estructural/decorativo (pared, barra, texto), no reservable.';
comment on column public.sala_mesas.nombre is 'Etiqueta opcional para decorativos (p.ej. \"Pared\", \"Barra\", \"Texto: Zona\").';

