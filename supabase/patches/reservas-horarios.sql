-- Horarios de reservas (por establecimiento, por día de semana) + realtime-friendly
-- Ejecutar en Supabase SQL Editor.

create table if not exists public.sala_horarios (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null default public.my_establecimiento_id(),
  dow int not null check (dow >= 0 and dow <= 6), -- 0=domingo .. 6=sábado
  abierto boolean not null default true,
  hora_apertura time not null default '20:00',
  hora_cierre time not null default '23:00',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists sala_horarios_est_dow_uniq on public.sala_horarios (establecimiento_id, dow);
create index if not exists sala_horarios_est_idx on public.sala_horarios (establecimiento_id);

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

