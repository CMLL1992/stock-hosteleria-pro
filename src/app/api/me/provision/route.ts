import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function getEnv() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { supabaseUrl, serviceKey, anonKey };
}

/**
 * Provisiona fila en `usuarios` si el usuario es admin/superadmin por email
 * y todavía no existe en la BD. Esto evita fallos RLS (42501) en pantallas admin.
 */
export async function POST(req: Request) {
  const { supabaseUrl, serviceKey, anonKey } = getEnv();
  if (!supabaseUrl || !serviceKey || !anonKey) return json({ ok: false, error: "Missing Supabase env" }, 500);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) return json({ ok: false, error: "Missing auth token" }, 401);

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData.user) return json({ ok: false, error: "Not authenticated" }, 401);

  const user = userData.user;
  const email = (user.email ?? "").trim().toLowerCase();
  const adminEmails = parseAdminEmails(process.env.NEXT_PUBLIC_ADMIN_EMAILS);
  const superadminByEmail = email === "ximomitja1992@hotmail.com";
  const adminByEmail = !!email && adminEmails.includes(email);

  if (!superadminByEmail && !adminByEmail) {
    return json({ ok: false, error: "User is not whitelisted for auto-provision" }, 403);
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  // Si ya existe, no hacemos nada.
  const { data: existing, error: exErr } = await service.from("usuarios").select("id").eq("id", user.id).maybeSingle();
  if (exErr) return json({ ok: false, error: exErr.message }, 500);
  if (existing?.id) return json({ ok: true, provisioned: false });

  // Establecimiento por defecto: el primero creado.
  const { data: est, error: estErr } = await service
    .from("establecimientos")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (estErr) return json({ ok: false, error: estErr.message }, 500);
  const establecimientoId = (est as { id?: string } | null)?.id ?? null;
  if (!establecimientoId) return json({ ok: false, error: "No default establecimiento found" }, 500);

  const rol = superadminByEmail ? "superadmin" : "admin";
  const { error: insErr } = await service.from("usuarios").insert({
    id: user.id,
    email: email || null,
    rol,
    establecimiento_id: establecimientoId
  });
  if (insErr) return json({ ok: false, error: insErr.message }, 500);

  return json({ ok: true, provisioned: true, rol, establecimientoId });
}

