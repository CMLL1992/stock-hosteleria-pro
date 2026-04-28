-- Dimensiones libres (ancho/alto) para elementos del plano.
-- Se almacenan como fracciones 0..1 respecto al contenedor del plano.
-- Idempotente: ejecutar en Supabase SQL Editor.

alter table public.sala_mesas
  add column if not exists width double precision,
  add column if not exists height double precision;

comment on column public.sala_mesas.width is 'Ancho relativo (0..1) respecto al contenedor del plano.';
comment on column public.sala_mesas.height is 'Alto relativo (0..1) respecto al contenedor del plano.';

