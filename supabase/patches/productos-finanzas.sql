-- Añade campos financieros para escandallos (OPS)
-- Ejecuta esto en Supabase SQL Editor.

alter table public.productos
  add column if not exists precio_tarifa numeric(12,2) not null default 0,
  add column if not exists descuento_valor numeric(12,2) not null default 0,
  add column if not exists descuento_tipo text not null default '%',
  add column if not exists iva_compra integer not null default 10,
  add column if not exists pvp numeric(12,2) not null default 0,
  add column if not exists iva_venta integer not null default 10;

-- Constraints (best-effort, sin romper si ya existen)
do $$
begin
  begin
    alter table public.productos
      add constraint productos_descuento_tipo_chk check (descuento_tipo in ('%','€'));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.productos
      add constraint productos_iva_compra_chk check (iva_compra in (4,10,21));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.productos
      add constraint productos_iva_venta_chk check (iva_venta in (4,10,21));
  exception when duplicate_object then null;
  end;

  begin
    alter table public.productos
      add constraint productos_precios_nonneg_chk check (
        precio_tarifa >= 0 and descuento_valor >= 0 and pvp >= 0
      );
  exception when duplicate_object then null;
  end;
end $$;

