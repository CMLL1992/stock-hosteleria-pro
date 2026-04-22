"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "@/components/ui/Drawer";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { stockSemaforo } from "@/lib/stockSemaforo";
import { enqueueMovimiento, newClientUuid } from "@/lib/offlineQueue";
import { requireUserId } from "@/lib/session";
import { useProductosRealtime } from "@/lib/useProductosRealtime";
import {
  cantidadSugeridaPedido,
  waUrlPedidoCestaProveedor
} from "@/lib/whatsappPedido";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";

type Producto = {
  id: string;
  articulo: string;
  stock_actual: number;
  stock_vacios: number;
  stock_minimo: number | null;
  qr_code_uid: string;
  tipo: string | null;
  unidad: string | null;
  categoria: string | null;
  proveedor_id: string | null;
  proveedor: { nombre: string; telefono_whatsapp: string | null } | null;
};

async function fetchProductos(establecimientoId: string | null): Promise<Producto[]> {
  if (!establecimientoId) return [];
  const col = await resolveProductoTituloColumn(establecimientoId);
  const t = tituloColSql(col);
  const baseSelect = `id,${t},stock_actual,stock_vacios,stock_minimo,qr_code_uid`;
  const extendedSelect = `${baseSelect},proveedor_id,tipo,unidad,categoria,proveedor:proveedores(nombre,telefono_whatsapp)`;

  const tituloKey = t;
  const mapRow = (row: Record<string, unknown>): Producto => ({
    id: String(row.id ?? ""),
    articulo: String(row[tituloKey] ?? row.articulo ?? row.nombre ?? "").trim() || "—",
    stock_actual: Number(row.stock_actual ?? 0) || 0,
    stock_vacios: Number(row.stock_vacios ?? 0) || 0,
    stock_minimo: row.stock_minimo != null ? Number(row.stock_minimo) : null,
    qr_code_uid: String(row.qr_code_uid ?? ""),
    tipo: row.tipo != null ? String(row.tipo) : null,
    unidad: row.unidad != null ? String(row.unidad) : null,
    categoria: row.categoria != null ? String(row.categoria) : null,
    proveedor_id: row.proveedor_id != null ? String(row.proveedor_id) : null,
    proveedor: row.proveedor as Producto["proveedor"]
  });

  const { data, error } = await supabase()
    .from("productos")
    .select(extendedSelect as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });

  if (!error) {
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapRow);
  }

  const msg = (error as { message?: string }).message ?? "";
  const m = msg.toLowerCase();
  const looksLikeMissingColumn =
    (m.includes("column") &&
      (m.includes("tipo") ||
        m.includes("unidad") ||
        m.includes("categoria") ||
        m.includes("proveedor") ||
        m.includes("proveedor_id") ||
        m.includes("stock_vacios"))) ||
    m.includes("embed") ||
    m.includes("schema cache");

  if (!looksLikeMissingColumn) throw error;

  const midSelect = `${baseSelect},proveedor_id,tipo,unidad,categoria`;
  const fb1 = await supabase()
    .from("productos")
    .select(midSelect as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });
  if (!fb1.error) {
    return ((fb1.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      ...mapRow(row),
      proveedor: null
    }));
  }

  const fallback = await supabase()
    .from("productos")
    .select(baseSelect as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });
  if (fallback.error) throw fallback.error;
  return ((fallback.data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id ?? ""),
    articulo: String(row[tituloKey] ?? row.articulo ?? row.nombre ?? "").trim() || "—",
    stock_actual: Number(row.stock_actual ?? 0) || 0,
    stock_vacios: Number(row.stock_vacios ?? 0) || 0,
    stock_minimo: row.stock_minimo != null ? Number(row.stock_minimo) : null,
    qr_code_uid: String(row.qr_code_uid ?? ""),
    tipo: null,
    unidad: null,
    categoria: null,
    proveedor_id: null,
    proveedor: null
  }));
}

