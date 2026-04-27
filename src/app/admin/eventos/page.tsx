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
  /** Precio unitario del producto para el evento (por defecto: precio_compra si existe). */
  precioProducto: number;
  /** Precio del envase asociado (por defecto: envase_coste). */
  precioEnvase: number;
  /** Devolución de producto (con envase lleno). */
  devueltoProductoQty: number;
  /** Devolución de envases vacíos (solo abono envase). */
  devueltoVaciosQty: number;
  // Backward-compat (v1): no se usan para cálculo nuevo, pero los conservamos por si hay datos guardados.
  recibidoPrecioEnvase?: number;
  devueltoQty?: number;
  devueltoPrecioEnvase?: number;
};

type Evento = {
  id: string;
  establecimientoId: string;
  nombre: string;
  createdAt: string;
  proveedorId: string | null;
  notaExtra: string;
  lineas: EventoLinea[];
  extras?: Array<{ id: string; concepto: string; tipo: "gasto" | "ingreso"; importe: number }>;
  recaudacionTotal?: number;
  pedidosHist?: Array<{
    id: string;
    createdAt: string;
    proveedorId: string | null;
    proveedorNombre: string;
    notaExtra: string;
    lineas: Array<{ productoId: string; articulo: string; unidad: string | null; cantidad: number }>;
  }>;
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
  const [precioCompraById, setPrecioCompraById] = useState<Map<string, number>>(new Map());
  const [proveedorIdByProductoId, setProveedorIdByProductoId] = useState<Map<string, string | null>>(new Map());
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
      .then(async ([provRes, prods]) => {
        if (cancelled) return;
        if (provRes.error) throw provRes.error;
        setProveedores((provRes.data as ProveedorRow[]) ?? []);
        setCatalogo(prods ?? []);

        // Precio producto / proveedor (si existe en DB): read-only (no afecta stock).
        try {
          const pRes = await supabase()
            .from("productos")
            .select("id,precio_compra,proveedor_id")
            .eq("establecimiento_id", activeEstablishmentId)
            .limit(3000);
          if (cancelled) return;
          if (pRes.error) throw pRes.error;
          const map = new Map<string, number>();
          const provMap = new Map<string, string | null>();
          for (const r of (pRes.data as Array<{ id: string; precio_compra: number | null; proveedor_id: string | null }> | null) ?? []) {
            const id = String(r?.id ?? "").trim();
            const v = typeof r?.precio_compra === "number" && Number.isFinite(r.precio_compra) ? r.precio_compra : 0;
            if (id) map.set(id, Math.max(0, Math.round(v * 100) / 100));
            if (id) provMap.set(id, r?.proveedor_id ? String(r.proveedor_id) : null);
          }
          setPrecioCompraById(map);
          setProveedorIdByProductoId(provMap);
        } catch {
          setPrecioCompraById(new Map());
          setProveedorIdByProductoId(new Map());
        }
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
    const precioProductoAuto = Math.max(0, Number(precioCompraById.get(p.id) ?? 0) || 0);
    return {
      productoId: p.id,
      articulo: p.articulo,
      unidad: p.unidad,
      stockEvento: 0,
      recibidoQty: 0,
      precioProducto: precioProductoAuto,
      precioEnvase: precioEnvaseAuto,
      devueltoProductoQty: 0,
      devueltoVaciosQty: 0
    };
  }

  function addProductoToEvento(ev: Evento, p: DashboardProducto) {
    const existing = ev.lineas.find((l) => l.productoId === p.id);
    const precioEnvaseAuto = Number.isFinite(Number(p.envase_coste)) ? Math.max(0, Number(p.envase_coste) || 0) : 0;
    if (existing) {
      // Si ya estaba añadido, solo autocompleta si siguen en 0 (no pisa cambios manuales).
      const shouldFillEnv = (Number((existing as EventoLinea).precioEnvase) || 0) <= 0;
      if (precioEnvaseAuto > 0 && shouldFillEnv) {
        updateLinea(ev, p.id, {
          precioEnvase: precioEnvaseAuto
        });
      }
      const precioProdAuto = Math.max(0, Number(precioCompraById.get(p.id) ?? 0) || 0);
      const shouldFillProd = (Number((existing as EventoLinea).precioProducto) || 0) <= 0;
      if (precioProdAuto > 0 && shouldFillProd) updateLinea(ev, p.id, { precioProducto: precioProdAuto });
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
    const proveedorId = selected?.proveedorId ?? null;
    const proveedorNombre = (proveedores.find((p) => p.id === proveedorId)?.nombre ?? "").trim();
    const base = proveedorId
      ? filteredCatalogo.filter((p) => {
          const byId = String(proveedorIdByProductoId.get(p.id) ?? "") === String(proveedorId);
          // Fallback (seguridad): si el mapa de proveedor_id falla, usamos el nombre del proveedor embebido.
          const byName = !!proveedorNombre && String(p.proveedor?.nombre ?? "").trim() === proveedorNombre;
          // Si no tenemos ni id ni nombre, no filtramos por nombre.
          return byId || byName;
        })
      : filteredCatalogo;
    const list = base.slice();
    list.sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }));
    return list;
  }, [filteredCatalogo, proveedorIdByProductoId, proveedores, selected?.proveedorId]);

  const proveedorSelected = useMemo(() => {
    if (!selected?.proveedorId) return null;
    return proveedores.find((p) => p.id === selected.proveedorId) ?? null;
  }, [proveedores, selected?.proveedorId]);

  function confirmarPedidoYEnviarWhatsApp(ev: Evento) {
    const url = waUrl;
    if (!url) return;
    // Lo pedido pasa a "Recibido" como stock inicial del evento (sin tocar stock real).
    setEventos((prev) =>
      prev.map((e) => {
        if (e.id !== ev.id) return e;
        const prov = proveedores.find((p) => p.id === e.proveedorId) ?? null;
        const provNombre = prov?.nombre?.trim() || "Proveedor";
        const pedidoLineas = e.lineas
          .map((l) => ({
            productoId: l.productoId,
            articulo: l.articulo,
            unidad: l.unidad,
            cantidad: Math.max(0, Number(l.stockEvento) || 0)
          }))
          .filter((l) => l.cantidad > 0);
        const hist = [
          {
            id: newId("pedido"),
            createdAt: nowIso(),
            proveedorId: e.proveedorId ?? null,
            proveedorNombre: provNombre,
            notaExtra: String(e.notaExtra ?? ""),
            lineas: pedidoLineas
          },
          ...((e.pedidosHist ?? []) as NonNullable<Evento["pedidosHist"]>)
        ].slice(0, 20);
        return {
          ...e,
          pedidosHist: hist,
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

  function lineaPrecioProducto(l: EventoLinea): number {
    return Math.max(0, Number((l as EventoLinea).precioProducto ?? 0) || 0);
  }

  function lineaPrecioEnvase(l: EventoLinea): number {
    const v =
      Number((l as EventoLinea).precioEnvase ?? 0) ||
      Number(l.recibidoPrecioEnvase ?? 0) ||
      Number(l.devueltoPrecioEnvase ?? 0) ||
      0;
    return Math.max(0, v);
  }

  const resumen = useMemo(() => {
    const lineas = selected?.lineas ?? [];
    const totalPedido = lineas.reduce((acc, l) => {
      const q = Math.max(0, Number(l.stockEvento) || 0);
      const unit = lineaPrecioProducto(l) + lineaPrecioEnvase(l);
      return acc + q * unit;
    }, 0);
    const totalDevProducto = lineas.reduce((acc, l) => {
      const q = Math.max(0, Number((l as EventoLinea).devueltoProductoQty ?? l.devueltoQty ?? 0) || 0);
      const unit = lineaPrecioProducto(l) + lineaPrecioEnvase(l);
      return acc + q * unit;
    }, 0);
    const totalDevVacios = lineas.reduce((acc, l) => {
      const q = Math.max(0, Number((l as EventoLinea).devueltoVaciosQty ?? 0) || 0);
      const unit = lineaPrecioEnvase(l);
      return acc + q * unit;
    }, 0);
    const totalDevoluciones = totalDevProducto + totalDevVacios;

    const extras = selected?.extras ?? [];
    const extrasGasto = extras.reduce((acc, x) => (x.tipo === "gasto" ? acc + (Number(x.importe) || 0) : acc), 0);
    const extrasIngreso = extras.reduce((acc, x) => (x.tipo === "ingreso" ? acc + (Number(x.importe) || 0) : acc), 0);
    const gastoReal = totalPedido - totalDevoluciones + extrasGasto - extrasIngreso;

    const recaudacionTotal = Math.max(0, Number(selected?.recaudacionTotal ?? 0) || 0);
    const beneficioNeto = recaudacionTotal - gastoReal;
    return {
      totalPedido,
      totalDevProducto,
      totalDevVacios,
      totalDevoluciones,
      extrasGasto,
      extrasIngreso,
      gastoReal,
      recaudacionTotal,
      beneficioNeto
    };
  }, [selected?.extras, selected?.lineas, selected?.recaudacionTotal]);

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
                        className="premium-input w-full"
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
                  <div className="premium-card max-w-full overflow-hidden">
                    <p className="text-sm font-black tracking-tight text-slate-900">Añadir producto</p>
                    <div className="mt-3 grid gap-2">
                      <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Producto (dropdown)</label>
                      <select
                        className="premium-input w-full"
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
                          disabled={!selected.proveedorId}
                      >
                          <option value="">
                            {selected.proveedorId ? "Selecciona un producto…" : "Selecciona proveedor para ver productos…"}
                          </option>
                        {selected.proveedorId && catalogoDropdown.length === 0 ? (
                          <option value="" disabled>
                            No hay productos para este proveedor
                          </option>
                        ) : null}
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

                  <div className="premium-card max-w-full overflow-hidden">
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

                              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_170px] sm:items-center">
                              <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Pedir</div>
                                <input
                                  type="number"
                                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-bold tabular-nums text-slate-900 shadow-sm"
                                  inputMode="numeric"
                                  min={0}
                                  step={1}
                                  value={String(Math.max(0, Number(l.stockEvento) || 0))}
                                  onChange={(e) => updateLinea(selected, l.productoId, { stockEvento: parseIntInput(e.currentTarget.value) })}
                                  aria-label={`Cantidad a pedir de ${l.articulo}`}
                                />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                  {(selected.pedidosHist ?? []).length ? (
                    <div className="premium-card">
                      <p className="text-sm font-black tracking-tight text-slate-900">Historial de pedidos del evento</p>
                      <div className="mt-3 space-y-2">
                        {(selected.pedidosHist ?? []).slice(0, 10).map((p) => (
                          <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{p.proveedorNombre}</p>
                                <p className="mt-0.5 text-xs text-slate-500">{new Date(p.createdAt).toLocaleString("es-ES")}</p>
                              </div>
                              <p className="text-xs font-semibold text-slate-600">
                                Líneas: <span className="font-black tabular-nums text-slate-900">{p.lineas.length}</span>
                              </p>
                            </div>
                            <ul className="mt-3 space-y-1 text-sm text-slate-800">
                              {p.lineas.map((l) => (
                                <li key={l.productoId} className="flex items-baseline justify-between gap-3">
                                  <span className="min-w-0 flex-1 truncate">{l.articulo}</span>
                                  <span className="shrink-0 font-black tabular-nums">{l.cantidad}</span>
                                </li>
                              ))}
                            </ul>
                            {p.notaExtra.trim() ? (
                              <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                                <span className="font-bold">Nota:</span> {p.notaExtra}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                <div className="premium-card premium-topline-green">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-sm font-black tracking-tight text-slate-900">Control financiero</p>
                    <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                      Datos independientes: Estos registros no afectan al stock ni a las estadísticas generales de la app.
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Pedido inicial (producto + envase) · Devoluciones (producto+envase y vacíos) · Extras · Balance final.
                  </p>

                  {selected.lineas.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-600">Añade productos para registrar recibido/devuelto.</p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {selected.lineas.map((l) => {
                        const devProd = Math.max(0, Number((l as EventoLinea).devueltoProductoQty ?? l.devueltoQty ?? 0) || 0);
                        const devVac = Math.max(0, Number((l as EventoLinea).devueltoVaciosQty ?? 0) || 0);
                        const vendido = Math.max(0, (Number(l.recibidoQty) || 0) - devProd);
                        const precioProd = lineaPrecioProducto(l);
                        const precioEnv = lineaPrecioEnvase(l);
                        const unitFull = precioProd + precioEnv;
                        const abonoProd = devProd * unitFull;
                        const abonoVac = devVac * precioEnv;
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
                                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Pedido inicial</p>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Cantidad pedida (= recibida)</label>
                                    <div className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-black tabular-nums text-slate-900 grid place-items-center">
                                      {Math.max(0, Number(l.stockEvento) || 0)}
                                    </div>
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Precio producto (€)</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-bold tabular-nums text-slate-900"
                                      inputMode="decimal"
                                      value={String((l as EventoLinea).precioProducto || "")}
                                      onChange={(e) =>
                                        updateLinea(selected, l.productoId, { precioProducto: parseEurInput(e.currentTarget.value) })
                                      }
                                      placeholder="0"
                                    />
                                  </div>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Precio envase lleno (€)</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-bold tabular-nums text-slate-900"
                                      inputMode="decimal"
                                      value={String((l as EventoLinea).precioEnvase || "")}
                                      onChange={(e) => updateLinea(selected, l.productoId, { precioEnvase: parseEurInput(e.currentTarget.value) })}
                                      placeholder="0"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Subtotal pedido</label>
                                    <div className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-black tabular-nums text-slate-900 grid place-items-center">
                                      {formatEUR(Math.max(0, Number(l.stockEvento) || 0) * unitFull)}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Devoluciones</p>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Producto devuelto (lleno)</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-bold tabular-nums text-slate-900"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={String(devProd)}
                                      onChange={(e) =>
                                        updateLinea(selected, l.productoId, { devueltoProductoQty: parseIntInput(e.currentTarget.value) })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Abono producto+envase</label>
                                    <div className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-black tabular-nums text-slate-900 grid place-items-center">
                                      {formatEUR(abonoProd)}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Envases vacíos devueltos</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-bold tabular-nums text-slate-900"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={String(devVac)}
                                      onChange={(e) =>
                                        updateLinea(selected, l.productoId, { devueltoVaciosQty: parseIntInput(e.currentTarget.value) })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Abono vacíos (solo envase)</label>
                                    <div className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-black tabular-nums text-slate-900 grid place-items-center">
                                      {formatEUR(abonoVac)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Total pedido</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.totalPedido)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Total devoluciones</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.totalDevoluciones)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ borderTopWidth: 4, borderTopColor: "#10B981" }}>
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Gasto real del evento</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">
                        {formatEUR(resumen.gastoReal)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ borderTopWidth: 4, borderTopColor: "#1D4ED8" }}>
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Beneficio / balance final</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.beneficioNeto)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-black tracking-tight text-slate-900">Gastos e ingresos extra</p>
                        <button
                          type="button"
                          className="premium-btn-secondary"
                          onClick={() => {
                            const id = newId("extra");
                            const next = [...(selected.extras ?? [])];
                            next.unshift({ id, concepto: "", tipo: "gasto", importe: 0 });
                            updateEvento(selected.id, { extras: next });
                          }}
                        >
                          + Añadir Gasto/Ingreso Extra
                        </button>
                      </div>

                      {(selected.extras ?? []).length === 0 ? (
                        <p className="mt-2 text-sm text-slate-600">Sin extras.</p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {(selected.extras ?? []).map((x) => (
                            <div key={x.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[120px_1fr_140px_40px]">
                              <select
                                className="premium-input"
                                value={x.tipo}
                                onChange={(e) => {
                                  const tipo = (e.currentTarget.value as "gasto" | "ingreso") ?? "gasto";
                                  updateEvento(selected.id, {
                                    extras: (selected.extras ?? []).map((it) => (it.id === x.id ? { ...it, tipo } : it))
                                  });
                                }}
                              >
                                <option value="gasto">Gasto</option>
                                <option value="ingreso">Ingreso</option>
                              </select>
                              <input
                                className="premium-input"
                                value={x.concepto}
                                onChange={(e) => {
                                  const concepto = e.currentTarget.value;
                                  updateEvento(selected.id, {
                                    extras: (selected.extras ?? []).map((it) => (it.id === x.id ? { ...it, concepto } : it))
                                  });
                                }}
                                placeholder="Concepto…"
                              />
                              <input
                                className="premium-input text-center tabular-nums"
                                inputMode="decimal"
                                value={String(x.importe || "")}
                                onChange={(e) => {
                                  const importe = parseEurInput(e.currentTarget.value);
                                  updateEvento(selected.id, {
                                    extras: (selected.extras ?? []).map((it) => (it.id === x.id ? { ...it, importe } : it))
                                  });
                                }}
                                placeholder="€"
                              />
                              <button
                                type="button"
                                className="min-h-12 rounded-2xl border border-slate-200 bg-white text-sm font-black text-red-600 hover:bg-slate-50"
                                onClick={() =>
                                  updateEvento(selected.id, { extras: (selected.extras ?? []).filter((it) => it.id !== x.id) })
                                }
                                aria-label="Eliminar extra"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Extras (gastos)</p>
                          <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{formatEUR(resumen.extrasGasto)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Extras (ingresos)</p>
                          <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{formatEUR(resumen.extrasIngreso)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-black tracking-tight text-slate-900">Recaudación total</p>
                      <p className="mt-1 text-sm text-slate-600">Introduce la recaudación final del evento para calcular el beneficio neto.</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 sm:items-end">
                        <div>
                          <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Recaudación (€)</label>
                          <input
                            className="premium-input mt-2 text-center text-xl font-bold tabular-nums"
                            inputMode="decimal"
                            value={String(selected.recaudacionTotal || "")}
                            onChange={(e) => updateEvento(selected.id, { recaudacionTotal: parseEurInput(e.currentTarget.value) })}
                            placeholder="0"
                          />
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Beneficio neto</p>
                          <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.beneficioNeto)}</p>
                        </div>
                      </div>
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
  const canCreate = name.trim().length > 0;
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
        className={[
          "transition-colors",
          canCreate ? "premium-btn-primary" : "min-h-12 rounded-2xl bg-slate-200 px-4 text-sm font-extrabold text-slate-600 opacity-70 cursor-not-allowed"
        ].join(" ")}
        onClick={() => {
          if (!canCreate) return;
          onCreate(name);
          setName("");
        }}
        disabled={!canCreate}
      >
        Crear EVENTO
      </button>
    </div>
  );
}

