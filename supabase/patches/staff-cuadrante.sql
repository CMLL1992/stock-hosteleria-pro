-- Módulo Staff / Cuadrante semanal (empleados, restricciones, asignaciones)
-- Idempotente: ejecutar en Supabase SQL Editor.

create extension if not exists pgcrypto;

-- ===== Tablas =====

create table if not exists public.staff_empleados (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  nombre text not null,
  telefono text,
  rol text not null check (rol in ('Barra','Sala','Cocina')),
  tipo text not null check (tipo in ('Fijo','Extra')),
  notas_rendimiento text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists staff_empleados_est_idx on public.staff_empleados(establecimiento_id);
create index if not exists staff_empleados_tipo_idx on public.staff_empleados(establecimiento_id, tipo);

create table if not exists public.staff_restricciones (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  empleado_id uuid not null references public.staff_empleados(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 1 and 7), -- 1=Lunes .. 7=Domingo
  turno text not null check (turno in ('Mañana','Comida','Tarde','Noche')),
  motivo text,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_restricciones_unique on public.staff_restricciones(empleado_id, dia_semana, turno);
create index if not exists staff_restricciones_est_idx on public.staff_restricciones(establecimiento_id);

create table if not exists public.staff_cuadrante_semanas (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  semana_start date not null, -- lunes de la semana
  created_at timestamptz not null default now(),
  unique (establecimiento_id, semana_start)
);

create index if not exists staff_cuadrante_semanas_est_idx on public.staff_cuadrante_semanas(establecimiento_id, semana_start);

create table if not exists public.staff_cuadrante_celdas (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  semana_id uuid not null references public.staff_cuadrante_semanas(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 1 and 7),
  turno text not null check (turno in ('Mañana','Comida','Tarde','Noche')),
  rol text not null check (rol in ('Barra','Sala','Cocina')),
  required_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (semana_id, dia_semana, turno, rol)
);

create index if not exists staff_cuadrante_celdas_lookup on public.staff_cuadrante_celdas(establecimiento_id, semana_id);

create table if not exists public.staff_cuadrante_asignaciones (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  celda_id uuid not null references public.staff_cuadrante_celdas(id) on delete cascade,
  empleado_id uuid not null references public.staff_empleados(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (celda_id, empleado_id)
);

create index if not exists staff_cuadrante_asig_lookup on public.staff_cuadrante_asignaciones(establecimiento_id, celda_id);

-- ===== RLS =====

alter table public.staff_empleados enable row level security;
alter table public.staff_restricciones enable row level security;
alter table public.staff_cuadrante_semanas enable row level security;
alter table public.staff_cuadrante_celdas enable row level security;
alter table public.staff_cuadrante_asignaciones enable row level security;

-- Lectura: staff/admin del propio establecimiento
drop policy if exists staff_empleados_read on public.staff_empleados;
create policy staff_empleados_read
on public.staff_empleados
for select
to authenticated
using (
  public.is_admin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists staff_restricciones_read on public.staff_restricciones;
create policy staff_restricciones_read
on public.staff_restricciones
for select
to authenticated
using (
  public.is_admin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists staff_cuadrante_read_semanas on public.staff_cuadrante_semanas;
create policy staff_cuadrante_read_semanas
on public.staff_cuadrante_semanas
for select
to authenticated
using (
  public.is_admin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists staff_cuadrante_read_celdas on public.staff_cuadrante_celdas;
create policy staff_cuadrante_read_celdas
on public.staff_cuadrante_celdas
for select
to authenticated
using (
  public.is_admin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists staff_cuadrante_read_asig on public.staff_cuadrante_asignaciones;
create policy staff_cuadrante_read_asig
on public.staff_cuadrante_asignaciones
for select
to authenticated
using (
  public.is_admin()
  or establecimiento_id = public.my_establecimiento_id()
);

-- Escritura: solo admin/superadmin y siempre acotado a su establecimiento
drop policy if exists staff_empleados_write on public.staff_empleados;
create policy staff_empleados_write
on public.staff_empleados
for all
to authenticated
using ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id())
with check ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists staff_restricciones_write on public.staff_restricciones;
create policy staff_restricciones_write
on public.staff_restricciones
for all
to authenticated
using ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id())
with check ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists staff_cuadrante_semanas_write on public.staff_cuadrante_semanas;
create policy staff_cuadrante_semanas_write
on public.staff_cuadrante_semanas
for all
to authenticated
using ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id())
with check ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists staff_cuadrante_celdas_write on public.staff_cuadrante_celdas;
create policy staff_cuadrante_celdas_write
on public.staff_cuadrante_celdas
for all
to authenticated
using ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id())
with check ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

drop policy if exists staff_cuadrante_asig_write on public.staff_cuadrante_asignaciones;
create policy staff_cuadrante_asig_write
on public.staff_cuadrante_asignaciones
for all
to authenticated
using ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id())
with check ((public.is_admin()) and establecimiento_id = public.my_establecimiento_id());

