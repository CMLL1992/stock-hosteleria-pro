import type { PostgrestError } from "@supabase/supabase-js";

/** PostgREST / Postgres: columna `categoria` ausente en esquema antiguo que usa `tipo`. */
function looksLikeMissingCategoriaColumn(err: unknown): boolean {
  const msg = String((err as PostgrestError)?.message ?? err ?? "").toLowerCase();
  const details = String((err as PostgrestError)?.details ?? "").toLowerCase();
  const blob = `${msg} ${details}`;
  if (!blob.includes("categoria")) return false;
  return (
    blob.includes("does not exist") ||
    blob.includes("could not find") ||
    blob.includes("schema cache") ||
    (blob.includes("column") && blob.includes("unknown"))
  );
}

export function splitCategoriaTipoPayload(payload: Record<string, unknown>): {
  withCategoria: Record<string, unknown>;
  withTipo: Record<string, unknown>;
} {
  const categoria = payload.categoria;
  const rest = { ...payload };
  delete rest.categoria;
  const withCategoria = { ...payload };
  const withTipo = categoria !== undefined ? { ...rest, tipo: categoria } : { ...rest };
  return { withCategoria, withTipo };
}

/** Update: intenta con `categoria`; si la columna no existe, reintenta con `tipo`. */
export async function updateProductoCategoriaCompat(
  run: (fields: Record<string, unknown>) => Promise<{ error: PostgrestError | null }>,
  payload: Record<string, unknown>
): Promise<{ error: PostgrestError | null }> {
  const { withCategoria, withTipo } = splitCategoriaTipoPayload(payload);
  let { error } = await run(withCategoria);
  if (error && looksLikeMissingCategoriaColumn(error)) {
    const r2 = await run(withTipo);
    error = r2.error;
  }
  return { error };
}

/** Insert: mismo criterio que update. */
export async function insertProductoCategoriaCompat(
  run: (fields: Record<string, unknown>) => Promise<{ error: PostgrestError | null }>,
  payload: Record<string, unknown>
): Promise<{ error: PostgrestError | null }> {
  return updateProductoCategoriaCompat(run, payload);
}
