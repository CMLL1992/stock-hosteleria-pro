-- RPC: guardar escandallo de cocina (cabecera + ingredientes) usando establecimiento en BD.
-- Evita errores RLS por establecimiento_id incorrecto en el cliente.
-- Ejecutar en Supabase → SQL Editor. Idempotente.

create extension if not exists pgcrypto;

create or replace function public.save_escandallo_cocina(
  p_nombre_plato text,
  p_raciones_lote numeric default 1,
  p_multiplicador numeric default 3.5,
  p_iva_final integer default 10,
  p_ingredientes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_est uuid;
  v_esc_id uuid;
  v_iva integer;
  v_it jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_est := public.my_establecimiento_id();
  if v_est is null then
    raise exception 'no establecimiento for user %', auth.uid();
  end if;

  if p_nombre_plato is null or trim(p_nombre_plato) = '' then
    raise exception 'nombre_plato is required';
  end if;

  v_iva := coalesce(p_iva_final, 10);
  if v_iva not in (0,4,10,21) then
    v_iva := 10;
  end if;

  insert into public.escandallos_cocina (establecimiento_id, nombre_plato, raciones_lote, multiplicador, iva_final)
  values (
    v_est,
    trim(p_nombre_plato),
    greatest(0.000001, coalesce(p_raciones_lote, 1)),
    greatest(0, coalesce(p_multiplicador, 3.5)),
    v_iva
  )
  on conflict (establecimiento_id, nombre_plato) do update set
    raciones_lote = excluded.raciones_lote,
    multiplicador = excluded.multiplicador,
    iva_final = excluded.iva_final,
    updated_at = now()
  returning id into v_esc_id;

  delete from public.escandallo_ingredientes
  where escandallo_id = v_esc_id
    and establecimiento_id = v_est;

  if jsonb_typeof(p_ingredientes) = 'array' then
    for v_it in select * from jsonb_array_elements(p_ingredientes)
    loop
      insert into public.escandallo_ingredientes (
        escandallo_id,
        establecimiento_id,
        nombre_ingrediente,
        cantidad_gramos_ml,
        precio_compra_sin_iva,
        porcentaje_merma,
        iva_ingrediente
      )
      values (
        v_esc_id,
        v_est,
        trim(coalesce(v_it->>'nombre_ingrediente', '')),
        greatest(0, coalesce((v_it->>'cantidad_gramos_ml')::numeric, 0)),
        greatest(0, coalesce((v_it->>'precio_compra_sin_iva')::numeric, 0)),
        greatest(0, coalesce((v_it->>'porcentaje_merma')::numeric, 0)),
        case
          when coalesce((v_it->>'iva_ingrediente')::int, 10) in (0,4,10,21) then coalesce((v_it->>'iva_ingrediente')::int, 10)
          else 10
        end
      );
    end loop;
  end if;

  return v_esc_id;
end;
$$;

revoke all on function public.save_escandallo_cocina(text, numeric, numeric, integer, jsonb) from public;
grant execute on function public.save_escandallo_cocina(text, numeric, numeric, integer, jsonb) to authenticated;

