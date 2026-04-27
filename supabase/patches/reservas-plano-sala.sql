-- Reservas + plano de sala (multiusuario, realtime)
-- Ejecutar en Supabase SQL Editor.

create extension if not exists "pgcrypto";

-- 1) Zonas del plano (por establecimiento)
create table if not exists public.sala_zonas (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null default public.my_establecimiento_id(),
  nombre text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sala_zonas_est_sort_idx on public.sala_zonas (establecimiento_id, sort asc, created_at asc);

-- 2) Mesas (posición + estado)
create table if not exists public.sala_mesas (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null default public.my_establecimiento_id(),
  zona_id uuid not null references public.sala_zonas(id) on delete cascade,
  numero int not null,
  pax_max int not null default 4,
  forma text not null default 'rect' check (forma in ('rect','round')),
  x real not null default 0.2 check (x >= 0 and x <= 1),
  y real not null default 0.2 check (y >= 0 and y <= 1),
  estado text not null default 'libre' check (estado in ('libre','reservada','ocupada','sucia')),
  hora_checkin timestamptz null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists sala_mesas_est_zona_num_uniq on public.sala_mesas (establecimiento_id, zona_id, numero);
create index if not exists sala_mesas_est_zona_idx on public.sala_mesas (establecimiento_id, zona_id);
create index if not exists sala_mesas_est_estado_idx on public.sala_mesas (establecimiento_id, estado);

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_touch_sala_mesas_updated_at'
  ) then
    create trigger trg_touch_sala_mesas_updated_at
    before update on public.sala_mesas
    for each row
    execute function public.touch_updated_at();
  end if;
end $$;

-- 3) Reservas (una por mesa y día)
create table if not exists public.sala_reservas (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null default public.my_establecimiento_id(),
  mesa_id uuid not null references public.sala_mesas(id) on delete cascade,
  fecha date not null,
  nombre text not null default '',
  telefono text not null default '',
  pax int not null default 2,
  hora text not null default '21:00',
  prepago_eur numeric(12,2) not null default 0,
  notas text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists sala_reservas_mesa_fecha_uniq on public.sala_reservas (mesa_id, fecha);
create index if not exists sala_reservas_est_fecha_idx on public.sala_reservas (establecimiento_id, fecha);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_touch_sala_reservas_updated_at'
  ) then
    create trigger trg_touch_sala_reservas_updated_at
    before update on public.sala_reservas
    for each row
    execute function public.touch_updated_at();
  end if;
end $$;

-- 4) RLS: aislamiento por establecimiento usando helper my_establecimiento_id()
alter table public.sala_zonas enable row level security;
alter table public.sala_mesas enable row level security;
alter table public.sala_reservas enable row level security;

-- Zonas
drop policy if exists sala_zonas_select on public.sala_zonas;
create policy sala_zonas_select on public.sala_zonas
for select to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

drop policy if exists sala_zonas_write on public.sala_zonas;
create policy sala_zonas_write on public.sala_zonas
for all to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id())
with check (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

-- Mesas
drop policy if exists sala_mesas_select on public.sala_mesas;
create policy sala_mesas_select on public.sala_mesas
for select to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

drop policy if exists sala_mesas_write on public.sala_mesas;
create policy sala_mesas_write on public.sala_mesas
for all to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id())
with check (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

-- Reservas
drop policy if exists sala_reservas_select on public.sala_reservas;
create policy sala_reservas_select on public.sala_reservas
for select to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

drop policy if exists sala_reservas_write on public.sala_reservas;
create policy sala_reservas_write on public.sala_reservas
for all to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id())
with check (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

