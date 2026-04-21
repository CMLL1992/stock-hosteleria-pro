"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { costeNeto, formatEUR, margenBeneficioPct, margenBrutoEUR, ventaNetaSinIva } from "@/lib/finance";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";

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
        setErr(e instanceof Error ? e.message : String(e));
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
    const { data, error } = await supabase()
      .from("productos")
    .select("id,articulo,precio_tarifa,descuento_valor,descuento_tipo,iva_compra,pvp,iva_venta")
      .eq("establecimiento_id", activeEstablishmentId)
    .order("articulo", { ascending: true });
    if (error) throw error;
    setItems((data as unknown as ProductoRow[]) ?? []);
  }

  useEffect(() => {
    if (role !== "admin" && role !== "superadmin") return;
    if (!activeEstablishmentId) return;
    load().catch((e) => setErr(e instanceof Error ? e.message : String(e)));
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
          <p className="text-sm text-slate-600">Edita precios y márgenes rápidamente. Desliza horizontalmente en móvil.</p>
        </div>
        <div className="flex items-center gap-2">
          {saved ? <span className="text-sm font-semibold text-emerald-700">Guardado ✓</span> : null}
        </div>
      </div>

      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      ) : null}

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-600">
                <th className="sticky left-0 z-10 bg-white px-4 py-3">Producto</th>
                <th className="px-3 py-3">Tarifa</th>
                <th className="px-3 py-3">Desc.</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="px-3 py-3">IVA compra</th>
                <th className="px-3 py-3">PVP</th>
                <th className="px-3 py-3">IVA venta</th>
                <th className="px-3 py-3">Coste neto</th>
                <th className="px-3 py-3">Venta neta</th>
                <th className="px-3 py-3">Margen €</th>
                <th className="px-3 py-3">Margen %</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, cn, vn, mb, mp, healthy }) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <p className="max-w-[260px] truncate text-sm font-semibold text-slate-900">{p.articulo}</p>
                  </td>

                  <td className="px-3 py-3">
                    <input
                      className="min-h-11 w-28 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                      inputMode="decimal"
                      value={String(p.precio_tarifa ?? 0)}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x) => (x.id === p.id ? { ...x, precio_tarifa: toNum(e.currentTarget.value) } : x))
                        )
                      }
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      className="min-h-11 w-24 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                      inputMode="decimal"
                      value={String(p.descuento_valor ?? 0)}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x) =>
                            x.id === p.id ? { ...x, descuento_valor: toNum(e.currentTarget.value) } : x
                          )
                        )
                      }
                    />
                  </td>

                  <td className="px-3 py-3">
                    <select
                      className="min-h-11 w-20 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
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
                  </td>

                  <td className="px-3 py-3">
                    <select
                      className="min-h-11 w-28 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
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
                  </td>

                  <td className="px-3 py-3">
                    <input
                      className="min-h-11 w-28 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                      inputMode="decimal"
                      value={String(p.pvp ?? 0)}
                      onChange={(e) =>
                        setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, pvp: toNum(e.currentTarget.value) } : x)))
                      }
                    />
                  </td>

                  <td className="px-3 py-3">
                    <select
                      className="min-h-11 w-28 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
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
                  </td>

                  <td className="px-3 py-3 text-sm font-semibold text-slate-900 tabular-nums">{formatEUR(cn)}</td>
                  <td className="px-3 py-3 text-sm text-slate-700 tabular-nums">{formatEUR(vn)}</td>
                  <td className="px-3 py-3 text-sm font-semibold text-slate-900 tabular-nums">{formatEUR(mb)}</td>
                  <td className="px-3 py-3">
                    <span
                      className={[
                        "inline-flex min-h-9 items-center rounded-full px-3 text-sm font-semibold tabular-nums ring-1",
                        healthy ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-red-50 text-red-800 ring-red-100"
                      ].join(" ")}
                    >
                      {mp.toFixed(2)}%
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <Button onClick={() => saveRow(p)} disabled={saving === p.id} className="min-h-11">
                      {saving === p.id ? "Guardando…" : "Guardar"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </main>
    </div>
  );
}

