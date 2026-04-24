-- Activity log / notifications por establecimiento.
-- Ejecutar en Supabase → SQL Editor. Idempotente.

create extension if not exists pgcrypto;

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete cascade,
  actor_user_id uuid null references public.usuarios(id) on delete set null,
  message text not null,
  icon text not null default 'info',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_est_created_idx
  on public.activity_log (establecimiento_id, created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists activity_log_select on public.activity_log;
create policy activity_log_select
on public.activity_log
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists activity_log_insert on public.activity_log;
create policy activity_log_insert
on public.activity_log
for insert
to authenticated
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

