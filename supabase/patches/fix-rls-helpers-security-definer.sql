-- OPS: corregir "stack depth limit exceeded" al insertar/actualizar (proveedores, productos, etc.)
--
-- Causa: las funciones is_superadmin(), is_admin() y my_establecimiento_id() hacen SELECT
-- sobre public.usuarios, y la política RLS de usuarios vuelve a llamar a esas funciones
-- → recursión infinita.
--
-- Solución: marcar esas funciones como SECURITY DEFINER y search_path=public, de modo
-- que lean usuarios con privilegios del propietario (bypass RLS en esa lectura).
-- Ejecútalo en el SQL Editor de Supabase (una vez).

create or replace function public.is_superadmin()
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
      and coalesce(u.rol::text, '') = 'superadmin'
  );
$$;

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
      and coalesce(u.rol::text, '') = 'admin'
  );
$$;

create or replace function public.my_establecimiento_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select u.establecimiento_id
  from public.usuarios u
  where u.id = auth.uid()
  limit 1;
$$;

-- Permisos de ejecución (por si faltan)
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_establecimiento_id() to authenticated;
