-- Permitir que un usuario autenticado cree su propia fila en public.usuarios
-- Necesario para el "registro inicial" automático tras el primer login.

alter table public.usuarios enable row level security;

drop policy if exists "usuarios_insert_own" on public.usuarios;
create policy "usuarios_insert_own"
on public.usuarios
for insert
to authenticated
with check (id = auth.uid());

