-- Reservas web pública + mejoras ciclo de mesa (checkout)
-- Ejecutar en Supabase SQL Editor.

-- 0) Slug público del establecimiento (para /reservar/[slug])
alter table public.establecimientos
  add column if not exists slug text;

create unique index if not exists establecimientos_slug_uniq
  on public.establecimientos (lower(slug))
  where slug is not null;

-- 1) Mejoras en reservas: estado + email
alter table public.sala_reservas
  add column if not exists estado text not null default 'pendiente' check (estado in ('pendiente','confirmada','cancelada')),
  add column if not exists email text not null default '';

create index if not exists sala_reservas_est_fecha_estado_idx
  on public.sala_reservas (establecimiento_id, fecha, estado);

-- 2) Checkout en mesas
alter table public.sala_mesas
  add column if not exists hora_checkout timestamptz null;

-- 3) RPC público: obtener establecimiento por slug (sin login)
create or replace function public.get_establecimiento_public(p_slug text)
returns table (
  id uuid,
  nombre text,
  logo_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, e.nombre, e.logo_url
  from public.establecimientos e
  where lower(e.slug) = lower(trim(p_slug))
  limit 1;
$$;

grant execute on function public.get_establecimiento_public(text) to anon;
grant execute on function public.get_establecimiento_public(text) to authenticated;

-- 4) RPC público: disponibilidad (capacidad total libre por fecha)
--    Nota MVP: la reserva bloquea la mesa para el día; el "hora" es informativo.
create or replace function public.get_disponibilidad_public(
  p_slug text,
  p_fecha date
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_est uuid;
  v_total int := 0;
  v_reservado int := 0;
  v_libre int := 0;
  v_mesas_total int := 0;
  v_mesas_libres int := 0;
begin
  select e.id into v_est
  from public.establecimientos e
  where lower(e.slug) = lower(trim(p_slug))
  limit 1;
  if v_est is null then
    return jsonb_build_object('ok', false, 'error', 'Establecimiento no encontrado');
  end if;

  select coalesce(sum(m.pax_max),0), count(*) into v_total, v_mesas_total
  from public.sala_mesas m
  where m.establecimiento_id = v_est;

  select coalesce(sum(r.pax),0) into v_reservado
  from public.sala_reservas r
  where r.establecimiento_id = v_est
    and r.fecha = p_fecha
    and r.estado in ('pendiente','confirmada');

  select count(*) into v_mesas_libres
  from public.sala_mesas m
  where m.establecimiento_id = v_est
    and not exists (
      select 1 from public.sala_reservas r
      where r.mesa_id = m.id
        and r.fecha = p_fecha
        and r.estado in ('pendiente','confirmada')
    );

  v_libre := greatest(0, v_total - v_reservado);

  return jsonb_build_object(
    'ok', true,
    'establecimiento_id', v_est,
    'fecha', p_fecha,
    'capacidad_total', v_total,
    'capacidad_reservada', v_reservado,
    'capacidad_libre', v_libre,
    'mesas_total', v_mesas_total,
    'mesas_libres', v_mesas_libres
  );
end;
$$;

grant execute on function public.get_disponibilidad_public(text, date) to anon;
grant execute on function public.get_disponibilidad_public(text, date) to authenticated;

-- 5) RPC público: crear reserva (asigna una mesa libre automáticamente)
create or replace function public.create_reserva_public(
  p_slug text,
  p_fecha date,
  p_hora text,
  p_pax int,
  p_nombre text,
  p_email text,
  p_telefono text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est uuid;
  v_mesa uuid;
  v_reserva uuid;
  v_today date := current_date;
  v_estado text := 'pendiente';
begin
  if p_fecha is null then
    return jsonb_build_object('ok', false, 'error', 'Fecha inválida');
  end if;
  if coalesce(p_pax,0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Pax inválido');
  end if;

  select e.id into v_est
  from public.establecimientos e
  where lower(e.slug) = lower(trim(p_slug))
  limit 1;
  if v_est is null then
    return jsonb_build_object('ok', false, 'error', 'Establecimiento no encontrado');
  end if;

  -- Encuentra una mesa libre para el día
  select m.id into v_mesa
  from public.sala_mesas m
  where m.establecimiento_id = v_est
    and m.pax_max >= p_pax
    and not exists (
      select 1 from public.sala_reservas r
      where r.mesa_id = m.id
        and r.fecha = p_fecha
        and r.estado in ('pendiente','confirmada')
    )
  order by m.pax_max asc, m.numero asc
  limit 1;

  if v_mesa is null then
    return jsonb_build_object('ok', false, 'error', 'No hay mesas disponibles para ese día');
  end if;

  -- Si reserva para hoy, marcamos como confirmada (operativa), si es futura: pendiente.
  if p_fecha = v_today then
    v_estado := 'confirmada';
  end if;

  insert into public.sala_reservas (
    establecimiento_id, mesa_id, fecha, nombre, email, telefono, pax, hora, prepago_eur, notas, estado
  ) values (
    v_est, v_mesa, p_fecha,
    coalesce(trim(p_nombre), ''),
    coalesce(trim(p_email), ''),
    coalesce(trim(p_telefono), ''),
    greatest(1, p_pax),
    coalesce(trim(p_hora), '21:00'),
    0,
    '',
    v_estado
  )
  returning id into v_reserva;

  -- Refleja la reserva en el plano (solo si es hoy y la mesa estaba libre)
  if p_fecha = v_today then
    update public.sala_mesas
    set estado = 'reservada'
    where id = v_mesa
      and estado = 'libre';
  end if;

  return jsonb_build_object(
    'ok', true,
    'reserva_id', v_reserva,
    'mesa_id', v_mesa,
    'estado', v_estado
  );
end;
$$;

grant execute on function public.create_reserva_public(text, date, text, int, text, text, text) to anon;
grant execute on function public.create_reserva_public(text, date, text, int, text, text, text) to authenticated;

