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
import { supabaseErrToString } from "@/lib/supabaseErrToString";

type ProductoRow = {
  id: string;
  articulo: string;
  proveedor_id: string | null;
  precio_tarifa: number | null;
  uds_caja?: number | null;
  descuento_valor: number | null;
  descuento_tipo: "%" | "€" | null;
  rappel_valor?: number | null;
  iva_compra: number | null;
  pvp: number | null;
  iva_venta: number | null;
};

type ProveedorRow = { id: string; nombre: string };

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
  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const { activeEstablishmentId } = useActiveEstablishment();

  // "Nuevo escandallo" (form)
  const [nuevoId, setNuevoId] = useState<string>("");
  const [nuevoProveedorId, setNuevoProveedorId] = useState<string>("");
  const [nuevoPrecioTarifa, setNuevoPrecioTarifa] = useState<string>("0");
  const [nuevoUdsCaja, setNuevoUdsCaja] = useState<string>("0");
  const [nuevoDescuentoValor, setNuevoDescuentoValor] = useState<string>("0");
  const [nuevoDescuentoTipo, setNuevoDescuentoTipo] = useState<"%" | "€">("%");
  const [nuevoRappel, setNuevoRappel] = useState<string>("0");
  const [nuevoIvaCompra, setNuevoIvaCompra] = useState<number>(10);
  const [nuevoPvp, setNuevoPvp] = useState<string>("0");
  const [nuevoIvaVenta, setNuevoIvaVenta] = useState<number>(10);

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
        setErr(supabaseErrToString(e));
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
    const fullSel = `id,${t},proveedor_id,precio_tarifa,uds_caja,descuento_valor,descuento_tipo,rappel_valor,iva_compra,pvp,iva_venta`;
    const res = await supabase()
      .from("productos")
      .select(fullSel as "*")
      .eq("establecimiento_id", activeEstablishmentId)
      .order(t, { ascending: true });

    if (res.error) {
      const msg = (res.error.message ?? "").toLowerCase();
      const missing =
        msg.includes("uds_caja") || msg.includes("rappel_valor") || msg.includes("could not find") || msg.includes("column");
      if (!missing) throw res.error;
      const fb = await supabase()
        .from("productos")
        .select(`id,${t},proveedor_id,precio_tarifa,descuento_valor,descuento_tipo,iva_compra,pvp,iva_venta` as "*")
        .eq("establecimiento_id", activeEstablishmentId)
        .order(t, { ascending: true });
      if (fb.error) throw fb.error;
      setItems(
        ((fb.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
          id: String(r.id ?? ""),
          articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
          proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null,
          precio_tarifa: r.precio_tarifa != null ? Number(r.precio_tarifa) : null,
          descuento_valor: r.descuento_valor != null ? Number(r.descuento_valor) : null,
          descuento_tipo: (r.descuento_tipo as ProductoRow["descuento_tipo"]) ?? null,
          iva_compra: r.iva_compra != null ? Number(r.iva_compra) : null,
          pvp: r.pvp != null ? Number(r.pvp) : null,
          iva_venta: r.iva_venta != null ? Number(r.iva_venta) : null
        }))
      );
      return;
    }

    setItems(
      ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
        id: String(r.id ?? ""),
        articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
        proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null,
        precio_tarifa: r.precio_tarifa != null ? Number(r.precio_tarifa) : null,
        uds_caja: r.uds_caja != null ? Number(r.uds_caja) : null,
        descuento_valor: r.descuento_valor != null ? Number(r.descuento_valor) : null,
        descuento_tipo: (r.descuento_tipo as ProductoRow["descuento_tipo"]) ?? null,
        rappel_valor: r.rappel_valor != null ? Number(r.rappel_valor) : null,
        iva_compra: r.iva_compra != null ? Number(r.iva_compra) : null,
        pvp: r.pvp != null ? Number(r.pvp) : null,
        iva_venta: r.iva_venta != null ? Number(r.iva_venta) : null
      }))
    );
  }

  useEffect(() => {
    if (role !== "admin" && role !== "superadmin") return;
    if (!activeEstablishmentId) return;
    load().catch((e) => setErr(supabaseErrToString(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEstablishmentId, role]);

  useEffect(() => {
    if (role !== "admin" && role !== "superadmin") return;
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await supabase()
          .from("proveedores")
          .select("id,nombre")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("nombre", { ascending: true });
        if (res.error) throw res.error;
        if (!cancelled) setProveedores((res.data as ProveedorRow[]) ?? []);
      } catch (e) {
        if (!cancelled) setErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, role]);

  async function saveRow(p: ProductoRow) {
    setErr(null);
    setSaved(false);
    setSaving(p.id);
    try {
      if (!activeEstablishmentId) throw new Error("No hay establecimiento activo.");
      const payload = {
        proveedor_id: p.proveedor_id,
        precio_tarifa: clampNonNeg(Number(p.precio_tarifa ?? 0)),
        uds_caja: clampNonNeg(Number(p.uds_caja ?? 0)),
        descuento_valor: clampNonNeg(Number(p.descuento_valor ?? 0)),
        descuento_tipo: (p.descuento_tipo ?? "%") as "%" | "€",
        rappel_valor: clampNonNeg(Number(p.rappel_valor ?? 0)),
        iva_compra: Number(p.iva_compra ?? 10),
        pvp: clampNonNeg(Number(p.pvp ?? 0)),
        iva_venta: Number(p.iva_venta ?? 10)
      };
      const res = await supabase()
        .from("productos")
        .update(payload)
        .eq("id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (!res.error) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
        return;
      }
      // Compat: si faltan columnas nuevas en BD, reintentamos sin ellas.
      const msg = (res.error.message ?? "").toLowerCase();
      const missing = msg.includes("uds_caja") || msg.includes("rappel_valor");
      if (!missing) throw res.error;
      const { error: fbErr } = await supabase()
        .from("productos")
        .update({
          proveedor_id: p.proveedor_id,
          precio_tarifa: clampNonNeg(Number(p.precio_tarifa ?? 0)),
          descuento_valor: clampNonNeg(Number(p.descuento_valor ?? 0)),
          descuento_tipo: (p.descuento_tipo ?? "%") as "%" | "€",
          iva_compra: Number(p.iva_compra ?? 10),
          pvp: clampNonNeg(Number(p.pvp ?? 0)),
          iva_venta: Number(p.iva_venta ?? 10)
        })
        .eq("id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (fbErr) throw fbErr;
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } finally {
      setSaving(null);
    }
  }

  async function guardarNuevo() {
    if (!activeEstablishmentId) return;
    if (!nuevoId) return;
    setErr(null);
    setSaving(nuevoId);
    try {
      const payload = {
        proveedor_id: nuevoProveedorId || null,
        precio_tarifa: clampNonNeg(toNum(nuevoPrecioTarifa)),
        uds_caja: clampNonNeg(Math.trunc(toNum(nuevoUdsCaja))),
        descuento_valor: clampNonNeg(toNum(nuevoDescuentoValor)),
        descuento_tipo: nuevoDescuentoTipo,
        rappel_valor: clampNonNeg(toNum(nuevoRappel)),
        iva_compra: Number(nuevoIvaCompra),
        pvp: clampNonNeg(toNum(nuevoPvp)),
        iva_venta: Number(nuevoIvaVenta)
      };
      const res = await supabase().from("productos").update(payload).eq("id", nuevoId).eq("establecimiento_id", activeEstablishmentId);
      if (!res.error) {
        await load();
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
        return;
      }
      const msg = (res.error.message ?? "").toLowerCase();
      const missing = msg.includes("uds_caja") || msg.includes("rappel_valor");
      if (!missing) throw res.error;
      const { error: fbErr } = await supabase()
        .from("productos")
        .update({
          proveedor_id: nuevoProveedorId || null,
          precio_tarifa: clampNonNeg(toNum(nuevoPrecioTarifa)),
          descuento_valor: clampNonNeg(toNum(nuevoDescuentoValor)),
          descuento_tipo: nuevoDescuentoTipo,
          iva_compra: Number(nuevoIvaCompra),
          pvp: clampNonNeg(toNum(nuevoPvp)),
          iva_venta: Number(nuevoIvaVenta)
        })
        .eq("id", nuevoId)
        .eq("establecimiento_id", activeEstablishmentId);
      if (fbErr) throw fbErr;
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch (e) {
      setErr(supabaseErrToString(e));
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

      {/* Nuevo Escandallo (UX guiada) */}
      <section className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-base font-bold text-slate-900">Nuevo escandallo</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Producto
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoId}
              onChange={(e) => {
                const id = e.currentTarget.value;
                setNuevoId(id);
                const p = items.find((x) => x.id === id);
                if (p) {
                  setNuevoProveedorId(p.proveedor_id ?? "");
                  setNuevoPrecioTarifa(String(p.precio_tarifa ?? 0));
                  setNuevoUdsCaja(String(p.uds_caja ?? 0));
                  setNuevoDescuentoValor(String(p.descuento_valor ?? 0));
                  setNuevoDescuentoTipo((p.descuento_tipo ?? "%") as "%" | "€");
                  setNuevoRappel(String(p.rappel_valor ?? 0));
                  setNuevoIvaCompra(Number(p.iva_compra ?? 10));
                  setNuevoPvp(String(p.pvp ?? 0));
                  setNuevoIvaVenta(Number(p.iva_venta ?? 10));
                }
              }}
              aria-label="Producto"
            >
              <option value="">(Selecciona…)</option>
              {items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.articulo}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Proveedor
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoProveedorId}
              onChange={(e) => setNuevoProveedorId(e.currentTarget.value)}
              aria-label="Proveedor"
            >
              <option value="">(Sin proveedor)</option>
              {proveedores.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Precio tarifa / caja
            <input
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              inputMode="decimal"
              value={nuevoPrecioTarifa}
              onChange={(e) => setNuevoPrecioTarifa(e.currentTarget.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Uds / caja
            <input
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              inputMode="numeric"
              value={nuevoUdsCaja}
              onChange={(e) => setNuevoUdsCaja(e.currentTarget.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Descuento
            <input
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              inputMode="decimal"
              value={nuevoDescuentoValor}
              onChange={(e) => setNuevoDescuentoValor(e.currentTarget.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Tipo descuento
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoDescuentoTipo}
              onChange={(e) => setNuevoDescuentoTipo(e.currentTarget.value as "%" | "€")}
            >
              {DESC_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Rappel
            <input
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              inputMode="decimal"
              value={nuevoRappel}
              onChange={(e) => setNuevoRappel(e.currentTarget.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            IVA (compra)
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoIvaCompra}
              onChange={(e) => setNuevoIvaCompra(Number(e.currentTarget.value))}
            >
              {IVA_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}%
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            PVP por botella
            <input
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              inputMode="decimal"
              value={nuevoPvp}
              onChange={(e) => setNuevoPvp(e.currentTarget.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            IVA (venta)
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoIvaVenta}
              onChange={(e) => setNuevoIvaVenta(Number(e.currentTarget.value))}
            >
              {IVA_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}%
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <Button onClick={() => void guardarNuevo()} disabled={!nuevoId || saving === nuevoId} className="min-h-11 w-full sm:w-auto">
            {saving === nuevoId ? "Guardando…" : "Guardar escandallo"}
          </Button>
        </div>
      </section>

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

