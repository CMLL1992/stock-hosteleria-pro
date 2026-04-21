import { NextResponse } from "next/server";

/**
 * Formato JSON unificado en rutas `/api/admin` para errores.
 * El cliente usa `const { error } = await res.json()`.
 */
export function adminError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function adminServerError(e: unknown) {
  return NextResponse.json(
    { error: e instanceof Error ? e.message : String(e) },
    { status: 500 }
  );
}
