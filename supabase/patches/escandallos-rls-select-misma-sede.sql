-- RLS SELECT en public.escandallos: superadmin o mismo establecimiento que la sesión.
--
-- Contexto: una política del tipo (is_superadmin() OR is_admin()) AND establecimiento_id = my_establecimiento_id()
-- puede bloquear a admins si `is_admin()` no coincide (rol/casing) o si solo queremos acotar por sede.
--
-- Esta política permite SELECT a `authenticated` si:
--   public.is_superadmin()
--   OR establecimiento_id = public.my_establecimiento_id()
--
-- `public.my_establecimiento_id()` debe devolver el establecimiento del usuario con sesión (auth.uid()).
-- Va marcada como SECURITY DEFINER para evitar recursión con RLS en `public.usuarios`.
--
-- Ejecución: SQL Editor de Supabase (una vez), o `psql` contra la BD del proyecto.

-- 1) Helpers (SECURITY DEFINER + search_path=public; alineado con fix-rls-helpers-security-definer.sql)
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

-- Devuelve el `establecimiento_id` del local del usuario con sesión (`auth.uid()` → `public.usuarios`).
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

grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.my_establecimiento_id() to authenticated;

-- 2) Política SELECT en escandallos
do $$
begin
  if to_regclass('public.escandallos') is null then
    raise notice 'Tabla public.escandallos no existe; omitiendo políticas.';
    return;
  end if;

  execute 'alter table public.escandallos enable row level security';

  -- Nombre histórico del repo (sustituir por la nueva lógica)
  execute 'drop policy if exists escandallos_select_admin_est on public.escandallos';
  -- Por si se aplicó una variante con otro nombre
  execute 'drop policy if exists escandallos_select_misma_sede_o_superadmin on public.escandallos';

  execute $pol$
    create policy escandallos_select_misma_sede_o_superadmin
    on public.escandallos
    for select
    to authenticated
    using (
      public.is_superadmin()
      or (establecimiento_id = public.my_establecimiento_id())
    )
  $pol$;
end $$;

-- Nota: INSERT/UPDATE/DELETE no se tocan aquí; siguen gobernados por otros parches
-- (p. ej. escandallos-establecimiento-fix.sql). Si solo ejecutas este archivo y faltan
-- esas políticas, aplica también ese patch o el bloque correspondiente de rls-superadmin-global-bypass.sql.
