-- Checklists: RLS claro y sin interferencias entre policies.
-- Objetivo:
-- - STAFF: puede INSERT (crear tareas) en su establecimiento.
-- - ADMIN: puede INSERT/UPDATE/DELETE en su establecimiento.
-- - SUPERADMIN: puede todo.
-- - Todos autenticados del establecimiento: pueden SELECT.
--
-- Ejecutar en Supabase → SQL Editor. Idempotente.

alter table public.checklists_tareas enable row level security;

-- SELECT (mismo local o superadmin)
drop policy if exists checklists_tareas_select on public.checklists_tareas;
create policy checklists_tareas_select
on public.checklists_tareas
as permissive
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

-- INSERT (staff/admin dentro del local; superadmin global)
drop policy if exists checklists_tareas_insert_staff on public.checklists_tareas;
create policy checklists_tareas_insert_staff
on public.checklists_tareas
as permissive
for insert
to authenticated
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

-- UPDATE (solo admin/superadmin dentro del local)
drop policy if exists checklists_tareas_update_admin on public.checklists_tareas;
create policy checklists_tareas_update_admin
on public.checklists_tareas
as permissive
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

-- DELETE (solo admin/superadmin dentro del local)
drop policy if exists checklists_tareas_delete_admin on public.checklists_tareas;
create policy checklists_tareas_delete_admin
on public.checklists_tareas
as permissive
for delete
to authenticated
using (
  public.is_superadmin()
  or (public.is_admin() and establecimiento_id = public.my_establecimiento_id())
);

-- Elimina la policy legacy “FOR ALL” para evitar conflictos (especialmente si fue RESTRICTIVE).
drop policy if exists checklists_tareas_write_admin on public.checklists_tareas;

