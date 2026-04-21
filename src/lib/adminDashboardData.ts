import { supabase } from "@/lib/supabase";
import { stockSemaforo, type StockSemaforo } from "@/lib/stockSemaforo";

export type DashboardProveedor = { nombre: string; telefono_whatsapp: string | null };

export type DashboardProducto = {
  id: string;
  articulo: string;
  categoria: string | null;
  stock_actual: number;
  stock_minimo: number;
  unidad: string | null;
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

export function normalizeProductoRow(raw: Record<string, unknown>): DashboardProducto {
  return {
    id: String(raw.id ?? ""),
    articulo: String(raw.articulo ?? "").trim() || "—",
    categoria: raw.categoria != null && String(raw.categoria).trim() !== "" ? String(raw.categoria).trim() : null,
    stock_actual: toIntStock(raw.stock_actual, 0),
    stock_minimo: toIntStock(raw.stock_minimo, 0),
    unidad: raw.unidad != null && String(raw.unidad).trim() !== "" ? String(raw.unidad).trim() : null,
    proveedor: normalizeProveedor(raw.proveedor)
  };
}

/** Catálogo con `articulo`, sin `nombre`; incluye proveedor para pedidos WhatsApp. */
export async function fetchDashboardProductos(establecimientoId: string): Promise<DashboardProducto[]> {
  const full =
    "id,articulo,categoria,stock_actual,stock_minimo,unidad,proveedor:proveedores(nombre,telefono_whatsapp)";
  const { data, error } = await supabase()
    .from("productos")
    .select(full)
    .eq("establecimiento_id", establecimientoId)
    .order("articulo", { ascending: true });

  if (!error) {
    return ((data ?? []) as Record<string, unknown>[]).map(normalizeProductoRow);
  }

  const msg = (error as { message?: string }).message?.toLowerCase?.() ?? "";
  const missingJoin =
    msg.includes("proveedor") ||
    msg.includes("relationship") ||
    msg.includes("unidad") ||
    (msg.includes("column") && msg.includes("unidad"));

  if (!missingJoin) throw error;

  const lite = await supabase()
    .from("productos")
    .select("id,articulo,categoria,stock_actual,stock_minimo")
    .eq("establecimiento_id", establecimientoId)
    .order("articulo", { ascending: true });
  if (lite.error) throw lite.error;
  return ((lite.data ?? []) as Record<string, unknown>[]).map((r) =>
    normalizeProductoRow({ ...r, unidad: null, proveedor: null })
  );
}

export type StockEstado = StockSemaforo;

export function estadoStock(p: Pick<DashboardProducto, "stock_actual" | "stock_minimo">): StockEstado {
  return stockSemaforo(p.stock_actual, p.stock_minimo);
}

