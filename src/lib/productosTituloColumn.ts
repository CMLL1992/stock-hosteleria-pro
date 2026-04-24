import { supabase } from "@/lib/supabase";

/** Columna real en `public.productos` para el nombre del artículo (según migración / entorno). */
export type ProductoTituloCol = "articulo" | "nombre";

const cachedByEst = new Map<string, ProductoTituloCol>();

/**
 * Detecta columna de título sin provocar 400 en PostgREST.
 * Usamos `select('*').limit(1)` y miramos las keys devueltas.
 *
 * Nota: si el establecimiento no tiene productos todavía, por defecto usamos `nombre`.
 */
export async function resolveProductoTituloColumn(establecimientoId: string | null): Promise<ProductoTituloCol> {
  if (!establecimientoId) return "nombre";
  const cached = cachedByEst.get(establecimientoId);
  if (cached) return cached;

  let q = supabase().from("productos").select("*").limit(1);
  q = q.eq("establecimiento_id", establecimientoId);
  const r = await q;
  if (r.error) throw r.error;

  const row = (Array.isArray(r.data) ? (r.data[0] as Record<string, unknown> | undefined) : undefined) ?? undefined;
  if (!row) {
    cachedByEst.set(establecimientoId, "nombre");
    return "nombre";
  }
  if (Object.prototype.hasOwnProperty.call(row, "articulo")) {
    cachedByEst.set(establecimientoId, "articulo");
    return "articulo";
  }
  if (Object.prototype.hasOwnProperty.call(row, "nombre")) {
    cachedByEst.set(establecimientoId, "nombre");
    return "nombre";
  }

  cachedByEst.set(establecimientoId, "nombre");
  return "nombre";
}

/** Solo tests / cambio de entorno. */
export function resetProductoTituloColumnCache(): void {
  cachedByEst.clear();
}

/** Nombre de columna en select/order de PostgREST. */
export function tituloColSql(col: ProductoTituloCol): string {
  return col;
}

/** Fila API → siempre `articulo` en el modelo de app. */
export function articuloFromRow(raw: Record<string, unknown>, col: ProductoTituloCol): string {
  const v = col === "articulo" ? raw.articulo : raw.nombre;
  return String(v ?? "").trim() || "—";
}

/** Payload parcial para crear/actualizar el título en BD. */
export function tituloWritePayload(col: ProductoTituloCol, valor: string): Record<string, string> {
  const v = valor.trim();
  return col === "articulo" ? { articulo: v } : { nombre: v };
}

/** Cláusula onConflict si existe índice único compatible en Supabase. */
export function tituloUpsertOnConflict(col: ProductoTituloCol): string {
  return col === "articulo" ? "establecimiento_id,articulo" : "establecimiento_id,nombre";
}
