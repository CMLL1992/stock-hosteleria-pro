import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { assertSuperadminOrThrow } from "@/lib/admin/assertSuperadmin";
import { adminError, adminServerError } from "@/lib/admin/apiResponse";
import type { EstablecimientoRow } from "@/types/ops";

type Body = { nombre?: string; plan_suscripcion?: string; logo_url?: string | null };
type DeleteBody = { id?: string };

/**
 * Orden: movimientos → productos → proveedores → usuarios (public) → auth por usuario → establecimiento.
 * FKs en public suelen ser restrict al establecimiento; evitamos depender de ON DELETE CASCADE.
 */
async function deleteEstablecimientoCascade(
  service: SupabaseClient,
  establecimientoId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const m = await service.from("movimientos").delete().eq("establecimiento_id", establecimientoId);
  if (m.error) return { ok: false, message: m.error.message };

  const p = await service.from("productos").delete().eq("establecimiento_id", establecimientoId);
  if (p.error) return { ok: false, message: p.error.message };

  const pr = await service.from("proveedores").delete().eq("establecimiento_id", establecimientoId);
  if (pr.error) return { ok: false, message: pr.error.message };

  const { data: uRows, error: uErr } = await service
    .from("usuarios")
    .select("id")
    .eq("establecimiento_id", establecimientoId);
  if (uErr) return { ok: false, message: uErr.message };
  const userIds = (uRows as { id: string }[] | null)?.map((r) => r.id) ?? [];

  const du = await service.from("usuarios").delete().eq("establecimiento_id", establecimientoId);
  if (du.error) return { ok: false, message: du.error.message };

  for (const uid of userIds) {
    await service.auth.admin.deleteUser(uid);
  }

  const e = await service.from("establecimientos").delete().eq("id", establecimientoId);
  if (e.error) return { ok: false, message: e.error.message };
  return { ok: true };
}

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
      return adminError(full.error.message, 400);
    }

    const fb = await service
      .from("establecimientos")
      .select("id,nombre,logo_url,created_at")
      .order("nombre", { ascending: true });
    if (fb.error) return adminError(fb.error.message, 400);
    return NextResponse.json({ items: (fb.data as EstablecimientoRow[]) ?? [] });
  } catch (e) {
    return adminServerError(e);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const { nombre, plan_suscripcion, logo_url } = (await req.json()) as Body;
    if (!nombre || !String(nombre).trim()) {
      return adminError("Falta el nombre del establecimiento.", 400);
    }
    if (plan_suscripcion === undefined || plan_suscripcion === null || !String(plan_suscripcion).trim()) {
      return adminError("Falta el campo plan_suscripcion.", 400);
    }

    const { service } = gate;

    const attempt = await service
      .from("establecimientos")
      .insert({ nombre: String(nombre).trim(), plan_suscripcion: String(plan_suscripcion).trim(), logo_url: logo_url || null })
      .select("id")
      .single();

    if (attempt.error) {
      const msg = attempt.error.message.toLowerCase();
      const missingPlan = msg.includes("plan_suscripcion") && msg.includes("could not find");
      if (!missingPlan) {
        return adminError(attempt.error.message, 400);
      }
      const fb = await service
        .from("establecimientos")
        .insert({ nombre: String(nombre).trim(), logo_url: logo_url || null })
        .select("id")
        .single();
      if (fb.error) return adminError(fb.error.message, 400);
      return NextResponse.json({ ok: true, id: (fb.data as { id: string }).id });
    }

    return NextResponse.json({ ok: true, id: (attempt.data as { id: string }).id });
  } catch (e) {
    return adminServerError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await assertSuperadminOrThrow(req);
    if (!gate.ok) return gate.response;

    const { id: establecimientoId } = (await req.json()) as DeleteBody;
    if (!establecimientoId || typeof establecimientoId !== "string" || !establecimientoId.trim()) {
      return adminError("Falta el campo id del establecimiento a eliminar.", 400);
    }

    if (gate.establecimientoId && establecimientoId === gate.establecimientoId) {
      return adminError("No puedes eliminar el establecimiento con el que estás vinculado", 400);
    }

    const { service } = gate;
    const res = await deleteEstablecimientoCascade(service, establecimientoId);
    if (!res.ok) {
      return adminError(res.message, 400);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return adminServerError(e);
  }
}
