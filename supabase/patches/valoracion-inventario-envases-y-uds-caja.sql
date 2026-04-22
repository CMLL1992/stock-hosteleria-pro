-- Valoración económica: precios de envases + unidades por caja

-- 1) Columna unidades_por_caja en productos
alter table public.productos
  add column if not exists unidades_por_caja integer not null default 1;

do $$
begin
  begin
    alter table public.productos
      add constraint productos_unidades_por_caja_chk check (unidades_por_caja >= 1);
  exception when duplicate_object then null;
  end;
end $$;

-- 2) Tabla config_precios_envases (por establecimiento)
create table if not exists public.config_precios_envases (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  tipo text not null,
  precio numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (establecimiento_id, tipo)
);

-- Auto-update updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists config_precios_envases_touch on public.config_precios_envases;
create trigger config_precios_envases_touch
before update on public.config_precios_envases
for each row execute function public.touch_updated_at();

-- RLS
alter table public.config_precios_envases enable row level security;

-- Políticas: mismo establecimiento (requiere public.my_establecimiento_id())
drop policy if exists config_precios_envases_select_same_est on public.config_precios_envases;
create policy config_precios_envases_select_same_est
on public.config_precios_envases
for select
to authenticated
using (establecimiento_id = public.my_establecimiento_id());

drop policy if exists config_precios_envases_upsert_same_est on public.config_precios_envases;
create policy config_precios_envases_upsert_same_est
on public.config_precios_envases
for insert
to authenticated
with check (establecimiento_id = public.my_establecimiento_id());

drop policy if exists config_precios_envases_update_same_est on public.config_precios_envases;
create policy config_precios_envases_update_same_est
on public.config_precios_envases
for update
to authenticated
using (establecimiento_id = public.my_establecimiento_id())
with check (establecimiento_id = public.my_establecimiento_id());

