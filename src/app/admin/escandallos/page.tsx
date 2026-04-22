"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { costeNeto, formatEUR, margenBeneficioPct, margenBrutoEUR, ventaNetaSinIva } from "@/lib/finance";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";

type ProductoRow = {
  id: string;
  articulo: string;
  precio_tarifa: number | null;
  descuento_valor: number | null;
  descuento_tipo: "%" | "€" | null;
  iva_compra: number | null;
  pvp: number | null;
  iva_venta: number | null;
};

const IVA_OPTIONS = [4, 10, 21] as const;
const DESC_OPTIONS = ["%", "€"] as const;

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function toNum(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function clampNonNeg(x: number): number {
  return x < 0 ? 0 : x;
}

export default function EscandallosPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [items, setItems] = useState<ProductoRow[]>([]);
  const { activeEstablishmentId } = useActiveEstablishment();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchMyRole()
      .then((r) => {
        if (cancelled) return;
        setRole(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(errMsg(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function load() {
    setErr(null);
    if (!activeEstablishmentId) return;
    const col = await resolveProductoTituloColumn(activeEstablishmentId);
    const t = tituloColSql(col);
    const { data, error } = await supabase()
      .from("productos")
      .select(`id,${t},precio_tarifa,descuento_valor,descuento_tipo,iva_compra,pvp,iva_venta` as "*")
      .eq("establecimiento_id", activeEstablishmentId)
      .order(t, { ascending: true });
    if (error) throw error;
    setItems(
      ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
        id: String(r.id ?? ""),
        articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
        precio_tarifa: r.precio_tarifa != null ? Number(r.precio_tarifa) : null,
        descuento_valor: r.descuento_valor != null ? Number(r.descuento_valor) : null,
        descuento_tipo: (r.descuento_tipo as ProductoRow["descuento_tipo"]) ?? null,
        iva_compra: r.iva_compra != null ? Number(r.iva_compra) : null,
        pvp: r.pvp != null ? Number(r.pvp) : null,
        iva_venta: r.iva_venta != null ? Number(r.iva_venta) : null
      }))
    );
  }

  useEffect(() => {
    if (role !== "admin" && role !== "superadmin") return;
    if (!activeEstablishmentId) return;
    load().catch((e) => setErr(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEstablishmentId, role]);

  async function saveRow(p: ProductoRow) {
    setErr(null);
    setSaved(false);
    setSaving(p.id);
    try {
      if (!activeEstablishmentId) throw new Error("No hay establecimiento activo.");
      const payload = {
        precio_tarifa: clampNonNeg(Number(p.precio_tarifa ?? 0)),
        descuento_valor: clampNonNeg(Number(p.descuento_valor ?? 0)),
        descuento_tipo: (p.descuento_tipo ?? "%") as "%" | "€",
        iva_compra: Number(p.iva_compra ?? 10),
        pvp: clampNonNeg(Number(p.pvp ?? 0)),
        iva_venta: Number(p.iva_venta ?? 10)
      };
      const { error } = await supabase()
        .from("productos")
        .update(payload)
        .eq("id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } finally {
      setSaving(null);
    }
  }

  const rows = useMemo(() => {
    return items.map((p) => {
      const cn = costeNeto(p);
      const vn = ventaNetaSinIva(p);
      const mb = margenBrutoEUR(p);
      const mp = margenBeneficioPct(p);
      const healthy = mp >= 60;
      return { p, cn, vn, mb, mp, healthy };
    });
  }, [items]);

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (role !== "admin" && role !== "superadmin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Escandallos (Admin)</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Escandallos" showBack backHref="/admin" />
      <main className="mx-auto max-w-5xl bg-slate-50 p-4 pb-28 text-slate-900">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Escandallos</h1>
          <p className="text-sm text-slate-600">Edita precios y márgenes por producto (vista tarjetas).</p>
        </div>
        <div className="flex items-center gap-2">
          {saved ? <span className="text-sm font-semibold text-emerald-700">Guardado ✓</span> : null}
        </div>
      </div>

      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {rows.map(({ p, cn, vn, mb, mp, healthy }) => (
          <article key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <h2 className="text-base font-bold leading-snug text-slate-900">{p.articulo}</h2>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Tarifa
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={String(p.precio_tarifa ?? 0)}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, precio_tarifa: toNum(e.currentTarget.value) } : x)))
                  }
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Descuento
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={String(p.descuento_valor ?? 0)}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) => (x.id === p.id ? { ...x, descuento_valor: toNum(e.currentTarget.value) } : x))
                    )
                  }
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Tipo desc.
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={(p.descuento_tipo ?? "%") as "%" | "€"}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) => (x.id === p.id ? { ...x, descuento_tipo: e.currentTarget.value as "%" | "€" } : x))
                    )
                  }
                >
                  {DESC_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                IVA compra
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={Number(p.iva_compra ?? 10)}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) => (x.id === p.id ? { ...x, iva_compra: Number(e.currentTarget.value) } : x))
                    )
                  }
                >
                  {IVA_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                PVP
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={String(p.pvp ?? 0)}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, pvp: toNum(e.currentTarget.value) } : x)))
                  }
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                IVA venta
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={Number(p.iva_venta ?? 10)}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) => (x.id === p.id ? { ...x, iva_venta: Number(e.currentTarget.value) } : x))
                    )
                  }
                >
                  {IVA_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold text-slate-500">Coste neto</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatEUR(cn)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold text-slate-500">Venta neta</dt>
                <dd className="tabular-nums text-slate-800">{formatEUR(vn)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold text-slate-500">Margen €</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatEUR(mb)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold text-slate-500">Margen %</dt>
                <dd>
                  <span
                    className={[
                      "inline-flex min-h-8 items-center rounded-full px-2.5 text-xs font-semibold tabular-nums ring-1",
                      healthy ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-red-50 text-red-800 ring-red-100"
                    ].join(" ")}
                  >
                    {mp.toFixed(2)}%
                  </span>
                </dd>
              </div>
            </dl>

            <div className="mt-4">
              <Button onClick={() => saveRow(p)} disabled={saving === p.id} className="min-h-11 w-full sm:w-auto">
                {saving === p.id ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </article>
        ))}
      </div>
      </main>
    </div>
  );
}

