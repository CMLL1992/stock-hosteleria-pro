-- Permitir que STAFF cree tareas del checklist en su establecimiento.
-- Ejecutar en Supabase → SQL Editor. Idempotente.

-- Importante:
-- - STAFF: solo INSERT (crear).
-- - ADMIN/SUPERADMIN: siguen teniendo ALL via policy existente.

alter table public.checklists_tareas enable row level security;

drop policy if exists checklists_tareas_insert_staff on public.checklists_tareas;
create policy checklists_tareas_insert_staff
on public.checklists_tareas
for insert
to authenticated
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

