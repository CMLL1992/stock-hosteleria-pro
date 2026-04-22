-- Operativa envases (manual) + nuevo tipo 'devolucion_envase'
--
-- Cambios:
-- - 'salida_barra' YA NO incrementa stock_vacios automáticamente (se elimina el uso de movimientos.genera_vacio para ese efecto)
-- - nuevo movimiento_tipo: 'devolucion_envase' para registrar devoluciones manuales de vacíos al almacén
-- - trigger apply_stock_movement actualizado:
--   - entrada/entrada_compra: stock_actual +cantidad
--   - salida/pedido/salida_barra: stock_actual -cantidad
--   - entrada_vacio/devolucion_envase: stock_vacios +cantidad
--   - devolucion_proveedor: stock_vacios -cantidad

do $$
begin
  if exists (select 1 from pg_type where typname = 'movimiento_tipo') then
    begin
      alter type public.movimiento_tipo add value if not exists 'devolucion_envase';
    exception when duplicate_object then null;
    end;
  end if;
end $$;

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    -- Stock actual
    if new.tipo in ('entrada','entrada_compra') then
      update public.productos
      set stock_actual = stock_actual + new.cantidad
      where id = new.producto_id;
    elsif new.tipo in ('salida','pedido','salida_barra') then
      update public.productos
      set stock_actual = stock_actual - new.cantidad
      where id = new.producto_id;
    end if;

    -- Stock vacíos (manual)
    if new.tipo in ('entrada_vacio','devolucion_envase') then
      update public.productos
      set stock_vacios = stock_vacios + new.cantidad
      where id = new.producto_id;
    elsif new.tipo = 'devolucion_proveedor' then
      update public.productos
      set stock_vacios = stock_vacios - new.cantidad
      where id = new.producto_id;
    end if;

    return new;
  end if;

  return null;
end;
$$;

