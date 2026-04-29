import { NextResponse } from "next/server";
import { assertStaffOrThrow } from "@/lib/admin/assertStaff";
import { adminError, adminServerError } from "@/lib/admin/apiResponse";

type Item = {
  producto_id: string;
  precio_tarifa: number;
  descuento_valor: number;
  descuento_tipo: "%" | "€";
  rappel_valor: number;
};

function normalizeDescTipo(v: unknown): "%" | "€" {
  return String(v ?? "%") === "€" ? "€" : "%";
}

export async function POST(req: Request) {
  try {
    const gate = await assertStaffOrThrow(req);
    if (!gate.ok) return gate.response as unknown as NextResponse;

    const body = (await req.json()) as { establecimiento_id?: string; product_ids?: string[] };
    const establecimientoId = String(body?.establecimiento_id ?? "").trim();
    const ids = Array.from(new Set((body?.product_ids ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)));
    if (!establecimientoId) return adminError("Falta establecimiento_id", 400);
    if (!ids.length) return NextResponse.json({ items: [] as Item[] });

    const { service } = gate;

    const { data, error } = await service
      .from("escandallos")
      .select("producto_id,precio_tarifa,descuento_valor,descuento_tipo,rappel_valor,establecimiento_id")
      .eq("establecimiento_id", establecimientoId)
      .in("producto_id", ids)
      .limit(5000);
    if (error) return adminError(error.message, 400);

    const items: Item[] = ((data ?? []) as unknown as Array<Record<string, unknown>>)
      .map((r) => {
        const pid = String(r.producto_id ?? "").trim();
        if (!pid) return null;
        const precio = Number(r.precio_tarifa ?? 0);
        const descVal = Number(r.descuento_valor ?? 0);
        const rappel = Number(r.rappel_valor ?? 0);
        return {
          producto_id: pid,
          precio_tarifa: Number.isFinite(precio) ? precio : 0,
          descuento_valor: Number.isFinite(descVal) ? descVal : 0,
          descuento_tipo: normalizeDescTipo(r.descuento_tipo),
          rappel_valor: Number.isFinite(rappel) ? rappel : 0
        } satisfies Item;
      })
      .filter(Boolean) as Item[];

    return NextResponse.json({ items });
  } catch (e) {
    return adminServerError(e);
  }
}

