-- RPCs checklist “comunidad por establecimiento”.
-- - Listar tareas del local (sin filtro por creador).
-- - Crear tarea usando el establecimiento del usuario o el establecimiento activo (superadmin).
-- Ejecutar en Supabase → SQL Editor. Idempotente.

create extension if not exists pgcrypto;

-- Listar tareas del establecimiento (opcional: tipo/activo)
create or replace function public.list_checklists_tareas(
  p_establecimiento_id uuid default null,
  p_tipo text default null,
  p_activo_only boolean default false
)
returns table (
  id uuid,
  establecimiento_id uuid,
  tipo text,
  titulo text,
  orden integer,
  activo boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_est uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if public.is_superadmin() and p_establecimiento_id is not null then
    v_est := p_establecimiento_id;
  else
    v_est := public.my_establecimiento_id();
  end if;

  if v_est is null then
    raise exception 'no establecimiento for user %', auth.uid();
  end if;

  if (not public.is_superadmin()) and p_establecimiento_id is not null and p_establecimiento_id <> v_est then
    raise exception 'forbidden establecimiento_id';
  end if;

  return query
  select
    t.id,
    t.establecimiento_id,
    t.tipo,
    t.titulo,
    t.orden,
    t.activo,
    t.created_at
  from public.checklists_tareas t
  where t.establecimiento_id = v_est
    and (p_tipo is null or t.tipo = p_tipo)
    and (not p_activo_only or t.activo = true)
  order by t.tipo asc, t.orden asc, t.titulo asc;
end;
$$;

revoke all on function public.list_checklists_tareas(uuid, text, boolean) from public;
grant execute on function public.list_checklists_tareas(uuid, text, boolean) to authenticated;

-- Crear tarea (superadmin puede forzar establecimiento activo)
create or replace function public.create_checklists_tarea(
  p_tipo text,
  p_titulo text,
  p_orden integer default 0,
  p_activo boolean default true,
  p_establecimiento_id uuid default null
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

  if public.is_superadmin() and p_establecimiento_id is not null then
    v_est := p_establecimiento_id;
  else
    v_est := public.my_establecimiento_id();
  end if;

  if v_est is null then
    raise exception 'no establecimiento for user %', auth.uid();
  end if;

  if (not public.is_superadmin()) and p_establecimiento_id is not null and p_establecimiento_id <> v_est then
    raise exception 'forbidden establecimiento_id';
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

revoke all on function public.create_checklists_tarea(text, text, integer, boolean, uuid) from public;
grant execute on function public.create_checklists_tarea(text, text, integer, boolean, uuid) to authenticated;

