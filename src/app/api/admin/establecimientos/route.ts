import { NextResponse } from "next/server";
import { assertSuperadminOrThrow } from "@/lib/admin/assertSuperadmin";
import type { EstablecimientoRow } from "@/types/ops";

type Body = { nombre?: string; plan_suscripcion?: string; logo_url?: string | null };

/**
 * GET: lista todos los establecimientos (service role, bypass RLS).
 * Necesario para superadmin por email, donde el cliente con anon + RLS no ve todas las filas.
 */
export async function GET(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const { service } = gate;

    const full = await service
      .from("establecimientos")
      .select("id,nombre,plan_suscripcion,logo_url,created_at")
      .order("nombre", { ascending: true });

    if (!full.error) {
      return NextResponse.json({ items: (full.data as EstablecimientoRow[]) ?? [] });
    }

    const msg = full.error.message.toLowerCase();
    const missingPlan = msg.includes("plan_suscripcion") && msg.includes("could not find");
    if (!missingPlan) {
      return NextResponse.json({ error: full.error.message }, { status: 400 });
    }

    const fb = await service
      .from("establecimientos")
      .select("id,nombre,logo_url,created_at")
      .order("nombre", { ascending: true });
    if (fb.error) return NextResponse.json({ error: fb.error.message }, { status: 400 });
    return NextResponse.json({ items: (fb.data as EstablecimientoRow[]) ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const { nombre, plan_suscripcion, logo_url } = (await req.json()) as Body;
    if (!nombre || !plan_suscripcion) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { service } = gate;

    const attempt = await service
      .from("establecimientos")
      .insert({ nombre, plan_suscripcion, logo_url: logo_url || null })
      .select("id")
      .single();

    if (attempt.error) {
      const msg = attempt.error.message.toLowerCase();
      const missingPlan = msg.includes("plan_suscripcion") && msg.includes("could not find");
      if (!missingPlan) {
        return NextResponse.json({ error: attempt.error.message }, { status: 400 });
      }
      const fb = await service
        .from("establecimientos")
        .insert({ nombre, logo_url: logo_url || null })
        .select("id")
        .single();
      if (fb.error) return NextResponse.json({ error: fb.error.message }, { status: 400 });
      return NextResponse.json({ ok: true, id: (fb.data as { id: string }).id });
    }

    return NextResponse.json({ ok: true, id: (attempt.data as { id: string }).id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
