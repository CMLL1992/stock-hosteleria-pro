import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = { nombre?: string; plan_suscripcion?: string };

const SUPERADMIN_EMAIL = "ximomitja1992@hotmail.com";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

    const { nombre, plan_suscripcion } = (await req.json()) as Body;
    if (!nombre || !plan_suscripcion) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const me = await authClient.auth.getUser();
    const meEmail = (me.data.user?.email ?? "").toLowerCase();
    if (!me.data.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: meRow } = await authClient.from("usuarios").select("rol").eq("id", me.data.user.id).maybeSingle();
    const isSuperadmin = meRow?.rol === "superadmin" || meEmail === SUPERADMIN_EMAIL;
    if (!isSuperadmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const { data, error } = await adminClient
      .from("establecimientos")
      .insert({ nombre, plan_suscripcion })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, id: (data as { id: string }).id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

