import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = {
  email?: string;
  password?: string;
  rol?: "admin" | "staff";
  establecimiento_id?: string;
};

const SUPERADMIN_EMAIL = "ximomitja1992@hotmail.com";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

    const { email, password, rol, establecimiento_id } = (await req.json()) as Body;
    if (!email || !password || !rol || !establecimiento_id) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
    }

    // 1) Verifica quién llama (token del usuario actual)
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const me = await authClient.auth.getUser();
    const meEmail = (me.data.user?.email ?? "").toLowerCase();
    if (!me.data.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Check superadmin en DB (y fallback por email duro)
    const { data: meRow } = await authClient
      .from("usuarios")
      .select("rol")
      .eq("id", me.data.user.id)
      .maybeSingle();
    const isSuperadmin = meRow?.rol === "superadmin" || meEmail === SUPERADMIN_EMAIL;
    if (!isSuperadmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // 2) Crea usuario en Auth + inserta perfil en usuarios (service role)
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (created.error || !created.data.user) {
      return NextResponse.json({ error: created.error?.message ?? "Failed to create user" }, { status: 400 });
    }

    const uid = created.data.user.id;
    const ins = await adminClient.from("usuarios").insert({
      id: uid,
      email,
      rol,
      establecimiento_id
    });
    if (ins.error) {
      return NextResponse.json({ error: ins.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

