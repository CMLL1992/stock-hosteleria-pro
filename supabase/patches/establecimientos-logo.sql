-- Añadir logo URL a establecimientos
alter table public.establecimientos
  add column if not exists logo_url text;

