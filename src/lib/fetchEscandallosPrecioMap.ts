import { supabase } from "@/lib/supabase";

export type EscandalloPrecioRow = {
  producto_id: string;
  precio_tarifa: number;
  descuento_valor: number;
  descuento_tipo: "%" | "€";
  rappel_valor: number;
};

function normalizeDescTipo(v: unknown): "%" | "€" {
  return String(v ?? "%") === "€" ? "€" : "%";
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Carga precios de escandallos para un conjunto de `producto_id`.
 *
 * Importante: NO filtramos por `escandallos.establecimiento_id` porque puede quedar
 * desalineado respecto a `productos.establecimiento_id`. La visibilidad real la aplica RLS.
 */
export async function fetchEscandallosPrecioMapByProductIds(
  productIds: string[],
  establecimientoId?: string | null
): Promise<Map<string, EscandalloPrecioRow>> {
  const ids = Array.from(new Set(productIds.map((x) => String(x ?? "").trim()).filter(Boolean)));
  const map = new Map<string, EscandalloPrecioRow>();
  if (!ids.length) return map;

  for (const part of chunk(ids, 120)) {
    let q = supabase()
      .from("escandallos")
      .select("producto_id,precio_tarifa,descuento_valor,descuento_tipo,rappel_valor")
      .in("producto_id", part);
    if (establecimientoId) q = q.eq("establecimiento_id", establecimientoId);
    const { data, error } = await q;
    if (error) throw error;

    for (const r of ((data ?? []) as unknown as Array<Record<string, unknown>>)) {
      const pid = String(r.producto_id ?? "").trim();
      if (!pid) continue;
      const precio = Number(r.precio_tarifa ?? 0);
      const descVal = Number(r.descuento_valor ?? 0);
      const rappel = Number(r.rappel_valor ?? 0);
      const descTipo = normalizeDescTipo(r.descuento_tipo);
      map.set(pid, {
        producto_id: pid,
        precio_tarifa: Number.isFinite(precio) ? precio : 0,
        descuento_valor: Number.isFinite(descVal) ? descVal : 0,
        descuento_tipo: descTipo,
        rappel_valor: Number.isFinite(rappel) ? rappel : 0
      });
    }
  }

  return map;
}

export type EscandalloFinanceRow = EscandalloPrecioRow & {
  establecimiento_id: string;
  uds_caja: number;
  iva_compra: number;
  pvp: number;
  iva_venta: number;
};

function normalizeIva(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (n === 4 || n === 10 || n === 21) return n;
  return 10;
}

export async function fetchEscandallosFinanceMapByProductIds(
  productIds: string[],
  establecimientoId?: string | null
): Promise<Map<string, EscandalloFinanceRow>> {
  const ids = Array.from(new Set(productIds.map((x) => String(x ?? "").trim()).filter(Boolean)));
  const map = new Map<string, EscandalloFinanceRow>();
  if (!ids.length) return map;

  for (const part of chunk(ids, 120)) {
    let q = supabase()
      .from("escandallos")
      .select("producto_id,establecimiento_id,precio_tarifa,uds_caja,descuento_valor,descuento_tipo,rappel_valor,iva_compra,pvp,iva_venta")
      .in("producto_id", part);
    if (establecimientoId) q = q.eq("establecimiento_id", establecimientoId);
    const { data, error } = await q;
    if (error) throw error;

    for (const r of ((data ?? []) as unknown as Array<Record<string, unknown>>)) {
      const pid = String(r.producto_id ?? "").trim();
      if (!pid) continue;
      const precio = Number(r.precio_tarifa ?? 0);
      const descVal = Number(r.descuento_valor ?? 0);
      const rappel = Number(r.rappel_valor ?? 0);
      const descTipo = normalizeDescTipo(r.descuento_tipo);
      const udsCaja = Math.max(1, Math.trunc(Number(r.uds_caja ?? 1) || 1));
      map.set(pid, {
        producto_id: pid,
        establecimiento_id: String(r.establecimiento_id ?? ""),
        precio_tarifa: Number.isFinite(precio) ? precio : 0,
        uds_caja: udsCaja,
        descuento_valor: Number.isFinite(descVal) ? descVal : 0,
        descuento_tipo: descTipo,
        rappel_valor: Number.isFinite(rappel) ? rappel : 0,
        iva_compra: normalizeIva(r.iva_compra),
        pvp: Number(r.pvp ?? 0) || 0,
        iva_venta: normalizeIva(r.iva_venta)
      });
    }
  }

  return map;
}
