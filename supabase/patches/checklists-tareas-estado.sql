-- Estado “en vivo” de tareas checklist por establecimiento (completadas/pending).
-- Ejecutar en Supabase → SQL Editor. Idempotente.

create extension if not exists pgcrypto;

create table if not exists public.checklists_tareas_estado (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  tarea_id uuid not null references public.checklists_tareas(id) on delete cascade,
  completada boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.usuarios(id) on delete set null,
  unique (establecimiento_id, tarea_id)
);

create index if not exists checklists_tareas_estado_est_idx
  on public.checklists_tareas_estado (establecimiento_id, updated_at desc);

-- RLS
alter table public.checklists_tareas_estado enable row level security;

drop policy if exists checklists_tareas_estado_select on public.checklists_tareas_estado;
create policy checklists_tareas_estado_select
on public.checklists_tareas_estado
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists checklists_tareas_estado_write on public.checklists_tareas_estado;
create policy checklists_tareas_estado_write
on public.checklists_tareas_estado
for all
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
)
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

