-- Eventos (v1)
-- Objetivo: registrar eventos por establecimiento (solo lectura para staff; escritura admin/superadmin).
-- Nota: aplica/ajusta RLS según tu modelo de roles (app_metadata/usuarios.rol).

create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  nombre text not null,
  fecha date not null default (now()::date),
  descripcion text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eventos_establecimiento_fecha_idx on public.eventos (establecimiento_id, fecha desc);

-- updated_at trigger (si existe el helper en tu proyecto; si no, puedes sustituirlo por tu trigger habitual).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    execute 'drop trigger if exists trg_eventos_updated_at on public.eventos';
    execute 'create trigger trg_eventos_updated_at before update on public.eventos for each row execute function public.set_updated_at()';
  end if;
exception when others then
  -- ignore
end $$;

alter table public.eventos enable row level security;

-- Policies: lectura (staff/admin/superadmin) para su establecimiento.
drop policy if exists "eventos_select_establecimiento" on public.eventos;
create policy "eventos_select_establecimiento"
on public.eventos
for select
using (
  exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and (
        u.rol in ('staff','admin','superadmin')
      )
      and u.establecimiento_id = eventos.establecimiento_id
  )
);

-- Policies: escritura (admin/superadmin) para su establecimiento.
drop policy if exists "eventos_insert_admin" on public.eventos;
create policy "eventos_insert_admin"
on public.eventos
for insert
with check (
  exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.rol in ('admin','superadmin')
      and u.establecimiento_id = eventos.establecimiento_id
  )
);

drop policy if exists "eventos_update_admin" on public.eventos;
create policy "eventos_update_admin"
on public.eventos
for update
using (
  exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.rol in ('admin','superadmin')
      and u.establecimiento_id = eventos.establecimiento_id
  )
)
with check (
  exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.rol in ('admin','superadmin')
      and u.establecimiento_id = eventos.establecimiento_id
  )
);

drop policy if exists "eventos_delete_admin" on public.eventos;
create policy "eventos_delete_admin"
on public.eventos
for delete
using (
  exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.rol in ('admin','superadmin')
      and u.establecimiento_id = eventos.establecimiento_id
  )
);

