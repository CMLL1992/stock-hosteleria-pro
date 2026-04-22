"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppRole } from "@/lib/session";
import { fetchMyRole, requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { waUrlProductoPedido } from "@/lib/whatsappPedido";
import { clasesBordeSemaforo, clasesFondoSemaforo, stockSemaforo } from "@/lib/stockSemaforo";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { enqueueMovimiento, newClientUuid } from "@/lib/offlineQueue";

type Row = {
  id: string;
  articulo: string;
  stock_actual: number;
  stock_minimo: number | null;
  categoria: string | null;
  unidad: string | null;
  proveedor: null | {
    id: string;
    nombre: string;
    telefono_whatsapp: string | null;
  };
};

async function fetchProductos(establecimientoId: string | null): Promise<Row[]> {
  if (!establecimientoId) return [];
  const col = await resolveProductoTituloColumn(establecimientoId);
  const t = tituloColSql(col);
  const { data, error } = await supabase()
    .from("productos")
    .select(`id,${t},stock_actual,stock_minimo,categoria,unidad,proveedor:proveedores(id,nombre,telefono_whatsapp)` as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });
  if (error) throw error;
  return (
    ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: String(r.id ?? ""),
      articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
      stock_actual: Number(r.stock_actual ?? 0) || 0,
      stock_minimo: r.stock_minimo != null ? Number(r.stock_minimo) : null,
      categoria: r.categoria != null ? String(r.categoria) : null,
      unidad: r.unidad != null ? String(r.unidad) : null,
      proveedor: r.proveedor as Row["proveedor"]
    })) ?? []
  );
}

export default function PedidoRapidoPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [recibido, setRecibido] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const { activeEstablishmentId } = useActiveEstablishment();

  const refresh = useCallback(async () => {
    if (!activeEstablishmentId) {
      setItems([]);
      return;
    }
    const rows = await fetchProductos(activeEstablishmentId);
    setItems(rows);
  }, [activeEstablishmentId]);

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

  useEffect(() => {
    if (role !== "admin" && role !== "superadmin") return;
    let cancelled = false;
    setLoadingItems(true);
    fetchProductos(activeEstablishmentId ?? null)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(supabaseErrToString(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, role]);

  const totals = useMemo(() => items.length, [items.length]);

  async function deltaStock(p: Row, delta: number) {
    if (!activeEstablishmentId) {
      setErr("No hay establecimiento activo.");
      return;
    }
    setBusyId(p.id);
    setErr(null);
    try {
      if (!delta) return;
      const tipo: "entrada" | "salida" = delta > 0 ? "entrada" : "salida";
      const cantidad = Math.abs(delta);
      const usuario_id = await requireUserId();
      const payload = {
        client_uuid: newClientUuid(),
        producto_id: p.id,
        establecimiento_id: activeEstablishmentId,
        tipo,
        cantidad,
        usuario_id,
        timestamp: new Date().toISOString()
      };

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { error } = await supabase().from("movimientos").upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        await enqueueMovimiento(payload);
      }
      await refresh();
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;

  if (role !== "admin" && role !== "superadmin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Pedido rápido (Admin)</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Pedido rápido" showBack backHref="/admin" />
      <main className="mx-auto w-full max-w-3xl p-4 pb-28 text-slate-900">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Pedido y recepción</h1>
          <p className="text-sm text-slate-500">Checklist de llegadas y ajuste rápido de stock ({totals} productos)</p>
        </div>

        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}

        {!activeEstablishmentId ? (
          <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No hay establecimiento activo. Selecciona uno para cargar productos.
          </p>
        ) : null}

        {loadingItems ? <p className="mb-3 text-sm text-slate-600">Cargando productos…</p> : null}

        <div className="space-y-3">
          {items.map((p) => {
            const min = typeof p.stock_minimo === "number" && Number.isFinite(p.stock_minimo) ? p.stock_minimo : 0;
            const sem = stockSemaforo(p.stock_actual, min);
            const wa = waUrlProductoPedido({
              articulo: p.articulo,
              stock_actual: p.stock_actual,
              stock_minimo: min,
              unidad: p.unidad,
              proveedor: p.proveedor
            });
            const busy = busyId === p.id;

            return (
              <div
                key={p.id}
                className={[
                  "w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm",
                  clasesBordeSemaforo(sem),
                  clasesFondoSemaforo(sem)
                ].join(" ")}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={!!recibido[p.id]}
                      onChange={(e) => setRecibido((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                      className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-slate-900">{p.articulo}</span>
                      <span className="mt-1 block text-xs text-slate-600">
                        {p.categoria ?? "—"} · {p.unidad ?? "—"} · Proveedor: {p.proveedor?.nombre ?? "—"}
                      </span>
                      <span className="mt-1 block font-mono text-sm text-slate-800">
                        Stock: {p.stock_actual} · Mín: {p.stock_minimo ?? "—"}
                      </span>
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {wa ? (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-600"
                      >
                        <IconWhatsApp className="h-6 w-6 text-white" />
                        <span className="hidden sm:inline">WhatsApp</span>
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <span className="text-xs font-medium text-slate-500">Ajustar stock</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || p.stock_actual <= 0}
                      onClick={() => deltaStock(p, -1)}
                      className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-2xl font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-40"
                      aria-label="Quitar una unidad"
                    >
                      −1
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => deltaStock(p, 1)}
                      className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border-2 border-emerald-200 bg-emerald-500 text-2xl font-bold text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-40"
                      aria-label="Sumar una unidad"
                    >
                      +1
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
