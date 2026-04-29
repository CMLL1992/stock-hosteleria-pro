import { NextResponse } from "next/server";
import { assertStaffOrThrow } from "@/lib/admin/assertStaff";
import { adminError, adminServerError } from "@/lib/admin/apiResponse";

type EnvaseRow = { id: string; coste: number };

export async function GET(req: Request) {
  try {
    const gate = await assertStaffOrThrow(req);
    if (!gate.ok) return gate.response as unknown as NextResponse;

    const { service } = gate;
    const url = new URL(req.url);
    const establecimientoId = String(url.searchParams.get("establecimiento_id") ?? "").trim();
    if (!establecimientoId) return adminError("Falta establecimiento_id", 400);

    // Global (NULL) + local. Usamos service role para evitar RLS en global.
    const { data, error } = await service
      .from("envases_catalogo")
      .select("id,coste,establecimiento_id")
      .or(`establecimiento_id.eq.${establecimientoId},establecimiento_id.is.null`)
      .limit(1000);

    if (error) return adminError(error.message, 400);

    const items: EnvaseRow[] =
      ((data ?? []) as unknown as Array<Record<string, unknown>>)
        .map((r) => ({
          id: String(r.id ?? "").trim(),
          coste: Number(r.coste ?? 0) || 0
        }))
        .filter((x) => x.id);

    return NextResponse.json({ items });
  } catch (e) {
    return adminServerError(e);
  }
}

