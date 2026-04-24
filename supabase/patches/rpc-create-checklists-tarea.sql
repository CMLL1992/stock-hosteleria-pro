-- RPC: crear tareas checklist usando el establecimiento del usuario en BD.
-- Evita errores RLS por establecimiento_id incorrecto en el cliente.
-- Ejecutar en Supabase → SQL Editor. Idempotente.

create extension if not exists pgcrypto;

create or replace function public.create_checklists_tarea(
  p_tipo text,
  p_titulo text,
  p_orden integer default 0,
  p_activo boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_est uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_est := public.my_establecimiento_id();
  if v_est is null then
    raise exception 'no establecimiento for user %', auth.uid();
  end if;

  if p_tipo is null or trim(p_tipo) = '' then
    raise exception 'tipo is required';
  end if;
  if p_tipo not in ('Apertura', 'Cierre') then
    raise exception 'invalid tipo: %', p_tipo;
  end if;

  if p_titulo is null or trim(p_titulo) = '' then
    raise exception 'titulo is required';
  end if;

  insert into public.checklists_tareas (establecimiento_id, tipo, titulo, orden, activo)
  values (v_est, p_tipo, trim(p_titulo), greatest(0, coalesce(p_orden, 0)), coalesce(p_activo, true))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_checklists_tarea(text, text, integer, boolean) from public;
grant execute on function public.create_checklists_tarea(text, text, integer, boolean) to authenticated;

