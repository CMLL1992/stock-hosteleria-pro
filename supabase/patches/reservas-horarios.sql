-- Horarios de reservas (por establecimiento, por día de semana) + realtime-friendly
-- Ejecutar en Supabase SQL Editor.

-- Tabla final (SaaS): usa nombres de columna "de negocio"
create table if not exists public.sala_horarios (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null default public.my_establecimiento_id(),
  dia_semana int not null check (dia_semana >= 0 and dia_semana <= 6), -- 0=domingo .. 6=sábado
  activo boolean not null default true,
  hora_inicio time not null default '20:00',
  hora_fin time not null default '23:00',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists sala_horarios_est_dia_semana_uniq on public.sala_horarios (establecimiento_id, dia_semana);
create index if not exists sala_horarios_est_idx on public.sala_horarios (establecimiento_id);

-- Migración desde esquema anterior (si existía): dow/abierto/hora_apertura/hora_cierre
-- (Hace que el patch sea "idempotente" entre entornos)
alter table public.sala_horarios add column if not exists dow int;
alter table public.sala_horarios add column if not exists abierto boolean;
alter table public.sala_horarios add column if not exists hora_apertura time;
alter table public.sala_horarios add column if not exists hora_cierre time;

-- Backfill si las columnas nuevas están NULL
update public.sala_horarios
set
  dia_semana = coalesce(dia_semana, dow),
  activo = coalesce(activo, abierto, true),
  hora_inicio = coalesce(hora_inicio, hora_apertura, '20:00'::time),
  hora_fin = coalesce(hora_fin, hora_cierre, '23:00'::time)
where dia_semana is null
   or activo is null
   or hora_inicio is null
   or hora_fin is null;

-- updated_at trigger (reutiliza touch_updated_at si existe)
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_touch_sala_horarios_updated_at'
  ) then
    create trigger trg_touch_sala_horarios_updated_at
    before update on public.sala_horarios
    for each row
    execute function public.touch_updated_at();
  end if;
end $$;

-- RLS
alter table public.sala_horarios enable row level security;

drop policy if exists sala_horarios_select on public.sala_horarios;
create policy sala_horarios_select
on public.sala_horarios
for select
to authenticated, anon
using (true);

drop policy if exists sala_horarios_write on public.sala_horarios;
create policy sala_horarios_write
on public.sala_horarios
for all
to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id())
with check (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

