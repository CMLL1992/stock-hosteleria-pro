-- Delete supplier safely to avoid FK violations (23503).
-- Strategy:
-- - If there are pedidos referencing the proveedor, we DO NOT delete (keeps history consistent).
-- - Otherwise: detach productos.proveedor_id = null and delete the proveedor.
-- SECURITY DEFINER: consistent cleanup regardless of RLS.

create or replace function public.delete_proveedor_safe(p_proveedor_id uuid)
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
  v_prov_est uuid;
  v_has_pedidos boolean := false;
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

  if p_proveedor_id is null then
    raise exception 'Falta proveedor_id';
  end if;

  select pr.establecimiento_id into v_prov_est
  from public.proveedores pr
  where pr.id = p_proveedor_id
  limit 1;

  if v_prov_est is null then
    return jsonb_build_object('ok', false, 'message', 'Proveedor no encontrado');
  end if;

  if not v_is_superadmin then
    v_est := public.my_establecimiento_id();
    if v_est is null or v_est <> v_prov_est then
      raise exception 'Forbidden';
    end if;
  end if;

  -- If there are pedidos referencing the proveedor, block delete (pedido.proveedor_id is restrict/not null in some schemas).
  begin
    select exists(select 1 from public.pedidos p where p.proveedor_id = p_proveedor_id limit 1)
    into v_has_pedidos;
  exception when undefined_table then
    v_has_pedidos := false;
  end;

  if coalesce(v_has_pedidos, false) then
    return jsonb_build_object(
      'ok', false,
      'message', 'No se puede eliminar: hay pedidos asociados a este proveedor. (Recomendado: renombrar o dejarlo sin uso).'
    );
  end if;

  -- Detach products (if schema has proveedor_id)
  begin
    update public.productos set proveedor_id = null where proveedor_id = p_proveedor_id;
  exception when undefined_column then
    null;
  end;

  delete from public.proveedores where id = p_proveedor_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.delete_proveedor_safe(uuid) to authenticated;

