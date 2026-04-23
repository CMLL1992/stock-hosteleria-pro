"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useQueryClient } from "@tanstack/react-query";

type PedidoEstado = "pendiente" | "parcial" | "recibido";

type PedidoRow = {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  estado: PedidoEstado;
  created_at: string;
};

type PedidoItemRow = {
  producto_id: string;
  articulo: string;
  unidad: string | null;
  cantidad_pedida: number;
  cantidad_recibida: number;
};

function toInt(v: unknown): number {
  const n = Math.trunc(Number(String(v ?? "").replace(",", ".")));
  return Number.isFinite(n) ? n : 0;
}

function digitsOnly(raw: string): string {
  return String(raw ?? "").replace(/[^\d]/g, "");
}

export default function RecepcionPedidosPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canReceive = hasPermission(role, "staff");

  const { activeEstablishmentId } = useActiveEstablishment();
  const queryClient = useQueryClient();

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);

  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<PedidoRow | null>(null);
  const [items, setItems] = useState<PedidoItemRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeEstablishmentId) {
      setPedidos([]);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const { data, error } = await supabase()
        .from("pedidos")
        .select("id,proveedor_id,estado,created_at,proveedor:proveedores(nombre)")
        .eq("establecimiento_id", activeEstablishmentId)
        .in("estado", ["pendiente", "parcial"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const provRaw = r.proveedor as { nombre?: unknown } | { nombre?: unknown }[] | null | undefined;
        const prov = Array.isArray(provRaw) ? provRaw[0] ?? null : provRaw;
        return {
          id: String(r.id ?? ""),
          proveedor_id: String(r.proveedor_id ?? ""),
          proveedor_nombre: String(prov?.nombre ?? "Proveedor").trim() || "Proveedor",
          estado: (String(r.estado ?? "pendiente") as PedidoEstado) ?? "pendiente",
          created_at: String(r.created_at ?? new Date().toISOString())
        } satisfies PedidoRow;
      });
      setPedidos(rows);
    } catch (e) {
      setErr(supabaseErrToString(e));
      setPedidos([]);
    } finally {
      setLoading(false);
    }
  }, [activeEstablishmentId]);

  useEffect(() => {
    if (!canReceive) return;
    void refresh();
  }, [canReceive, refresh]);

  async function openPedido(p: PedidoRow) {
    if (!activeEstablishmentId) return;
    setErr(null);
    setSel(p);
    setOpen(true);
    setItems([]);
    setDraft({});
    try {
      const { data, error } = await supabase()
        .from("pedido_items")
        .select("producto_id,cantidad_pedida,cantidad_recibida,productos:productos(articulo,nombre,unidad)")
        .eq("pedido_id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const prodRaw = r.productos as
          | { articulo?: unknown; nombre?: unknown; unidad?: unknown }
          | { articulo?: unknown; nombre?: unknown; unidad?: unknown }[]
          | null
          | undefined;
        const prod = Array.isArray(prodRaw) ? prodRaw[0] ?? null : prodRaw;
        return {
          producto_id: String(r.producto_id ?? ""),
          articulo: String(prod?.articulo ?? prod?.nombre ?? "—").trim() || "—",
          unidad: prod?.unidad != null ? String(prod.unidad) : null,
          cantidad_pedida: Math.max(0, toInt(r.cantidad_pedida)),
          cantidad_recibida: Math.max(0, toInt(r.cantidad_recibida))
        } satisfies PedidoItemRow;
      });
      setItems(rows);
      setDraft((prev) => {
        const next = { ...prev };
        for (const it of rows) next[it.producto_id] = String(it.cantidad_recibida ?? 0);
        return next;
      });
    } catch (e) {
      setErr(supabaseErrToString(e));
    }
  }

  const anyChange = useMemo(() => {
    for (const it of items) {
      const n = Math.max(0, toInt(draft[it.producto_id] ?? ""));
      if (n !== Math.max(0, toInt(it.cantidad_recibida))) return true;
    }
    return false;
  }, [draft, items]);

  async function confirmar() {
    if (!activeEstablishmentId || !sel) return;
    setErr(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const payload = items.map((it) => ({
        producto_id: it.producto_id,
        recibido: Math.max(0, toInt(draft[it.producto_id] ?? ""))
      }));
      const { data, error } = await supabase().rpc("confirm_pedido_recepcion", {
        p_pedido_id: sel.id,
        p_items: payload
      });
      if (error) throw error;
      const ok = ((data ?? null) as { ok?: boolean } | null)?.ok ?? true;
      if (!ok) throw new Error("No se pudo confirmar la recepción.");
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", activeEstablishmentId] });
      await refresh();
      setOpen(false);
      setSel(null);
      setItems([]);
      setDraft({});
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canReceive) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Recepción de pedidos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4">
          <p className="text-sm text-slate-600">Acceso denegado.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Recepción de pedidos" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Pendientes</h1>
            <p className="mt-1 text-sm text-slate-600">Selecciona un pedido para registrar lo recibido.</p>
          </div>
          <button
            type="button"
            className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void refresh()}
            disabled={loading || !activeEstablishmentId}
          >
            {loading ? "Cargando…" : "Recargar"}
          </button>
        </div>

        {okMsg ? (
          <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
            {okMsg}
          </p>
        ) : null}
        {err ? <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}

        {!activeEstablishmentId ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            Selecciona un establecimiento.
          </p>
        ) : pedidos.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            No hay pedidos pendientes.
          </p>
        ) : (
          <div className="space-y-4">
            <section className="space-y-2">
              <ul className="space-y-2">
                {pedidos.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:bg-slate-50"
                      onClick={() => void openPedido(p)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{p.proveedor_nombre}</p>
                        <p className="text-xs text-slate-600">
                          Estado: <span className="font-semibold">{p.estado}</span>
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-slate-600">Abrir</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>

      <Drawer
        open={open}
        title={sel ? `Recepción · ${sel.proveedor_nombre}` : "Recepción"}
        onClose={() => {
          if (saving) return;
          setOpen(false);
          setSel(null);
          setItems([]);
          setDraft({});
        }}
      >
        <div className="space-y-3 pb-4">
          {items.length === 0 ? (
            <p className="text-sm text-slate-600">No hay líneas.</p>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_96px] gap-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
                <span>Producto</span>
                <span className="text-center">Recibido</span>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((it) => (
                  <li key={it.producto_id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="grid grid-cols-[1fr_96px] items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{it.articulo}</p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          Pedido: <span className="font-mono font-semibold tabular-nums">{it.cantidad_pedida}</span>
                          {" · "}
                          {it.unidad ?? "—"}
                        </p>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="h-14 w-24 rounded-2xl border-2 border-slate-800 bg-white px-2 text-center text-2xl font-black tabular-nums text-slate-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-slate-300"
                        value={draft[it.producto_id] ?? ""}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [it.producto_id]: digitsOnly(e.currentTarget.value) }))}
                        disabled={saving}
                        aria-label={`Cantidad recibida para ${it.articulo}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={saving || !sel || items.length === 0 || !anyChange}
                className="min-h-14 w-full rounded-3xl bg-emerald-500 px-4 text-base font-extrabold text-white shadow-md hover:bg-emerald-600 disabled:opacity-50"
              >
                {saving ? "Confirmando…" : "Confirmar recepción"}
              </button>
              <p className="text-center text-xs text-slate-500">
                Se generan movimientos <span className="font-mono">entrada_compra</span> solo por cantidades &gt; 0.
              </p>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}

