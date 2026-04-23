-- OPS: permitir que cada usuario actualice SU nombre_completo (incluye superadmin)
-- Motivo: el superadmin no siempre cumple is_admin(), pero debe poder editar su propio perfil.
--
-- Implementamos vía RPC security definer para evitar abrir UPDATE completo sobre public.usuarios.

create or replace function public.update_my_nombre_completo(p_nombre_completo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usuarios
  set nombre_completo = nullif(trim(p_nombre_completo), '')
  where id = auth.uid();
end;
$$;

grant execute on function public.update_my_nombre_completo(text) to authenticated;

