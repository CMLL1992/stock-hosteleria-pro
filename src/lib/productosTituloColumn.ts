import { supabase } from "@/lib/supabase";

/** Columna real en `public.productos` para el nombre del artículo (según migración / entorno). */
export type ProductoTituloCol = "articulo" | "nombre";

let cachedTituloCol: ProductoTituloCol | null = null;

/**
 * Detecta columna de título: prueba `articulo` y, si falla, `nombre`.
 * Así cubrimos esquemas con solo una de las dos sin depender del texto exacto del error.
 */
export async function resolveProductoTituloColumn(establecimientoId: string | null): Promise<ProductoTituloCol> {
  if (cachedTituloCol) return cachedTituloCol;

  let q1 = supabase().from("productos").select("id,articulo").limit(1);
  if (establecimientoId) q1 = q1.eq("establecimiento_id", establecimientoId);
  const r1 = await q1;

  if (!r1.error) {
    cachedTituloCol = "articulo";
    return cachedTituloCol;
  }

  let q2 = supabase().from("productos").select("id,nombre").limit(1);
  if (establecimientoId) q2 = q2.eq("establecimiento_id", establecimientoId);
  const r2 = await q2;

  if (!r2.error) {
    cachedTituloCol = "nombre";
    return cachedTituloCol;
  }

  throw r1.error ?? r2.error ?? new Error("No se pudo leer la tabla productos.");
}

/** Solo tests / cambio de entorno. */
export function resetProductoTituloColumnCache(): void {
  cachedTituloCol = null;
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
