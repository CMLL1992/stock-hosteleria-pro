import { supabase } from "@/lib/supabase";

/** Columna real en `public.productos` para el nombre del artículo (según migración / entorno). */
export type ProductoTituloCol = "articulo" | "nombre";

let cachedTituloCol: ProductoTituloCol | null = null;

function msg(err: unknown): string {
  return String((err as { message?: string })?.message ?? "").toLowerCase();
}

function looksLikeMissingColumn(err: unknown, col: string): boolean {
  const m = msg(err);
  const c = col.toLowerCase();
  return m.includes(c) && (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"));
}

/**
 * Detecta si la tabla `productos` usa `articulo` o `nombre` como columna de texto del artículo.
 * Resultado en memoria para no repetir peticiones.
 */
export async function resolveProductoTituloColumn(establecimientoId: string | null): Promise<ProductoTituloCol> {
  if (cachedTituloCol) return cachedTituloCol;

  let q = supabase().from("productos").select("id,articulo").limit(1);
  if (establecimientoId) q = q.eq("establecimiento_id", establecimientoId);
  const r1 = await q;

  if (!r1.error) {
    cachedTituloCol = "articulo";
    return cachedTituloCol;
  }

  if (looksLikeMissingColumn(r1.error, "articulo")) {
    let q2 = supabase().from("productos").select("id,nombre").limit(1);
    if (establecimientoId) q2 = q2.eq("establecimiento_id", establecimientoId);
    const r2 = await q2;
    if (!r2.error) {
      cachedTituloCol = "nombre";
      return cachedTituloCol;
    }
  }

  throw r1.error ?? new Error("No se pudo leer la tabla productos.");
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

/** Cláusula onConflict acorde a la columna de título (requiere índice único compatible en Supabase). */
export function tituloUpsertOnConflict(col: ProductoTituloCol): string {
  return col === "articulo" ? "establecimiento_id,articulo" : "establecimiento_id,nombre";
}
