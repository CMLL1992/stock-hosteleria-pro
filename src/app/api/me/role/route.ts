import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type Role = "superadmin" | "admin" | "staff";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function getEnv() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";
  return { supabaseUrl, serviceKey };
}

export async function GET(req: Request) {
  const { supabaseUrl, serviceKey } = getEnv();
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Missing Supabase env" }, 500);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return json({ ok: false, error: "Missing auth token" }, 401);

  // Verifica el token y extrae el user id
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!anonKey) return json({ ok: false, error: "Missing anon key" }, 500);

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData.user) return json({ ok: false, error: "Not authenticated" }, 401);

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const { data: meRow, error: meErr } = await service
    .from("usuarios")
    .select("rol,establecimiento_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (meErr) return json({ ok: false, error: meErr.message }, 500);

  const row = (meRow ?? null) as null | { rol?: unknown; establecimiento_id?: unknown };
  const raw = String(row?.rol ?? "").trim().toLowerCase();
  const role: Role | null = raw === "superadmin" || raw === "admin" || raw === "staff" ? (raw as Role) : null;
  const establecimientoId = String(row?.establecimiento_id ?? "").trim() || null;

  return json({ ok: true, role, establecimientoId });
}

