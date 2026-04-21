import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { adminError } from "@/lib/admin/apiResponse";
import type { UsuarioRol } from "@/types/ops";

const SUPERADMIN_EMAIL = "ximomitja1992@hotmail.com".toLowerCase();

export function getSupabaseServerEnv() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL)");
  if (!anonKey) missing.push("SUPABASE_ANON_KEY (o NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  return { supabaseUrl, anonKey, serviceKey, missing };
}

type Ok = {
  ok: true;
  userId: string;
  email: string;
  /** Cliente con permisos de servicio (bypass RLS) para operaciones de administración */
  service: SupabaseClient;
  callerRol: UsuarioRol | null;
  establecimientoId: string | null;
};

type Fail = { ok: false; response: NextResponse };

/**
 * Comprueba el JWT del caller y, con SERVICE_ROLE, lee `usuarios.rol` sin depender de RLS.
 * Así el “superadmin por email” en frontend coincide con lo que permite el servidor.
 */
export async function assertSuperadminOrThrow(req: Request): Promise<Ok | Fail> {
  const { supabaseUrl, anonKey, serviceKey, missing } = getSupabaseServerEnv();
  if (missing.length) {
    return { ok: false, response: adminError(`Missing Supabase env: ${missing.join(", ")}`, 500) };
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) {
    return { ok: false, response: adminError("Missing auth token", 401) };
  }

  const authUserClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: userData, error: userErr } = await authUserClient.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, response: adminError("Not authenticated", 401) };
  }

  const userId = userData.user.id;
  const email = (userData.user.email ?? "").toLowerCase();

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: meRow, error: meErr } = await service
    .from("usuarios")
    .select("rol,establecimiento_id")
    .eq("id", userId)
    .maybeSingle();

  if (meErr) {
    return { ok: false, response: adminError(meErr.message, 500) };
  }

  const rawRol = String(meRow?.rol ?? "")
    .trim()
    .toLowerCase() as string;
  const callerRol: UsuarioRol | null =
    rawRol === "superadmin" || rawRol === "admin" || rawRol === "staff" ? (rawRol as UsuarioRol) : null;
  const establecimientoId = (meRow?.establecimiento_id as string | null | undefined) ?? null;

  const isSuperadmin = rawRol === "superadmin" || email === SUPERADMIN_EMAIL;
  if (!isSuperadmin) {
    return { ok: false, response: adminError("Forbidden", 403) };
  }

  return { ok: true, userId, email, service, callerRol, establecimientoId };
}
