-- Recepción de pedidos (compras) - transacción segura (OPS)
-- Pegar y ejecutar en Supabase → SQL Editor
--
-- Incluye:
-- - Nuevo tipo de movimiento: entrada_compra
-- - movimientos.proveedor_id para trazabilidad
-- - Trigger apply_stock_movement actualizado para entrada_compra
-- - RPC public.confirm_recepcion(...) para confirmar recepción en una sola transacción

-- 1) Extender enum movimiento_tipo
do $$
begin
  if exists (select 1 from pg_type where typname = 'movimiento_tipo') then
    begin
      alter type public.movimiento_tipo add value if not exists 'entrada_compra';
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- 2) Añadir proveedor_id a movimientos (trazabilidad)
alter table public.movimientos
  add column if not exists proveedor_id uuid references public.proveedores(id) on delete set null;

create index if not exists movimientos_proveedor_ts_idx on public.movimientos (proveedor_id, timestamp desc);

-- 3) Trigger stock: entrada_compra suma a stock_actual
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

    -- Stock vacíos (si existe columna y tipos)
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

-- 4) RPC: confirmar recepción en transacción
--    Inserta movimientos entrada_compra (y devolucion_proveedor si vacíos_dev > 0).
--    El trigger actualiza stock_actual/stock_vacios.
create or replace function public.confirm_recepcion(
  p_proveedor_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est uuid;
  v_uid uuid;
  v_count int := 0;
  v_count_vacios int := 0;
  it jsonb;
  v_producto uuid;
  v_recibido int;
  v_vacios int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  v_est := public.my_establecimiento_id();
  if v_est is null then
    raise exception 'Sin establecimiento activo';
  end if;

  if p_proveedor_id is null then
    raise exception 'Falta proveedor_id';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items debe ser un array JSON';
  end if;

  -- Validación: proveedor pertenece al establecimiento
  if not exists (
    select 1 from public.proveedores pr
    where pr.id = p_proveedor_id
      and pr.establecimiento_id = v_est
  ) then
    raise exception 'Proveedor no pertenece al establecimiento';
  end if;

  for it in select * from jsonb_array_elements(p_items)
  loop
    v_producto := nullif(it->>'producto_id','')::uuid;
    v_recibido := greatest(0, coalesce(nullif(it->>'recibido','')::int, 0));
    v_vacios := greatest(0, coalesce(nullif(it->>'vacios','')::int, 0));

    if v_producto is null then
      continue;
    end if;

    -- Validación: producto pertenece al establecimiento y al proveedor
    if not exists (
      select 1
      from public.productos p
      where p.id = v_producto
        and p.establecimiento_id = v_est
        and p.proveedor_id = p_proveedor_id
    ) then
      raise exception 'Producto inválido para el proveedor/establecimiento';
    end if;

    if v_recibido > 0 then
      insert into public.movimientos (
        producto_id, tipo, cantidad, usuario_id, timestamp, establecimiento_id, proveedor_id
      ) values (
        v_producto, 'entrada_compra', v_recibido, v_uid, now(), v_est, p_proveedor_id
      );
      v_count := v_count + 1;
    end if;

    if v_vacios > 0 then
      insert into public.movimientos (
        producto_id, tipo, cantidad, usuario_id, timestamp, establecimiento_id, proveedor_id
      ) values (
        v_producto, 'devolucion_proveedor', v_vacios, v_uid, now(), v_est, p_proveedor_id
      );
      v_count_vacios := v_count_vacios + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'movimientos_compra', v_count,
    'movimientos_vacios', v_count_vacios
  );
end;
$$;

grant execute on function public.confirm_recepcion(uuid, jsonb) to authenticated;

