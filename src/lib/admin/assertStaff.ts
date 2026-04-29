import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminError } from "@/lib/admin/apiResponse";
import type { UsuarioRol } from "@/types/ops";
import { getSupabaseServerEnv } from "@/lib/admin/assertSuperadmin";

type Ok = {
  ok: true;
  userId: string;
  email: string;
  service: SupabaseClient;
  callerRol: UsuarioRol | null;
  establecimientoId: string | null;
};

type Fail = { ok: false; response: Response };

/** Gate para endpoints de lectura: permite staff/admin/superadmin. */
export async function assertStaffOrThrow(req: Request): Promise<Ok | Fail> {
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

  const rawRol = String(meRow?.rol ?? "").trim().toLowerCase();
  const callerRol: UsuarioRol | null =
    rawRol === "superadmin" || rawRol === "admin" || rawRol === "staff" ? (rawRol as UsuarioRol) : null;
  const establecimientoId = (meRow?.establecimiento_id as string | null | undefined) ?? null;

  const canRead = rawRol === "superadmin" || rawRol === "admin" || rawRol === "staff";
  if (!canRead) {
    return { ok: false, response: adminError("Forbidden", 403) };
  }

  return { ok: true, userId, email, service, callerRol, establecimientoId };
}

