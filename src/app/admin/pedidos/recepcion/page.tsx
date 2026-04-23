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
import { requireUserId } from "@/lib/session";

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

type LegacyPedidoRow = {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  created_at: string;
};

type LegacyPedidoItem = {
  producto_id: string;
  articulo: string;
  unidad: string | null;
  cantidad_pedida: number;
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
  const [loading, setLoading] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [legacy, setLegacy] = useState<LegacyPedidoRow[]>([]);

  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<PedidoRow | null>(null);
  const [items, setItems] = useState<PedidoItemRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [legacyOpen, setLegacyOpen] = useState(false);
  const [legacySel, setLegacySel] = useState<LegacyPedidoRow | null>(null);
  const [legacyItems, setLegacyItems] = useState<LegacyPedidoItem[]>([]);
  const [legacyDraft, setLegacyDraft] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!activeEstablishmentId) {
      setPedidos([]);
      setLegacy([]);
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

      // Fallback: pedidos antiguos registrados solo como movimientos tipo 'pedido'
      // (sin cabecera/items). Los mostramos como "legacy" para poder recepcionar manualmente.
      try {
        // Marcadores de cierre: último pedido "recibido" por proveedor.
        const closedMap = new Map<string, string>();
        try {
          const closed = await supabase()
            .from("pedidos")
            .select("proveedor_id,received_at,created_at,estado")
            .eq("establecimiento_id", activeEstablishmentId)
            .eq("estado", "recibido")
            .order("received_at", { ascending: false })
            .limit(500);
          if (!closed.error) {
            for (const r of ((closed.data ?? []) as unknown as Record<string, unknown>[])) {
              const pid = String(r.proveedor_id ?? "").trim();
              if (!pid) continue;
              const ts = String(r.received_at ?? r.created_at ?? "").trim();
              if (!ts) continue;
              if (!closedMap.has(pid)) closedMap.set(pid, ts);
            }
          }
        } catch {
          // ignore
        }

        const mv = await supabase()
          .from("movimientos")
          .select("proveedor_id,producto_id,cantidad,timestamp,productos:productos(articulo,nombre,unidad),proveedor:proveedores(nombre)")
          .eq("establecimiento_id", activeEstablishmentId)
          .eq("tipo", "pedido")
          .order("timestamp", { ascending: false })
          .limit(500);
        if (!mv.error) {
          const list = (mv.data ?? []) as unknown as Record<string, unknown>[];
          const byProv = new Map<
            string,
            {
              proveedor_nombre: string;
              created_at: string;
              items: Map<string, LegacyPedidoItem>;
            }
          >();
          for (const r of list) {
            const proveedor_id = String(r.proveedor_id ?? "").trim();
            if (!proveedor_id) continue;
            const ts = String(r.timestamp ?? new Date().toISOString());
            const provRaw = r.proveedor as { nombre?: unknown } | { nombre?: unknown }[] | null | undefined;
            const prov = Array.isArray(provRaw) ? provRaw[0] ?? null : provRaw;
            const proveedor_nombre = String(prov?.nombre ?? "Proveedor").trim() || "Proveedor";

            const prodRaw = r.productos as
              | { articulo?: unknown; nombre?: unknown; unidad?: unknown }
              | { articulo?: unknown; nombre?: unknown; unidad?: unknown }[]
              | null
              | undefined;
            const prod = Array.isArray(prodRaw) ? prodRaw[0] ?? null : prodRaw;
            const producto_id = String(r.producto_id ?? "").trim();
            if (!producto_id) continue;
            const articulo = String(prod?.articulo ?? prod?.nombre ?? "—").trim() || "—";
            const unidad = prod?.unidad != null ? String(prod.unidad) : null;
            const cantidad = Math.max(0, toInt(r.cantidad));

            let g = byProv.get(proveedor_id);
            if (!g) {
              g = { proveedor_nombre, created_at: ts, items: new Map() };
              byProv.set(proveedor_id, g);
            }
            // Mantenemos el último timestamp como "fecha del pedido"
            if (ts > g.created_at) g.created_at = ts;
            const prev = g.items.get(producto_id);
            if (prev) {
              g.items.set(producto_id, { ...prev, cantidad_pedida: prev.cantidad_pedida + cantidad });
            } else {
              g.items.set(producto_id, { producto_id, articulo, unidad, cantidad_pedida: cantidad });
            }
          }
          const legacyRows: LegacyPedidoRow[] = Array.from(byProv.entries())
            .filter(([proveedor_id, g]) => {
              const closedAt = closedMap.get(proveedor_id);
              if (!closedAt) return true;
              // Si ya hay un "recibido" posterior al último pedido legacy, lo consideramos limpio.
              return g.created_at > closedAt;
            })
            .map(([proveedor_id, g]) => ({
              id: `legacy:${proveedor_id}`,
              proveedor_id,
              proveedor_nombre: g.proveedor_nombre,
              created_at: g.created_at
            }));
          legacyRows.sort((a, b) => b.created_at.localeCompare(a.created_at));
          setLegacy(legacyRows);
        }
      } catch {
        setLegacy([]);
      }
    } catch (e) {
      setErr(supabaseErrToString(e));
      setPedidos([]);
      setLegacy([]);
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

  async function openLegacyPedido(p: LegacyPedidoRow) {
    if (!activeEstablishmentId) return;
    setErr(null);
    setLegacySel(p);
    setLegacyOpen(true);
    setLegacyItems([]);
    setLegacyDraft({});
    try {
      const mv = await supabase()
        .from("movimientos")
        .select("proveedor_id,producto_id,cantidad,timestamp,productos:productos(articulo,nombre,unidad)")
        .eq("establecimiento_id", activeEstablishmentId)
        .eq("tipo", "pedido")
        .eq("proveedor_id", p.proveedor_id)
        .order("timestamp", { ascending: false })
        .limit(500);
      if (mv.error) throw mv.error;
      const list = (mv.data ?? []) as unknown as Record<string, unknown>[];
      const byProd = new Map<string, LegacyPedidoItem>();
      for (const r of list) {
        const producto_id = String(r.producto_id ?? "").trim();
        if (!producto_id) continue;
        const prodRaw = r.productos as
          | { articulo?: unknown; nombre?: unknown; unidad?: unknown }
          | { articulo?: unknown; nombre?: unknown; unidad?: unknown }[]
          | null
          | undefined;
        const prod = Array.isArray(prodRaw) ? prodRaw[0] ?? null : prodRaw;
        const articulo = String(prod?.articulo ?? prod?.nombre ?? "—").trim() || "—";
        const unidad = prod?.unidad != null ? String(prod.unidad) : null;
        const cantidad = Math.max(0, toInt(r.cantidad));
        const prev = byProd.get(producto_id);
        if (prev) byProd.set(producto_id, { ...prev, cantidad_pedida: prev.cantidad_pedida + cantidad });
        else byProd.set(producto_id, { producto_id, articulo, unidad, cantidad_pedida: cantidad });
      }
      const rows = Array.from(byProd.values()).sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }));
      setLegacyItems(rows);
      setLegacyDraft((prev) => {
        const next = { ...prev };
        for (const it of rows) next[it.producto_id] = String(it.cantidad_pedida);
        return next;
      });
    } catch (e) {
      setErr(supabaseErrToString(e));
    }
  }

  const legacyAnyQty = useMemo(() => {
    for (const it of legacyItems) {
      const n = Math.max(0, toInt(legacyDraft[it.producto_id] ?? ""));
      if (n > 0) return true;
    }
    return false;
  }, [legacyDraft, legacyItems]);

  async function confirmarLegacy() {
    if (!activeEstablishmentId || !legacySel) return;
    setErr(null);
    setSaving(true);
    try {
      const payload = legacyItems
        .map((it) => ({ producto_id: it.producto_id, recibido: Math.max(0, toInt(legacyDraft[it.producto_id] ?? "")) }))
        .filter((x) => x.recibido > 0);

      // Usa el RPC existente de recepción por proveedor (sin depender de pedidos/pedido_items).
      const { data, error } = await supabase().rpc("confirm_recepcion", {
        p_proveedor_id: legacySel.proveedor_id,
        p_items: payload
      });
      if (error) throw error;
      const ok = ((data ?? null) as { ok?: boolean } | null)?.ok ?? true;
      if (!ok) throw new Error("No se pudo confirmar la recepción.");

      // Cierre: crear un "pedido" recibido para marcarlo como limpio (sin items).
      try {
        const uid = await requireUserId();
        await supabase().from("pedidos").insert({
          establecimiento_id: activeEstablishmentId,
          proveedor_id: legacySel.proveedor_id,
          creado_por: uid,
          estado: "recibido",
          received_at: new Date().toISOString()
        } as unknown as Record<string, unknown>);
      } catch {
        // ignore
      }

      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", activeEstablishmentId] });
      await refresh();
      setLegacyOpen(false);
      setLegacySel(null);
      setLegacyItems([]);
      setLegacyDraft({});
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

        {err ? <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}

        {!activeEstablishmentId ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            Selecciona un establecimiento.
          </p>
        ) : pedidos.length === 0 && legacy.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            No hay pedidos pendientes.
          </p>
        ) : (
          <div className="space-y-4">
            {pedidos.length > 0 ? (
              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Pedidos (seguimiento)</p>
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
            ) : null}

            {legacy.length > 0 ? (
              <section className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">Pedidos antiguos (legacy)</p>
                <p className="text-sm text-slate-600">
                  Detectados desde movimientos tipo <span className="font-mono">pedido</span>. Puedes recepcionar manualmente.
                </p>
                <ul className="space-y-2">
                  {legacy.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left shadow-sm hover:bg-slate-100"
                        onClick={() => void openLegacyPedido(p)}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">{p.proveedor_nombre}</p>
                          <p className="text-xs text-slate-600">Sin líneas en `pedido_items`.</p>
                        </div>
                        <span className="text-xs font-semibold text-slate-600">Recepcionar</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
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

      <Drawer
        open={legacyOpen}
        title={legacySel ? `Recepción manual · ${legacySel.proveedor_nombre}` : "Recepción manual"}
        onClose={() => {
          if (saving) return;
          setLegacyOpen(false);
          setLegacySel(null);
          setLegacyItems([]);
          setLegacyDraft({});
        }}
      >
        <div className="space-y-3 pb-4">
          {legacyItems.length === 0 ? (
            <p className="text-sm text-slate-600">No hay líneas legacy detectadas.</p>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_96px] gap-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
                <span>Producto</span>
                <span className="text-center">Recibido</span>
              </div>
              <ul className="flex flex-col gap-2">
                {legacyItems.map((it) => (
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
                        value={legacyDraft[it.producto_id] ?? ""}
                        onChange={(e) =>
                          setLegacyDraft((prev) => ({ ...prev, [it.producto_id]: digitsOnly(e.currentTarget.value) }))
                        }
                        disabled={saving}
                        aria-label={`Cantidad recibida para ${it.articulo}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => void confirmarLegacy()}
                disabled={saving || !legacySel || legacyItems.length === 0 || !legacyAnyQty}
                className="min-h-14 w-full rounded-3xl bg-emerald-500 px-4 text-base font-extrabold text-white shadow-md hover:bg-emerald-600 disabled:opacity-50"
              >
                {saving ? "Confirmando…" : "Confirmar recepción (manual)"}
              </button>
              <p className="text-center text-xs text-slate-500">
                Se generan movimientos <span className="font-mono">entrada_compra</span> por las cantidades indicadas.
              </p>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}

