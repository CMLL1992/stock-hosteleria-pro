-- Histórico de reposiciones enviadas (WhatsApp)
-- Ejecutar en Supabase SQL Editor.

create table if not exists public.reposiciones_log (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null default public.my_establecimiento_id(),
  fecha date not null default current_date,
  detalle_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reposiciones_log_est_fecha_idx on public.reposiciones_log (establecimiento_id, fecha desc, created_at desc);

alter table public.reposiciones_log enable row level security;

drop policy if exists reposiciones_log_select on public.reposiciones_log;
create policy reposiciones_log_select
on public.reposiciones_log
for select
to authenticated
using (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

drop policy if exists reposiciones_log_insert on public.reposiciones_log;
create policy reposiciones_log_insert
on public.reposiciones_log
for insert
to authenticated
with check (public.is_superadmin() or establecimiento_id = public.my_establecimiento_id());

