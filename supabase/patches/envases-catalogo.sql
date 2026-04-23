-- Catálogo de envases (coste real por envase) - OPS
-- Ejecuta este fichero en Supabase → SQL Editor.
--
-- Objetivos:
-- - Tabla envases_catalogo por establecimiento (similar a productos)
-- - Productos referencian envase_catalogo_id (en vez de precio global)
-- - RLS: lectura por establecimiento; escritura solo admin/superadmin

create table if not exists public.envases_catalogo (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  nombre text not null,
  coste numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists envases_catalogo_est_idx on public.envases_catalogo (establecimiento_id, nombre);

-- Trigger updated_at (reutiliza touch_updated_at si existe)
do $$
begin
  if to_regprocedure('public.touch_updated_at()') is null then
    create or replace function public.touch_updated_at()
    returns trigger
    language plpgsql
    as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;
  end if;
end $$;

drop trigger if exists envases_catalogo_touch on public.envases_catalogo;
create trigger envases_catalogo_touch
before update on public.envases_catalogo
for each row execute function public.touch_updated_at();

-- Productos: referencia opcional al catálogo de envases
alter table public.productos
  add column if not exists envase_catalogo_id uuid;

do $$
begin
  begin
    alter table public.productos
      add constraint productos_envase_catalogo_fk
      foreign key (envase_catalogo_id) references public.envases_catalogo(id) on delete set null;
  exception when duplicate_object then null;
  end;
end $$;

-- RLS
alter table public.envases_catalogo enable row level security;

drop policy if exists envases_catalogo_select_est_or_superadmin on public.envases_catalogo;
create policy envases_catalogo_select_est_or_superadmin
on public.envases_catalogo
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists envases_catalogo_insert_admin_est on public.envases_catalogo;
create policy envases_catalogo_insert_admin_est
on public.envases_catalogo
for insert
to authenticated
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

drop policy if exists envases_catalogo_update_admin_est on public.envases_catalogo;
create policy envases_catalogo_update_admin_est
on public.envases_catalogo
for update
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
)
with check (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

drop policy if exists envases_catalogo_delete_admin_est on public.envases_catalogo;
create policy envases_catalogo_delete_admin_est
on public.envases_catalogo
for delete
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

