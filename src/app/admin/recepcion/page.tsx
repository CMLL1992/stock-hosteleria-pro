"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { enqueueMovimiento } from "@/lib/offlineQueue";
import { requireUserId } from "@/lib/session";

type ProveedorRow = { id: string; nombre: string };

type ProductoRow = {
  id: string;
  articulo: string;
  unidad: string | null;
  stock_vacios: number;
};

type RecepcionItem = { producto_id: string; recibido: number; vacios: number };
type ConfirmRecepcionResult = { ok?: boolean };

function toInt(v: unknown): number {
  const n = Math.trunc(Number(String(v ?? "").replace(",", ".")));
  return Number.isFinite(n) ? n : 0;
}

function toastKindClass(kind: "ok" | "error") {
  return kind === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-red-200 bg-red-50 text-red-900";
}

export default function RecepcionPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const { activeEstablishmentId } = useActiveEstablishment();

  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const [proveedorId, setProveedorId] = useState<string>("");
  const proveedorNombre = useMemo(
    () => proveedores.find((p) => p.id === proveedorId)?.nombre ?? "",
    [proveedorId, proveedores]
  );

  const [productos, setProductos] = useState<ProductoRow[]>([]);
  const [recibido, setRecibido] = useState<Record<string, string>>({});
  const [vacios, setVacios] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!me?.isAdmin) return;
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      setErr(null);
      try {
        const res = await supabase()
          .from("proveedores")
          .select("id,nombre")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("nombre", { ascending: true });
        if (res.error) throw res.error;
        if (cancelled) return;
        setProveedores((res.data as ProveedorRow[]) ?? []);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, me?.isAdmin]);

  useEffect(() => {
    if (!me?.isAdmin) return;
    if (!activeEstablishmentId) return;
    if (!proveedorId) {
      setProductos([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const col = await resolveProductoTituloColumn(activeEstablishmentId);
        const t = tituloColSql(col);
        const select = `id,${t},unidad,stock_vacios`;
        const res = await supabase()
          .from("productos")
          .select(select as "*")
          .eq("establecimiento_id", activeEstablishmentId)
          .eq("proveedor_id", proveedorId)
          .order(t, { ascending: true });
        if (res.error) throw res.error;
        const rows = ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
          id: String(r.id ?? ""),
          articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
          unidad: r.unidad != null ? String(r.unidad) : null,
          stock_vacios: toInt(r.stock_vacios)
        }));
        if (cancelled) return;
        setProductos(rows);
        setRecibido((prev) => {
          const next = { ...prev };
          for (const p of rows) if (next[p.id] === undefined) next[p.id] = "";
          return next;
        });
        setVacios((prev) => {
          const next = { ...prev };
          for (const p of rows) if (next[p.id] === undefined) next[p.id] = "";
          return next;
        });
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setProductos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, me?.isAdmin, proveedorId]);

  const anyQty = useMemo(() => {
    for (const p of productos) {
      if (toInt(recibido[p.id]) > 0) return true;
      if (toInt(vacios[p.id]) > 0) return true;
    }
    return false;
  }, [productos, recibido, vacios]);

  async function confirmar() {
    if (!activeEstablishmentId || !proveedorId) return;
    setToast(null);
    setErr(null);
    setConfirming(true);
    try {
      const items = productos
        .map((p) => ({
          producto_id: p.id,
          recibido: toInt(recibido[p.id]),
          vacios: toInt(vacios[p.id])
        }))
        .filter((x) => x.recibido > 0 || x.vacios > 0);

      if (items.length === 0) return;

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { data, error } = await supabase().rpc("confirm_recepcion", {
          p_proveedor_id: proveedorId,
          p_items: items
        });
        if (error) throw error;
        const ok = ((data ?? null) as ConfirmRecepcionResult | null)?.ok ?? true;
        if (!ok) throw new Error("No se pudo confirmar la recepción.");
      } else {
        // Fallback offline: encola movimientos (sin transacción). Se sincroniza al volver online.
        const usuario_id = await requireUserId();
        const ts = new Date().toISOString();
        for (const it of items as RecepcionItem[]) {
          if (it.recibido > 0) {
            await enqueueMovimiento({
              producto_id: it.producto_id,
              establecimiento_id: activeEstablishmentId,
              tipo: "entrada_compra",
              cantidad: it.recibido,
              usuario_id,
              timestamp: ts,
              proveedor_id: proveedorId
            });
          }
          if (it.vacios > 0) {
            await enqueueMovimiento({
              producto_id: it.producto_id,
              establecimiento_id: activeEstablishmentId,
              tipo: "devolucion_proveedor",
              cantidad: it.vacios,
              usuario_id,
              timestamp: ts,
              proveedor_id: proveedorId
            });
          }
        }
      }

      setToast({ kind: "ok", msg: `✅ Mercancía de ${proveedorNombre || "proveedor"} registrada` });
      setRecibido((prev) => {
        const next = { ...prev };
        for (const p of productos) next[p.id] = "";
        return next;
      });
      setVacios((prev) => {
        const next = { ...prev };
        for (const p of productos) next[p.id] = "";
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setToast({ kind: "error", msg: "No se pudo confirmar la recepción." });
    } finally {
      setConfirming(false);
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!me?.isAdmin) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Recepción" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4">
          <p className="text-sm text-slate-600">Acceso denegado.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Recepción" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Recepción de pedidos</h1>
          <p className="mt-1 text-sm text-slate-600">Selecciona proveedor, introduce cantidades y confirma.</p>
        </div>

        {toast ? (
          <div className={["mb-3 rounded-2xl border p-3 text-sm font-semibold", toastKindClass(toast.kind)].join(" ")}>
            {toast.msg}
          </div>
        ) : null}

        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}

        <div className="space-y-2 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold text-slate-900">Proveedor</label>
          <select
            className="min-h-14 w-full rounded-2xl border-2 border-slate-800 bg-white px-4 text-base font-semibold text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-300"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.currentTarget.value)}
            aria-label="Selecciona proveedor"
          >
            <option value="">(Selecciona…)</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        {!proveedorId ? (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            Selecciona un proveedor para ver sus productos.
          </p>
        ) : loading ? (
          <p className="mt-4 text-sm text-slate-600">Cargando productos…</p>
        ) : productos.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            No hay productos asignados a este proveedor.
          </p>
        ) : (
          <section className="mt-4 space-y-3">
            <div className="grid grid-cols-[1fr_96px_96px] gap-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
              <span>Producto</span>
              <span className="text-center">Recibido</span>
              <span className="text-center">Vacíos</span>
            </div>

            <ul className="flex flex-col gap-3">
              {productos.map((p) => (
                <li key={p.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid grid-cols-[1fr_96px_96px] items-center gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold text-slate-900">{p.articulo}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {p.unidad ?? "—"} · Vacíos actuales: <span className="font-mono font-semibold">{p.stock_vacios}</span>
                      </p>
                    </div>

                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      placeholder="0"
                      className="h-16 w-24 rounded-2xl border-2 border-slate-800 bg-white px-2 text-center text-3xl font-black tabular-nums text-slate-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-slate-300"
                      value={recibido[p.id] ?? ""}
                      onChange={(e) => setRecibido((prev) => ({ ...prev, [p.id]: e.currentTarget.value }))}
                      disabled={confirming}
                      aria-label={`Cantidad recibida para ${p.articulo}`}
                    />

                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      placeholder="0"
                      className="h-16 w-24 rounded-2xl border-2 border-sky-900 bg-white px-2 text-center text-3xl font-black tabular-nums text-sky-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-sky-200"
                      value={vacios[p.id] ?? ""}
                      onChange={(e) => setVacios((prev) => ({ ...prev, [p.id]: e.currentTarget.value }))}
                      disabled={confirming}
                      aria-label={`Vacíos devueltos para ${p.articulo}`}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={!anyQty || confirming || !proveedorId}
              className={[
                "mt-2 inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-3xl px-5 py-5 text-lg font-extrabold shadow-xl transition",
                anyQty && !confirming ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-slate-200 text-slate-500"
              ].join(" ")}
            >
              📥 Confirmar Recepción
            </button>
            <p className="text-center text-xs text-slate-500">
              Se registran movimientos por cada línea con cantidad &gt; 0.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

