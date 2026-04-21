-- Añadir campos profesionales a productos: tipo, unidad, categoria
-- Ejecuta esto en Supabase SQL Editor.

alter table public.productos
  add column if not exists tipo text,
  add column if not exists unidad text,
  add column if not exists categoria text;

-- Asegurar stock_minimo como integer default 0 (y backfill de nulls).
alter table public.productos
  add column if not exists stock_minimo integer;

update public.productos
set stock_minimo = 0
where stock_minimo is null;

alter table public.productos
  alter column stock_minimo set default 0;

-- Opcional: restricciones para asegurar valores válidos
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'productos_tipo_check'
  ) then
    alter table public.productos
      add constraint productos_tipo_check
      check (tipo is null or tipo in ('barril','refresco','cerveza','vino','licor','agua','otros'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'productos_unidad_check'
  ) then
    alter table public.productos
      add constraint productos_unidad_check
      check (unidad is null or unidad in ('caja','barril','botella','lata','unidad'));
  end if;
end $$;

