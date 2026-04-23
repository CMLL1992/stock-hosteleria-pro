-- Ciclo de vida de pedidos de compra: pendiente -> parcial -> recibido (OPS)
-- Ejecuta este fichero en Supabase → SQL Editor.
--
-- Objetivos:
-- - Registrar pedidos (cabecera) + líneas (items) con cantidades pedidas/recibidas
-- - Permitir recepción (staff/admin/superadmin) generando movimientos 'entrada_compra'
-- - Mantener RLS por establecimiento con bypass global para superadmin
--
-- Requisitos previos:
-- - multitenant-establecimientos.sql (establecimientos + my_establecimiento_id + is_superadmin/is_admin)
-- - recepcion-pedidos-compra.sql (movimiento_tipo incluye entrada_compra + trigger stock actualizado)

-- 1) Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pedido_estado') then
    create type public.pedido_estado as enum ('pendiente', 'parcial', 'recibido');
  end if;
  if not exists (select 1 from pg_type where typname = 'pedido_item_estado') then
    create type public.pedido_item_estado as enum ('pendiente', 'parcial', 'recibido');
  end if;
end $$;

-- 2) Tablas
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  establecimiento_id uuid not null references public.establecimientos(id) on delete restrict,
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  creado_por uuid not null,
  estado public.pedido_estado not null default 'pendiente',
  created_at timestamptz not null default now(),
  received_at timestamptz
);

create index if not exists pedidos_est_estado_idx on public.pedidos (establecimiento_id, estado, created_at desc);
create index if not exists pedidos_proveedor_idx on public.pedidos (proveedor_id, created_at desc);

create table if not exists public.pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  establecimiento_id uuid not null references public.establecimientos(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad_pedida integer not null check (cantidad_pedida >= 0),
  cantidad_recibida integer not null default 0 check (cantidad_recibida >= 0),
  estado public.pedido_item_estado not null default 'pendiente',
  created_at timestamptz not null default now(),
  unique (pedido_id, producto_id)
);

create index if not exists pedido_items_pedido_idx on public.pedido_items (pedido_id);
create index if not exists pedido_items_producto_idx on public.pedido_items (producto_id);

-- 3) RLS
alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

drop policy if exists pedidos_select_est_or_superadmin on public.pedidos;
create policy pedidos_select_est_or_superadmin
on public.pedidos
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists pedidos_insert_est_or_superadmin on public.pedidos;
create policy pedidos_insert_est_or_superadmin
on public.pedidos
for insert
to authenticated
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

-- Nota: updates vía RPC (security definer). Dejar update restringido al mismo establecimiento.
drop policy if exists pedidos_update_est_or_superadmin on public.pedidos;
create policy pedidos_update_est_or_superadmin
on public.pedidos
for update
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
)
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists pedido_items_select_est_or_superadmin on public.pedido_items;
create policy pedido_items_select_est_or_superadmin
on public.pedido_items
for select
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists pedido_items_insert_est_or_superadmin on public.pedido_items;
create policy pedido_items_insert_est_or_superadmin
on public.pedido_items
for insert
to authenticated
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

drop policy if exists pedido_items_update_est_or_superadmin on public.pedido_items;
create policy pedido_items_update_est_or_superadmin
on public.pedido_items
for update
to authenticated
using (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
)
with check (
  public.is_superadmin()
  or establecimiento_id = public.my_establecimiento_id()
);

-- 4) RPC: confirmar recepción de un pedido (transacción)
-- p_items: [{ producto_id: uuid, recibido: int }]
create or replace function public.confirm_pedido_recepcion(
  p_pedido_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_est uuid;
  v_pedido record;
  it jsonb;
  v_prod uuid;
  v_rec int;
  v_total int := 0;
  v_total_pedidos int := 0;
  v_all_received boolean := true;
  v_any_received boolean := false;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if p_pedido_id is null then
    raise exception 'Falta pedido_id';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items debe ser un array JSON';
  end if;

  -- Cargar pedido
  select id, establecimiento_id, proveedor_id, estado into v_pedido
  from public.pedidos
  where id = p_pedido_id
  limit 1;

  if v_pedido.id is null then
    raise exception 'Pedido no encontrado';
  end if;

  -- Gate por establecimiento (superadmin bypass)
  if not public.is_superadmin() then
    v_est := public.my_establecimiento_id();
    if v_est is null or v_est <> v_pedido.establecimiento_id then
      raise exception 'Forbidden';
    end if;
  end if;

  -- Actualizar líneas + generar movimientos (solo por recibido > 0)
  for it in select * from jsonb_array_elements(p_items)
  loop
    v_prod := nullif(it->>'producto_id','')::uuid;
    v_rec := greatest(0, coalesce(nullif(it->>'recibido','')::int, 0));
    if v_prod is null then
      continue;
    end if;

    update public.pedido_items pi
    set
      cantidad_recibida = v_rec,
      estado = case
        when v_rec <= 0 then 'pendiente'::public.pedido_item_estado
        when v_rec < cantidad_pedida then 'parcial'::public.pedido_item_estado
        else 'recibido'::public.pedido_item_estado
      end
    where pi.pedido_id = p_pedido_id
      and pi.producto_id = v_prod;

    if v_rec > 0 then
      insert into public.movimientos (
        producto_id, tipo, cantidad, usuario_id, timestamp, establecimiento_id, proveedor_id
      ) values (
        v_prod, 'entrada_compra', v_rec, v_uid, now(), v_pedido.establecimiento_id, v_pedido.proveedor_id
      );
      v_total := v_total + 1;
      v_any_received := true;
    end if;
  end loop;

  -- Recalcular estado del pedido
  select count(*) into v_total_pedidos from public.pedido_items where pedido_id = p_pedido_id;
  if v_total_pedidos = 0 then
    -- Pedido sin líneas: lo dejamos pendiente
    update public.pedidos set estado = 'pendiente' where id = p_pedido_id;
  else
    -- all received?
    select bool_and(cantidad_recibida >= cantidad_pedida) into v_all_received
    from public.pedido_items
    where pedido_id = p_pedido_id;
    if coalesce(v_all_received, false) then
      update public.pedidos
      set estado = 'recibido', received_at = now()
      where id = p_pedido_id;
    elsif v_any_received then
      update public.pedidos set estado = 'parcial' where id = p_pedido_id;
    else
      update public.pedidos set estado = 'pendiente' where id = p_pedido_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'movimientos_creados', v_total);
end;
$$;

grant execute on function public.confirm_pedido_recepcion(uuid, jsonb) to authenticated;

