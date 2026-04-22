-- Delete product safely (cascade in app logic) to avoid FK violations (23503).
-- Deletes movimientos + escandallos rows for a given producto_id, then deletes the product.
-- SECURITY DEFINER: bypass RLS for consistent cleanup.

create or replace function public.delete_producto_cascade(p_producto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_superadmin boolean;
  v_is_admin boolean;
  v_est uuid;
  v_prod_est uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  v_is_superadmin := public.is_superadmin();
  v_is_admin := public.is_admin();
  if not (v_is_superadmin or v_is_admin) then
    raise exception 'Forbidden';
  end if;

  if p_producto_id is null then
    raise exception 'Falta producto_id';
  end if;

  select p.establecimiento_id into v_prod_est
  from public.productos p
  where p.id = p_producto_id
  limit 1;

  if v_prod_est is null then
    return jsonb_build_object('ok', false, 'message', 'Producto no encontrado');
  end if;

  -- Admin normal solo dentro de su establecimiento
  if not v_is_superadmin then
    v_est := public.my_establecimiento_id();
    if v_est is null or v_est <> v_prod_est then
      raise exception 'Forbidden';
    end if;
  end if;

  -- 1) Movimientos (incluye compras/pedidos/vacíos)
  delete from public.movimientos m where m.producto_id = p_producto_id;

  -- 2) Escandallos (si existe)
  begin
    delete from public.escandallos e where e.producto_id = p_producto_id;
  exception when undefined_table then
    -- ignore: escandallos no existe en algunos entornos
    null;
  end;

  -- 3) Producto
  delete from public.productos p where p.id = p_producto_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.delete_producto_cascade(uuid) to authenticated;

