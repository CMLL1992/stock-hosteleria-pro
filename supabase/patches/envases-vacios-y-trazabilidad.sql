-- Envases vacíos + trazabilidad de movimientos (OPS)
-- Ejecuta esto en Supabase SQL Editor tras multitenant-establecimientos.sql
--
-- Objetivos:
-- - productos.stock_vacios (cuántos envases vacíos hay para devolver)
-- - proveedores: categoría y notas (además de WhatsApp)
-- - nuevos tipos de movimiento para barra/vacíos
-- - trigger que mantiene stock_actual y stock_vacios a partir de movimientos

-- 1) Proveedores: campos extra
alter table public.proveedores
  add column if not exists categoria text,
  add column if not exists notas text;

-- 2) Productos: stock_vacios
alter table public.productos
  add column if not exists stock_vacios integer not null default 0;

-- 3) Tipos de movimiento (extender enum existente si aplica)
do $$
begin
  if exists (select 1 from pg_type where typname = 'movimiento_tipo') then
    begin
      alter type public.movimiento_tipo add value if not exists 'salida_barra';
    exception when duplicate_object then null;
    end;
    begin
      alter type public.movimiento_tipo add value if not exists 'entrada_vacio';
    exception when duplicate_object then null;
    end;
    begin
      alter type public.movimiento_tipo add value if not exists 'devolucion_proveedor';
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- 4) Trigger actualizado:
-- - entrada: stock_actual +cantidad
-- - salida/pedido/salida_barra: stock_actual -cantidad
-- - entrada_vacio: stock_vacios +cantidad
-- - devolucion_proveedor: stock_vacios -cantidad
--
-- Nota: "salida_barra" puede generar vacío además de descontar stock_actual.
-- Para eso añadimos un boolean opcional en movimientos: genera_vacio.
alter table public.movimientos
  add column if not exists genera_vacio boolean not null default false;

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    -- Stock actual
    if new.tipo = 'entrada' then
      update public.productos
      set stock_actual = stock_actual + new.cantidad
      where id = new.producto_id;
    elsif new.tipo in ('salida','pedido','salida_barra') then
      update public.productos
      set stock_actual = stock_actual - new.cantidad
      where id = new.producto_id;
    end if;

    -- Stock vacíos
    if new.tipo = 'entrada_vacio' then
      update public.productos
      set stock_vacios = stock_vacios + new.cantidad
      where id = new.producto_id;
    elsif new.tipo = 'devolucion_proveedor' then
      update public.productos
      set stock_vacios = stock_vacios - new.cantidad
      where id = new.producto_id;
    elsif new.tipo = 'salida_barra' and coalesce(new.genera_vacio, false) then
      update public.productos
      set stock_vacios = stock_vacios + new.cantidad
      where id = new.producto_id;
    end if;

    return new;
  end if;

  return null;
end;
$$;

