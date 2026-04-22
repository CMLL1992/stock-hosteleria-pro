-- Hardening: hacer que "admin" incluya "superadmin" en RLS.
--
-- Problema: algunas políticas y helpers usan public.is_admin() (rol='admin'),
-- lo que deja fuera a 'superadmin' si el enum/rol ya existe.
--
-- Solución: redefinir public.is_admin() para que devuelva TRUE tanto para admin como superadmin.
-- Mantiene SECURITY DEFINER para evitar recursión con RLS en public.usuarios.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and coalesce(u.rol::text, '') in ('admin', 'superadmin')
  );
$$;

grant execute on function public.is_admin() to authenticated;