const TAB_ORDER = [
  { key: "todos", label: "Todos" },
  { key: "cerveza", label: "Cervezas" },
  { key: "licor", label: "Licores" },
  { key: "refresco", label: "Refrescos" },
  { key: "vino", label: "Vinos" },
  { key: "agua", label: "Aguas" },
  { key: "otros", label: "Otros" }
] as const;

function normalizeKey(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

function productTabKey(p: Producto): string {
  const c = normalizeKey(p.categoria);
  if (c) return c;
  const t = normalizeKey(p.tipo);
  return t || "otros";
}

function proveedorNombreOrDefault(p: Producto): string {
  return (p.proveedor?.nombre ?? "").trim() || "Sin proveedor";
}

const STOCK_INPUT_CLASS =
  "h-14 w-[5.5rem] shrink-0 rounded-2xl border-2 border-slate-800 bg-white px-2 text-center text-2xl font-black tabular-nums text-slate-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-slate-300";

type QuickMovimientoTipo = "entrada" | "salida_barra" | "devolucion_proveedor";

export function ProductList() {
  const searchParams = useSearchParams();
  const listaCompra = searchParams.get("compra") === "1";
  const modoVacios = searchParams.get("vacios") === "1";
  const queryClient = useQueryClient();
  const { me, activeEstablishmentId: establecimientoId, activeEstablishmentName } = useActiveEstablishment();
  const [tab, setTab] = useState<string>("todos");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stockErr, setStockErr] = useState<string | null>(null);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const [agruparPorProveedor, setAgruparPorProveedor] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [cestaOpen, setCestaOpen] = useState(false);

  const [movOpen, setMovOpen] = useState(false);
  const [movProd, setMovProd] = useState<Producto | null>(null);
  const [movTipo, setMovTipo] = useState<QuickMovimientoTipo>("entrada");
  const [movCantidad, setMovCantidad] = useState<number>(1);
  const [movBusy, setMovBusy] = useState(false);
  const qtyRef = useRef<HTMLInputElement | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["productos", establecimientoId],
    queryFn: () => fetchProductos(establecimientoId),
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchInterval: false
  });

  useProductosRealtime({
    establecimientoId,
    queryClient,
    queryKeys: [
      ["productos", establecimientoId],
      ["dashboard", "productos", establecimientoId]
    ]
  });

  useEffect(() => {
    if (!data?.length) return;
    setStockDraft((prev) => {
      const next = { ...prev };
      for (const p of data) {
        if (next[p.id] === undefined) next[p.id] = String(Math.max(0, Math.trunc(p.stock_actual)));
      }
      return next;
    });
  }, [data]);

  const filteredByTab = useMemo(() => {
    if (!data) return [];
    if (tab === "todos") return data;
    return data.filter((p) => productTabKey(p) === tab);
  }, [data, tab]);

  const filtered = useMemo(() => {
    if (!listaCompra) return filteredByTab;
    return filteredByTab.filter((p) => {
      const minimo = typeof p.stock_minimo === "number" && Number.isFinite(p.stock_minimo) ? p.stock_minimo : 0;
      return p.stock_actual <= minimo;
    });
  }, [filteredByTab, listaCompra]);

  const filteredForMode = useMemo(() => {
    if (!modoVacios) return filtered;
    return filtered.filter((p) => (Number(p.stock_vacios ?? 0) || 0) > 0);
  }, [filtered, modoVacios]);

  const orderedList = useMemo(() => {
    const list = [...filteredForMode];
    if (!agruparPorProveedor) return list;
    return list.sort((a, b) => {
      const pa = proveedorNombreOrDefault(a).toLowerCase();
      const pb = proveedorNombreOrDefault(b).toLowerCase();
      if (pa !== pb) return pa.localeCompare(pb);
      return a.articulo.localeCompare(b.articulo);
    });
  }, [filteredForMode, agruparPorProveedor]);

  const estNombre = activeEstablishmentName?.trim() || "mi establecimiento";

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const selectedProductos = useMemo(() => {
    if (!data) return [];
    return data.filter((p) => selectedIds.has(p.id));
  }, [data, selectedIds]);

  const cestaPorProveedor = useMemo(() => {
    const map = new Map<
      string,
      { nombre: string; telefono: string | null; items: Producto[] }
    >();
    for (const p of selectedProductos) {
      const key = proveedorNombreOrDefault(p);
      const tel = p.proveedor?.telefono_whatsapp ?? null;
      let g = map.get(key);
      if (!g) {
        g = { nombre: key, telefono: tel, items: [] };
        map.set(key, g);
      }
      g.items.push(p);
      if (tel) g.telefono = tel;
    }
    return Array.from(map.values());
  }, [selectedProductos]);

  const setStockFromInput = async (p: Producto, raw: string) => {
    if (!establecimientoId) return;
    const n = Math.max(0, Math.trunc(Number(String(raw).replace(",", "."))));
    setBusyId(p.id);
    setStockErr(null);
    try {
      const { error: upErr } = await supabase()
        .from("productos")
        .update({ stock_actual: n })
        .eq("id", p.id)
        .eq("establecimiento_id", establecimientoId);
      if (upErr) throw upErr;
      setStockDraft((d) => ({ ...d, [p.id]: String(n) }));
      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
    } catch (e) {
      setStockErr(e instanceof Error ? e.message : String(e));
      setStockDraft((d) => ({ ...d, [p.id]: String(p.stock_actual) }));
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (!movOpen) return;
    const t = window.setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 60);
    return () => window.clearTimeout(t);
  }, [movOpen]);

  const openQuickMovimiento = (p: Producto, tipo: QuickMovimientoTipo) => {
    setMovProd(p);
    setMovTipo(tipo);
    setMovCantidad(1);
    setMovOpen(true);
  };

  async function commitQuickMovimiento() {
    if (!establecimientoId || !movProd) return;
    const n = Math.max(0, Math.trunc(Number(movCantidad)));
    if (!Number.isFinite(n) || n <= 0) return;
    setMovBusy(true);
    setStockErr(null);
    try {
      const usuario_id = await requireUserId();
      const payload: {
        client_uuid: string;
        producto_id: string;
        establecimiento_id: string;
        tipo: QuickMovimientoTipo;
        cantidad: number;
        usuario_id: string;
        timestamp: string;
        genera_vacio?: boolean;
      } = {
        client_uuid: newClientUuid(),
        producto_id: movProd.id,
        establecimiento_id: establecimientoId,
        tipo: movTipo,
        cantidad: n,
        usuario_id,
        timestamp: new Date().toISOString()
      };
      if (movTipo === "salida_barra") payload.genera_vacio = true;

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { error } = await supabase()
          .from("movimientos")
          .upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        await enqueueMovimiento(payload);
      }

      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
      setMovOpen(false);
      setMovProd(null);
    } catch (e) {
      setStockErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMovBusy(false);
    }
  }

  if (me?.role === null && !me?.profileReady) return <p className="text-sm text-slate-600">Cargando perfil…</p>;
  if (isLoading) return <p className="text-sm text-slate-600">Cargando stock…</p>;
  if (error) {
    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        {(error as Error).message}
      </p>
    );
  }

  if (!data?.length) {
    return <p className="text-sm text-slate-600">No hay productos todavía.</p>;
  }

  return (
    <div className="space-y-4 pb-32">
      {modoVacios ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
          Vista: <span className="font-semibold text-slate-900">Vacíos</span>. Solo se muestran productos con vacíos &gt; 0.
          <Link href="/stock" className="ml-2 font-semibold text-slate-900 underline">
            Ver todo
          </Link>
        </div>
      ) : null}
      {listaCompra ? (
        <div className="flex flex-col gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base font-bold text-amber-950">Lista de compra: solo productos bajo mínimos</p>
          <Link
            href="/stock"
            className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-2xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-950 shadow-sm"
          >
            Ver inventario completo
          </Link>
        </div>
      ) : null}

      {stockErr ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{stockErr}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAgruparPorProveedor((v) => !v)}
          className={[
            "min-h-12 rounded-full border px-4 text-sm font-semibold",
            agruparPorProveedor
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-slate-200 bg-white text-slate-800"
          ].join(" ")}
        >
          {agruparPorProveedor ? "✓ Agrupar por proveedor" : "Agrupar por proveedor"}
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TAB_ORDER.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                "min-h-12 whitespace-nowrap rounded-full border px-4 text-base font-semibold",
                active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {orderedList.map((p, idx) => {
          const minimo = typeof p.stock_minimo === "number" && Number.isFinite(p.stock_minimo) ? p.stock_minimo : 0;
          const sem = stockSemaforo(p.stock_actual, minimo);
          const stockPill =
            sem === "sin"
              ? { bg: "#FEF2F2", text: "#991B1B", ring: "ring-1 ring-red-100", label: "Agotado" }
              : sem === "bajo"
                ? { bg: "#FFF7ED", text: "#9A3412", ring: "ring-1 ring-orange-100", label: "Bajo mín." }
                : { bg: "#ECFDF5", text: "#065F46", ring: "ring-1 ring-emerald-100", label: "OK" };

          const key = productTabKey(p);
          const busy = busyId === p.id;
          const provLabel = proveedorNombreOrDefault(p);
          const prev = idx > 0 ? orderedList[idx - 1] : null;
          const showProvHeader = agruparPorProveedor && (!prev || proveedorNombreOrDefault(prev) !== provLabel);

          return (
            <div key={p.id}>
              {showProvHeader ? (
                <p className="mb-1 pl-1 text-xs font-bold uppercase tracking-wide text-indigo-700">{provLabel}</p>
              ) : null}

              <div
                className={[
                  "w-full max-w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-sm",
                  sem === "sin" ? "border-l-4 border-l-red-500" : sem === "bajo" ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-emerald-500"
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  <label className="mt-1 flex shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="h-6 w-6 rounded border-slate-300 text-slate-900"
                      aria-label={`Seleccionar ${p.articulo}`}
                    />
                  </label>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/p/${encodeURIComponent(p.id)}`} className="min-w-0">
                        <p className="text-lg font-bold leading-snug text-slate-900">{p.articulo}</p>
                      </Link>
                      <span
                        className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700"
                      >
                        {key === "todos" ? "otros" : key}
                      </span>
                      <span
                        className={["inline-flex min-h-8 items-center rounded-full px-2 text-xs font-semibold", stockPill.ring].join(" ")}
                        style={{ backgroundColor: stockPill.bg, color: stockPill.text }}
                      >
                        {stockPill.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {p.unidad ?? "—"} · {provLabel}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <span className="text-[10px] font-bold uppercase text-slate-500">Stock</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      disabled={busy}
                      className={STOCK_INPUT_CLASS}
                      value={stockDraft[p.id] ?? String(p.stock_actual)}
                      onChange={(e) => setStockDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      onBlur={(e) => {
                        void setStockFromInput(p, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 pl-9">
                  <button
                    type="button"
                    onClick={() => openQuickMovimiento(p, "entrada")}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    Entrada
                  </button>
                  <button
                    type="button"
                    onClick={() => openQuickMovimiento(p, "salida_barra")}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    A barra
                  </button>
                  <button
                    type="button"
                    onClick={() => openQuickMovimiento(p, "devolucion_proveedor")}
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    Devolver
                  </button>
                  <Link
                    href={`/qr/${encodeURIComponent(p.id)}`}
                    className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm"
                  >
                    QR
                  </Link>
                  {me?.isAdmin ? (
                    <Link
                      href={`/admin/productos/${encodeURIComponent(p.id)}/editar`}
                      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm"
                    >
                      Editar
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredForMode.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-base text-slate-600">
          {modoVacios
            ? "No hay envases vacíos pendientes en esta categoría."
            : listaCompra
              ? "No hay productos bajo el mínimo en esta categoría."
              : "No hay productos en esta categoría."}
        </p>
      ) : null}

      {selectedIds.size > 0 ? (
        <button
          type="button"
          className="fixed bottom-24 right-4 z-30 flex min-h-[52px] items-center gap-2 rounded-full border-2 border-slate-900 bg-slate-900 px-5 py-3 text-base font-bold text-white shadow-xl"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          onClick={() => setCestaOpen(true)}
        >
          Pedido ({selectedIds.size})
        </button>
      ) : null}

      <Drawer open={cestaOpen} title="Resumen del pedido" onClose={() => setCestaOpen(false)}>
        <div className="space-y-6 pb-4">
          <p className="text-sm text-slate-600">
            {estNombre} · {selectedProductos.length} artículo{selectedProductos.length === 1 ? "" : "s"}
          </p>
          {cestaPorProveedor.map((grupo) => {
            const lineas = grupo.items.map((p) => {
              const min = typeof p.stock_minimo === "number" ? p.stock_minimo : 0;
              const cant = cantidadSugeridaPedido(p.stock_actual, min);
              return {
                articulo: p.articulo,
                cantidad: cant,
                unidad: p.unidad
              };
            });
            const url = waUrlPedidoCestaProveedor({
              nombreProveedor: grupo.nombre === "Sin proveedor" ? "Proveedor" : grupo.nombre,
              telefonoWhatsapp: grupo.telefono,
              nombreEstablecimiento: estNombre,
              lineas
            });
            return (
              <section key={grupo.nombre} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-bold text-slate-900">{grupo.nombre}</h3>
                <ul className="mt-2 list-inside list-disc text-sm text-slate-700">
                  {lineas.map((l, i) => (
                    <li key={i}>
                      {l.cantidad} {(l.unidad ?? "uds").toString()} de {l.articulo}
                    </li>
                  ))}
                </ul>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-600"
                >
                  <IconWhatsApp className="h-6 w-6 shrink-0 text-white" />
                  Enviar pedido a {grupo.nombre === "Sin proveedor" ? "WhatsApp" : grupo.nombre}
                </a>
              </section>
            );
          })}
        </div>
      </Drawer>

      <Drawer
        open={movOpen}
        title={movProd ? `Movimiento · ${movProd.articulo}` : "Movimiento"}
        onClose={() => {
          if (movBusy) return;
          setMovOpen(false);
          setMovProd(null);
        }}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className={[
                "min-h-12 rounded-2xl border px-3 text-sm font-semibold",
                movTipo === "entrada" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"
              ].join(" ")}
              onClick={() => setMovTipo("entrada")}
              disabled={movBusy}
            >
              Entrada
            </button>
            <button
              type="button"
              className={[
                "min-h-12 rounded-2xl border px-3 text-sm font-semibold",
                movTipo === "salida_barra" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"
              ].join(" ")}
              onClick={() => setMovTipo("salida_barra")}
              disabled={movBusy}
            >
              A barra
            </button>
            <button
              type="button"
              className={[
                "min-h-12 rounded-2xl border px-3 text-sm font-semibold",
                movTipo === "devolucion_proveedor" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800"
              ].join(" ")}
              onClick={() => setMovTipo("devolucion_proveedor")}
              disabled={movBusy}
            >
              Devolver
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-900">Cantidad</label>
            <input
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base"
              inputMode="numeric"
              type="number"
              min={1}
              step={1}
              value={movCantidad}
              onChange={(e) => setMovCantidad(Number(e.currentTarget.value))}
              onFocus={(e) => e.currentTarget.select()}
              ref={qtyRef}
              disabled={movBusy}
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => {
                void commitQuickMovimiento();
              }}
              disabled={movBusy || !movProd || !establecimientoId}
              className="min-h-12 w-full rounded-2xl bg-black px-4 text-sm font-semibold text-white hover:bg-slate-900 active:bg-slate-950 disabled:opacity-50"
            >
              {movBusy ? "Guardando…" : "Confirmar"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (movBusy) return;
                setMovOpen(false);
                setMovProd(null);
              }}
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
