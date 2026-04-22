import { supabase } from "@/lib/supabase";
import { stockSemaforo, type StockSemaforo } from "@/lib/stockSemaforo";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";

export type DashboardProveedor = { nombre: string; telefono_whatsapp: string | null };

export type DashboardProducto = {
  id: string;
  articulo: string;
  categoria: string | null;
  stock_actual: number;
  stock_minimo: number;
  stock_vacios: number;
  unidad: string | null;
  precio_tarifa: number;
  unidades_por_caja: number;
  proveedor: DashboardProveedor | null;
};

export function toIntStock(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizeProveedor(raw: unknown): DashboardProveedor | null {
  if (!raw || typeof raw !== "object") return null;
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
  if (!row || typeof row !== "object") return null;
  return {
    nombre: String(row.nombre ?? "Proveedor"),
    telefono_whatsapp: row.telefono_whatsapp != null ? String(row.telefono_whatsapp) : null
  };
}

export function normalizeProductoRow(raw: Record<string, unknown>, tituloKey?: string): DashboardProducto {
  const articulo = String(
    tituloKey ? raw[tituloKey] ?? raw.articulo ?? raw.nombre : raw.articulo ?? raw.nombre
  )
    .trim() || "—";
  return {
    id: String(raw.id ?? ""),
    articulo,
    categoria: raw.categoria != null && String(raw.categoria).trim() !== "" ? String(raw.categoria).trim() : null,
    stock_actual: toIntStock(raw.stock_actual, 0),
    stock_minimo: toIntStock(raw.stock_minimo, 0),
    stock_vacios: toIntStock(raw.stock_vacios, 0),
    unidad: raw.unidad != null && String(raw.unidad).trim() !== "" ? String(raw.unidad).trim() : null,
    precio_tarifa: (() => {
      const n = typeof raw.precio_tarifa === "number" ? raw.precio_tarifa : Number(raw.precio_tarifa);
      return Number.isFinite(n) ? n : 0;
    })(),
    unidades_por_caja: (() => {
      const n = typeof raw.unidades_por_caja === "number" ? raw.unidades_por_caja : Number(raw.unidades_por_caja);
      const v = Number.isFinite(n) ? Math.trunc(n) : 1;
      return v >= 1 ? v : 1;
    })(),
    proveedor: normalizeProveedor(raw.proveedor)
  };
}

/** Catálogo unificado como `articulo` en UI; la columna en BD puede ser `articulo` o `nombre`. */
export async function fetchDashboardProductos(establecimientoId: string): Promise<DashboardProducto[]> {
  const col = await resolveProductoTituloColumn(establecimientoId);
  const t = tituloColSql(col);
  const full = `id,${t},categoria,stock_actual,stock_minimo,stock_vacios,unidad,precio_tarifa,unidades_por_caja,proveedor:proveedores(nombre,telefono_whatsapp)`;
  const { data, error } = await supabase()
    .from("productos")
    .select(full as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });

  if (!error) {
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => normalizeProductoRow(r, t));
  }

  const msg = (error as { message?: string }).message?.toLowerCase?.() ?? "";
  const missingJoin =
    msg.includes("proveedor") ||
    msg.includes("relationship") ||
    msg.includes("unidad") ||
    msg.includes("stock_vacios") ||
    msg.includes("precio_tarifa") ||
    msg.includes("unidades_por_caja") ||
    (msg.includes("column") && msg.includes("unidad"));

  if (!missingJoin) throw error;

  const lite = await supabase()
    .from("productos")
    .select(`id,${t},categoria,stock_actual,stock_minimo,stock_vacios,precio_tarifa,unidades_por_caja` as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });
  if (lite.error) throw lite.error;
  return ((lite.data ?? []) as unknown as Record<string, unknown>[]).map((r) =>
    normalizeProductoRow({ ...r, unidad: null, proveedor: null }, t)
  );
}

export type StockEstado = StockSemaforo;

export function estadoStock(p: Pick<DashboardProducto, "stock_actual" | "stock_minimo">): StockEstado {
  return stockSemaforo(p.stock_actual, p.stock_minimo);
}

