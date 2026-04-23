import { supabase } from "@/lib/supabase";
import type { ProductoTituloCol } from "@/lib/productosTituloColumn";
import { tituloColSql, tituloWritePayload } from "@/lib/productosTituloColumn";

/** Postgres: no hay restricción única que coincida con ON CONFLICT. */
export function isOnConflictConstraintMissing(err: unknown): boolean {
  const code = String((err as { code?: string })?.code ?? "");
  const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
  return code === "42P10" || msg.includes("42p10") || msg.includes("no unique or exclusion constraint matching");
}

/**
 * Importación sin ON CONFLICT: busca por (establecimiento_id + columna título) y hace update o insert.
 * Úsalo cuando en la BD aún no exista el índice único compuesto.
 */
export async function upsertProductosFilaPorFila(
  rows: Record<string, unknown>[],
  col: ProductoTituloCol,
  establecimientoId: string
): Promise<void> {
  const tk = tituloColSql(col);
  for (const row of rows) {
    const tv = String(row[tk] ?? "").trim();
    if (!tv) throw new Error("Fila sin artículo (título vacío).");

    const { data: existing, error: qErr } = await supabase()
      .from("productos")
      .select("id")
      .eq("establecimiento_id", establecimientoId)
      .eq(tk, tv)
      .maybeSingle();
    if (qErr) throw qErr;

    const id = existing && typeof (existing as { id?: unknown }).id === "string" ? (existing as { id: string }).id : null;

    if (id) {
      const { error: uErr } = await supabase()
        .from("productos")
        .update({
          ...tituloWritePayload(col, tv),
          categoria: row.categoria,
          unidad: row.unidad,
          stock_actual: row.stock_actual,
          stock_minimo: row.stock_minimo,
          proveedor_id: row.proveedor_id ?? null
        })
        .eq("id", id)
        .eq("establecimiento_id", establecimientoId);
      if (uErr) throw uErr;
    } else {
      // Forzamos `establecimiento_id` para evitar inserciones fuera de tenant (especialmente en contexto superadmin).
      const { error: iErr } = await supabase()
        .from("productos")
        .insert({ ...row, establecimiento_id: establecimientoId });
      if (iErr) throw iErr;
    }
  }
}
