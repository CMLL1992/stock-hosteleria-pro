-- Ampliar checks de productos: aceptar categoria/tipo 'comida' y unidad 'bolsa' (y 'gas').
-- Ejecuta esto en Supabase → SQL Editor.
--
-- Motivo:
-- - En algunos entornos antiguos la app usa `tipo` como fallback de `categoria` (compat).
-- - Si existe CHECK constraint, insertar/editar con "comida" o "bolsa" puede fallar.

do $$
begin
  -- Reemplazar constraint de tipo (si existe) para incluir 'comida'
  if exists (select 1 from pg_constraint where conname = 'productos_tipo_check') then
    begin
      alter table public.productos drop constraint productos_tipo_check;
    exception when undefined_object then null;
    end;
  end if;

  alter table public.productos
    add constraint productos_tipo_check
    check (tipo is null or tipo in ('barril','refresco','cerveza','vino','licor','agua','comida','otros'));

  -- Reemplazar constraint de unidad (si existe) para incluir 'bolsa' y 'gas'
  if exists (select 1 from pg_constraint where conname = 'productos_unidad_check') then
    begin
      alter table public.productos drop constraint productos_unidad_check;
    exception when undefined_object then null;
    end;
  end if;

  alter table public.productos
    add constraint productos_unidad_check
    check (unidad is null or unidad in ('caja','barril','botella','lata','unidad','gas','bolsa'));
end $$;

