-- Checklists operativos (Apertura / Cierre). Sin impacto en stock.
-- Ejecutar en Supabase → SQL Editor. Idempotente.

create extension if not exists pgcrypto;

-- 1) Tareas por establecimiento y tipo
create table if not exists public.checklists_tareas (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checklists_tareas_tipo_chk') then
    alter table public.checklists_tareas
      add constraint checklists_tareas_tipo_chk check (tipo in ('Apertura', 'Cierre'));
  end if;
end $$;

create index if not exists checklists_tareas_est_tipo_ord_idx
  on public.checklists_tareas (establecimiento_id, tipo, orden);

-- 2) Registro de checklist completado (firma = usuario en el momento)
create table if not exists public.checklists_registros (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  tipo text not null,
  completado_at timestamptz not null default now(),
  completado_por uuid not null references public.usuarios (id) on delete restrict
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checklists_registros_tipo_chk') then
    alter table public.checklists_registros
      add constraint checklists_registros_tipo_chk check (tipo in ('Apertura', 'Cierre'));
  end if;
end $$;

create index if not exists checklists_registros_est_fecha_idx
  on public.checklists_registros (establecimiento_id, completado_at desc);

-- 3) Plantilla inicial por establecimiento (solo si no tiene tareas aún)
insert into public.checklists_tareas (establecimiento_id, tipo, titulo, orden)
select e.id, v.tipo, v.titulo, v.ord
from public.establecimientos e
cross join (
  values
    ('Apertura'::text, 'Luces y zona de trabajo lista', 1),
    ('Apertura', 'Neveras / vitrinas a temperatura correcta', 2),
    ('Apertura', 'Fichaje o apertura de caja registrada', 3),
    ('Apertura', 'Suelo y barra limpios y secos', 4),
    ('Cierre', 'Equipos y luces no esenciales apagados', 1),
    ('Cierre', 'Restos guardados o desechados (HACCP)', 2),
    ('Cierre', 'Cierre de caja / arqueo básico', 3),
    ('Cierre', 'Persianas / accesos cerrados', 4)
) as v(tipo, titulo, ord)
where not exists (
  select 1 from public.checklists_tareas t where t.establecimiento_id = e.id limit 1
);

-- 4) RLS
alter table public.checklists_tareas enable row level security;
alter table public.checklists_registros enable row level security;

drop policy if exists checklists_tareas_select on public.checklists_tareas;
drop policy if exists checklists_tareas_write_admin on public.checklists_tareas;
create policy checklists_tareas_select
on public.checklists_tareas
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists checklists_tareas_write_admin on public.checklists_tareas;
create policy checklists_tareas_write_admin
on public.checklists_tareas
for all
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
)
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

drop policy if exists checklists_registros_select on public.checklists_registros;
drop policy if exists checklists_registros_insert on public.checklists_registros;
create policy checklists_registros_select
on public.checklists_registros
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists checklists_registros_insert on public.checklists_registros;
create policy checklists_registros_insert
on public.checklists_registros
for insert
to authenticated
with check (
  public.is_superadmin()
  or (
    establecimiento_id = public.my_establecimiento_id()
    and completado_por = auth.uid()
  )
);
