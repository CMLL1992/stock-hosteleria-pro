"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { fetchDashboardProductos, type DashboardProducto } from "@/lib/adminDashboardData";
import { digitsWaPhone, waUrlSendText } from "@/lib/whatsappPedido";

type ProveedorRow = { id: string; nombre: string; telefono_whatsapp: string | null };

type EventoLinea = {
  productoId: string;
  articulo: string;
  unidad: string | null;
  stockEvento: number;
  recibidoQty: number;
  recibidoPrecioEnvase: number;
  devueltoQty: number;
  devueltoPrecioEnvase: number;
};

type Evento = {
  id: string;
  establecimientoId: string;
  nombre: string;
  createdAt: string;
  proveedorId: string | null;
  notaExtra: string;
  lineas: EventoLinea[];
};

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function lsKey(establecimientoId: string) {
  return `ops_eventos_v1:${establecimientoId}`;
}

function safeInt(n: unknown): number {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function safeEUR(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
}

function formatEUR(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
}

function parseIntInput(raw: string): number {
  const s = String(raw ?? "").replace(/[^\d]/g, "");
  return safeInt(s);
}

function parseEurInput(raw: string): number {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  return safeEUR(s);
}

function loadEventos(establecimientoId: string): Evento[] {
  try {
    const raw = localStorage.getItem(lsKey(establecimientoId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as Evento[]).filter((e) => e && e.establecimientoId === establecimientoId);
  } catch {
    return [];
  }
}

function saveEventos(establecimientoId: string, eventos: Evento[]) {
  try {
    localStorage.setItem(lsKey(establecimientoId), JSON.stringify(eventos));
  } catch {
    // ignore (storage full / private mode)
  }
}

export default function EventosPage() {
  const { activeEstablishmentId, activeEstablishmentName } = useActiveEstablishment();
  const [role, setRole] = useState<AppRole | null>(null);
  const canAccess = hasPermission(getEffectiveRole({ role } as unknown as { role: AppRole | null }), "admin");

  const [loadingRole, setLoadingRole] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const [catalogo, setCatalogo] = useState<DashboardProducto[]>([]);
  const [catalogoSearch, setCatalogoSearch] = useState("");
  const [pickProductoId, setPickProductoId] = useState<string>("");

  const [eventos, setEventos] = useState<Evento[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => eventos.find((e) => e.id === selectedId) ?? null, [eventos, selectedId]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRole(true);
    fetchMyRole()
      .then((r) => {
        if (!cancelled) setRole(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(supabaseErrToString(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingRole(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeEstablishmentId) return;
    setEventos(loadEventos(activeEstablishmentId));
  }, [activeEstablishmentId]);

  useEffect(() => {
    if (!activeEstablishmentId) return;
    saveEventos(activeEstablishmentId, eventos);
  }, [activeEstablishmentId, eventos]);

  useEffect(() => {
    if (!activeEstablishmentId) return;
    if (!canAccess) return;
    let cancelled = false;
    setErr(null);
    Promise.all([
      supabase()
        .from("proveedores")
        .select("id,nombre,telefono_whatsapp")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("nombre", { ascending: true }),
      fetchDashboardProductos(activeEstablishmentId)
    ])
      .then(([provRes, prods]) => {
        if (cancelled) return;
        if (provRes.error) throw provRes.error;
        setProveedores((provRes.data as ProveedorRow[]) ?? []);
        setCatalogo(prods ?? []);
      })
      .catch((e) => {
        if (!cancelled) setErr(supabaseErrToString(e));
      });
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, canAccess]);

  function createEvento(nombre: string) {
    if (!activeEstablishmentId) return;
    const name = nombre.trim();
    if (!name) return;
    const ev: Evento = {
      id: newId("ev"),
      establecimientoId: activeEstablishmentId,
      nombre: name,
      createdAt: nowIso(),
      proveedorId: null,
      notaExtra: "",
      lineas: []
    };
    setEventos((prev) => [ev, ...prev]);
    setSelectedId(ev.id);
  }

  function updateEvento(eventoId: string, patch: Partial<Evento>) {
    setEventos((prev) => prev.map((e) => (e.id === eventoId ? { ...e, ...patch } : e)));
  }

  function removeEvento(eventoId: string) {
    setEventos((prev) => prev.filter((e) => e.id !== eventoId));
    setSelectedId((curr) => (curr === eventoId ? null : curr));
  }

  function ensureLinea(ev: Evento, p: DashboardProducto): EventoLinea {
    const existing = ev.lineas.find((l) => l.productoId === p.id);
    if (existing) return existing;
    const precioEnvaseAuto = Number.isFinite(Number(p.envase_coste)) ? Math.max(0, Number(p.envase_coste) || 0) : 0;
    return {
      productoId: p.id,
      articulo: p.articulo,
      unidad: p.unidad,
      stockEvento: 0,
      recibidoQty: 0,
      recibidoPrecioEnvase: precioEnvaseAuto,
      devueltoQty: 0,
      devueltoPrecioEnvase: precioEnvaseAuto
    };
  }

  function addProductoToEvento(ev: Evento, p: DashboardProducto) {
    const existing = ev.lineas.find((l) => l.productoId === p.id);
    const precioEnvaseAuto = Number.isFinite(Number(p.envase_coste)) ? Math.max(0, Number(p.envase_coste) || 0) : 0;
    if (existing) {
      // Si ya estaba añadido, solo autocompleta si siguen en 0 (no pisa cambios manuales).
      const shouldFillRec = (Number(existing.recibidoPrecioEnvase) || 0) <= 0;
      const shouldFillDev = (Number(existing.devueltoPrecioEnvase) || 0) <= 0;
      if (precioEnvaseAuto > 0 && (shouldFillRec || shouldFillDev)) {
        updateLinea(ev, p.id, {
          recibidoPrecioEnvase: shouldFillRec ? precioEnvaseAuto : existing.recibidoPrecioEnvase,
          devueltoPrecioEnvase: shouldFillDev ? precioEnvaseAuto : existing.devueltoPrecioEnvase
        });
      }
      return;
    }
    const linea = ensureLinea(ev, p);
    updateEvento(ev.id, { lineas: [...ev.lineas, linea] });
  }

  function updateLinea(ev: Evento, productoId: string, patch: Partial<EventoLinea>) {
    updateEvento(ev.id, {
      lineas: ev.lineas.map((l) => (l.productoId === productoId ? { ...l, ...patch } : l))
    });
  }

  function removeLinea(ev: Evento, productoId: string) {
    updateEvento(ev.id, { lineas: ev.lineas.filter((l) => l.productoId !== productoId) });
  }

  const filteredCatalogo = useMemo(() => {
    const q = catalogoSearch.trim().toLowerCase();
    if (!q) return catalogo;
    return catalogo.filter((p) => p.articulo.toLowerCase().includes(q));
  }, [catalogo, catalogoSearch]);

  const catalogoDropdown = useMemo(() => {
    const list = filteredCatalogo.slice();
    list.sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }));
    return list;
  }, [filteredCatalogo]);

  const proveedorSelected = useMemo(() => {
    if (!selected?.proveedorId) return null;
    return proveedores.find((p) => p.id === selected.proveedorId) ?? null;
  }, [proveedores, selected?.proveedorId]);

  function setPedidoDelta(ev: Evento, productoId: string, delta: number) {
    const curr = ev.lineas.find((l) => l.productoId === productoId);
    const next = Math.max(0, (Number(curr?.stockEvento) || 0) + delta);
    updateLinea(ev, productoId, { stockEvento: next });
  }

  function confirmarPedidoYEnviarWhatsApp(ev: Evento) {
    const url = waUrl;
    if (!url) return;
    // Lo pedido pasa a "Recibido" como stock inicial del evento (sin tocar stock real).
    setEventos((prev) =>
      prev.map((e) => {
        if (e.id !== ev.id) return e;
        return {
          ...e,
          lineas: e.lineas.map((l) => {
            const pedido = Math.max(0, Number(l.stockEvento) || 0);
            if (pedido <= 0) return l;
            // Si ya han editado recibido manualmente, no lo pisamos.
            if ((Number(l.recibidoQty) || 0) > 0) return l;
            return { ...l, recibidoQty: pedido };
          })
        };
      })
    );
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const resumen = useMemo(() => {
    const lineas = selected?.lineas ?? [];
    const vendido = lineas.reduce((acc, l) => acc + Math.max(0, (Number(l.recibidoQty) || 0) - (Number(l.devueltoQty) || 0)), 0);
    const costeMaterial = lineas.reduce((acc, l) => acc + (Number(l.recibidoQty) || 0) * (Number(l.recibidoPrecioEnvase) || 0), 0);
    const valorDevuelto = lineas.reduce((acc, l) => acc + (Number(l.devueltoQty) || 0) * (Number(l.devueltoPrecioEnvase) || 0), 0);
    const gastoReal = costeMaterial - valorDevuelto;
    return {
      vendido,
      costeMaterial,
      valorDevuelto,
      gastoReal
    };
  }, [selected?.lineas]);

  const waUrl = useMemo(() => {
    if (!selected) return null;
    const prov = proveedorSelected;
    const tel = digitsWaPhone(prov?.telefono_whatsapp);
    const nombreLocal = (activeEstablishmentName ?? "").trim() || "mi local";
    const lineas = selected.lineas
      .filter((l) => (Number(l.stockEvento) || 0) > 0)
      .map((l) => `- ${l.stockEvento} ${(l.unidad ?? "uds").trim() || "uds"} de ${l.articulo}`);
    if (!lineas.length && !selected.notaExtra.trim()) return null;
    const extra = selected.notaExtra.trim();
    const msg = [
      `*PEDIDO PARA EVENTO: ${selected.nombre.trim()}*`,
      `Local: ${nombreLocal}`,
      prov?.nombre ? `Proveedor: ${prov.nombre}` : "",
      "",
      lineas.length ? "*Material:*" : "",
      ...lineas,
      extra ? "" : "",
      extra ? "*Nota de material extra:*" : "",
      extra ? extra : ""
    ]
      .filter((x) => String(x).trim() !== "")
      .join("\n");
    return waUrlSendText(msg, tel);
  }, [activeEstablishmentName, proveedorSelected, selected]);

  if (loadingRole) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!activeEstablishmentId) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Eventos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            Selecciona un establecimiento para usar Eventos.
          </p>
        </main>
      </div>
    );
  }
  if (!canAccess) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Eventos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            Acceso denegado. (Solo Admin/Superadmin)
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Eventos" showBack backHref="/admin" />
      <main className="mx-auto w-full max-w-5xl p-4 pb-28">
        {err ? (
          <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <section className="space-y-3">
            <div className="premium-card premium-topline-blue">
              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Crear evento</p>
              <CreateEvento onCreate={createEvento} />
            </div>

            <div className="premium-card">
              <p className="text-sm font-black tracking-tight text-slate-900">Eventos</p>
              {eventos.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">Aún no hay eventos.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {eventos.map((e) => {
                    const active = e.id === selectedId;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(e.id)}
                          className={[
                            "w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition",
                            active
                              ? "border-premium-blue/40 bg-premium-blue/5 ring-2 ring-premium-blue/15"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          ].join(" ")}
                        >
                          <p className="truncate text-base font-black tracking-tight text-slate-900">{e.nombre}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{new Date(e.createdAt).toLocaleString("es-ES")}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="space-y-4">
            {!selected ? (
              <div className="premium-card">
                <p className="text-sm font-semibold text-slate-900">Selecciona un evento</p>
                <p className="mt-1 text-sm text-slate-600">Crea uno o toca un evento para gestionarlo.</p>
              </div>
            ) : (
              <>
                <div className="premium-card premium-topline-orange">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Evento</p>
                      <p className="mt-1 truncate text-2xl font-black tracking-tight text-slate-900">{selected.nombre}</p>
                    </div>
                    <button
                      type="button"
                      className="premium-btn-secondary"
                      onClick={() => removeEvento(selected.id)}
                    >
                      Eliminar evento
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Proveedor</label>
                      <select
                        className="premium-input"
                        value={selected.proveedorId ?? ""}
                        onChange={(e) => updateEvento(selected.id, { proveedorId: e.currentTarget.value || null })}
                      >
                        <option value="">(Selecciona proveedor)</option>
                        {proveedores.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Nota de material extra</label>
                      <textarea
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-premium-blue/20"
                        value={selected.notaExtra}
                        onChange={(e) => updateEvento(selected.id, { notaExtra: e.currentTarget.value })}
                        placeholder="Ej: Necesitamos 200 copas de balón y 4 cubos de hielo"
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className={[
                        "premium-btn-primary inline-flex w-full justify-center",
                        waUrl ? "" : "pointer-events-none opacity-50"
                      ].join(" ")}
                      onClick={() => confirmarPedidoYEnviarWhatsApp(selected)}
                    >
                      Enviar Pedido por WhatsApp
                    </button>
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    Importante: el “Stock de Evento” es temporal y no afecta al stock real.
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="premium-card">
                    <p className="text-sm font-black tracking-tight text-slate-900">Añadir producto</p>
                    <div className="mt-3 grid gap-2">
                      <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Producto (dropdown)</label>
                      <select
                        className="premium-input"
                        value={pickProductoId}
                        onChange={(e) => {
                          const id = e.currentTarget.value;
                          setPickProductoId(id);
                          const p = catalogo.find((x) => x.id === id);
                          if (!p) return;
                          addProductoToEvento(selected, p);
                          // Reset para poder añadir otro rápidamente
                          setPickProductoId("");
                        }}
                      >
                        <option value="">Selecciona un producto…</option>
                        {catalogoDropdown.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.articulo}
                            </option>
                          ))}
                      </select>
                      <input
                        className="premium-input"
                        value={catalogoSearch}
                        onChange={(e) => setCatalogoSearch(e.currentTarget.value)}
                        placeholder="Filtrar (opcional)…"
                        aria-label="Filtrar productos…"
                      />
                    </div>
                  </div>

                  <div className="premium-card">
                    <p className="text-sm font-black tracking-tight text-slate-900">Pedido del evento</p>
                    {selected.lineas.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-600">Selecciona productos arriba para empezar.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {selected.lineas.map((l) => (
                          <div key={l.productoId} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{l.articulo}</p>
                                <p className="mt-0.5 text-xs text-slate-500">Unidad: {(l.unidad ?? "uds").trim() || "uds"}</p>
                              </div>
                              <button type="button" className="text-xs font-semibold text-red-600" onClick={() => removeLinea(selected, l.productoId)}>
                                Quitar
                              </button>
                            </div>

                            <div className="mt-3 grid grid-cols-[1fr_170px] items-center gap-2">
                              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Pedir</div>
                              <div className="grid grid-cols-[44px_1fr_44px] items-center gap-2">
                                <button
                                  type="button"
                                  className="min-h-12 min-w-12 rounded-2xl border border-slate-200 bg-white text-2xl font-black leading-none text-slate-900 hover:bg-slate-50 disabled:opacity-40"
                                  onClick={() => setPedidoDelta(selected, l.productoId, -1)}
                                  disabled={(Number(l.stockEvento) || 0) <= 0}
                                  aria-label={`Restar 1 a pedido de ${l.articulo}`}
                                >
                                  −
                                </button>
                                <div className="min-h-12 w-full min-w-24 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-center text-xl font-bold tabular-nums text-slate-900 grid place-items-center">
                                  {Math.max(0, Number(l.stockEvento) || 0)}
                                </div>
                                <button
                                  type="button"
                                  className="min-h-12 min-w-12 rounded-2xl border border-slate-200 bg-white text-2xl font-black leading-none text-slate-900 hover:bg-slate-50"
                                  onClick={() => setPedidoDelta(selected, l.productoId, +1)}
                                  aria-label={`Sumar 1 a pedido de ${l.articulo}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="premium-card premium-topline-green">
                  <p className="text-sm font-black tracking-tight text-slate-900">Control financiero (fantasma)</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Recibido / Devuelto con precio de envase. Vendido/Consumido se calcula automáticamente.
                  </p>

                  {selected.lineas.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-600">Añade productos para registrar recibido/devuelto.</p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {selected.lineas.map((l) => {
                        const vendido = Math.max(0, l.recibidoQty - l.devueltoQty);
                        return (
                          <div key={l.productoId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-end justify-between gap-2">
                              <p className="min-w-0 truncate text-base font-black tracking-tight text-slate-900">{l.articulo}</p>
                              <p className="text-xs font-semibold text-slate-600">
                                Vendido/Consumido: <span className="font-black tabular-nums text-slate-900">{vendido}</span>
                              </p>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Recibido</p>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Cantidad</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-bold tabular-nums text-slate-900"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={String(l.recibidoQty)}
                                      onChange={(e) => updateLinea(selected, l.productoId, { recibidoQty: parseIntInput(e.currentTarget.value) })}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Precio envase (€)</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-bold tabular-nums text-slate-900"
                                      inputMode="decimal"
                                      value={String(l.recibidoPrecioEnvase || "")}
                                      onChange={(e) =>
                                        updateLinea(selected, l.productoId, { recibidoPrecioEnvase: parseEurInput(e.currentTarget.value) })
                                      }
                                      placeholder="0"
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Devuelto</p>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Cantidad</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-bold tabular-nums text-slate-900"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={String(l.devueltoQty)}
                                      onChange={(e) => updateLinea(selected, l.productoId, { devueltoQty: parseIntInput(e.currentTarget.value) })}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Precio envase (€)</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-bold tabular-nums text-slate-900"
                                      inputMode="decimal"
                                      value={String(l.devueltoPrecioEnvase || "")}
                                      onChange={(e) =>
                                        updateLinea(selected, l.productoId, { devueltoPrecioEnvase: parseEurInput(e.currentTarget.value) })
                                      }
                                      placeholder="0"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Coste total material</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.costeMaterial)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Valor envases devueltos</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.valorDevuelto)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ borderTopWidth: 4, borderTopColor: "#10B981" }}>
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Gasto real del evento</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">
                        {formatEUR(resumen.gastoReal)}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function CreateEvento({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="mt-3 grid gap-2">
      <input
        className="premium-input"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="Ej: Boda 27 Abril"
        aria-label="Nombre del evento"
      />
      <button
        type="button"
        className="premium-btn-primary"
        onClick={() => {
          onCreate(name);
          setName("");
        }}
      >
        Crear EVENTO
      </button>
    </div>
  );
}

