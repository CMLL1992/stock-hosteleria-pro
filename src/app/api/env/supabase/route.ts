import { NextResponse } from "next/server";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Endpoint de bootstrap para clientes cacheados/PWA que puedan
 * estar ejecutando un bundle viejo sin NEXT_PUBLIC_SUPABASE_* embebidos.
 *
 * Nota: la anon key es "publishable" (no es un secreto), por eso se puede exponer.
 */
export async function GET() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) return json({ ok: false, error: "Missing Supabase env" }, 500);
  return json({ ok: true, url, anonKey });
}

