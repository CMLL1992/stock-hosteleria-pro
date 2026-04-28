"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { stockSemaforo } from "@/lib/stockSemaforo";
import { enqueueMovimiento, newClientUuid } from "@/lib/offlineQueue";
import { requireUserId } from "@/lib/session";
import { useProductosRealtime } from "@/lib/useProductosRealtime";
// (Pedido por WhatsApp eliminado: la pantalla queda como catálogo + acciones superiores)
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { logActivity } from "@/lib/activityLog";
import { getEffectiveRole } from "@/lib/permissions";

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
  unidades_por_caja?: number | null;
  proveedor_id: string | null;
  proveedor: { nombre: string; telefono_whatsapp: string | null } | null;
};

async function fetchProductos(establecimientoId: string | null): Promise<Producto[]> {
  if (!establecimientoId) return [];
  const col = await resolveProductoTituloColumn(establecimientoId);
  const t = tituloColSql(col);
  const baseSelect = `id,${t},stock_actual,stock_vacios,stock_minimo,qr_code_uid`;
  const extendedSelect = `${baseSelect},unidades_por_caja,proveedor_id,tipo,unidad,categoria,proveedor:proveedores(nombre,telefono_whatsapp)`;

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
    unidades_por_caja: row.unidades_por_caja != null ? Number(row.unidades_por_caja) : null,
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
        m.includes("unidades_por_caja") ||
        m.includes("proveedor") ||
        m.includes("proveedor_id") ||
        m.includes("stock_vacios"))) ||
    m.includes("embed") ||
    m.includes("schema cache");

  if (!looksLikeMissingColumn) throw error;

  const midSelect = `${baseSelect},unidades_por_caja,proveedor_id,tipo,unidad,categoria`;
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
    unidades_por_caja: null,
    proveedor_id: null,
    proveedor: null
  }));
}

const TAB_ORDER = [
  { key: "todos", label: "Todos" },
  { key: "cerveza", label: "Cervezas" },
  { key: "licor", label: "Licores" },
  { key: "comida", label: "Comida" },
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

function equivCajasTexto(stock: number, udsCaja: number | null | undefined): string | null {
  const u = Math.max(1, Math.trunc(Number(udsCaja ?? 1) || 1));
  if (u <= 1) return null;
  const total = Math.max(0, Math.trunc(Number(stock) || 0));
  const cajas = Math.floor(total / u);
  const uds = total % u;
  if (cajas <= 0) return null;
  if (uds === 0) return `${cajas} cajas`;
  return `${cajas} cajas + ${uds} uds`;
}

const STOCK_READONLY_CLASS =
  "grid h-14 w-[5.5rem] shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white px-2 text-center text-2xl font-black tabular-nums text-slate-900";

type QuickMovimientoTipo = "entrada_compra" | "salida_barra";

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const maybeMsg = (e as { message?: unknown }).message;
    if (typeof maybeMsg === "string" && maybeMsg.trim()) return maybeMsg;
    try {
      const s = JSON.stringify(e);
      if (s && s !== "{}") return s;
    } catch {
      // ignore
    }
  }
  return "No se pudo completar la acción. Revisa la conexión y vuelve a intentarlo.";
}

export function ProductList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const listaCompra = searchParams.get("compra") === "1";
  const modoVacios = searchParams.get("vacios") === "1";
  const deepLinkId = (searchParams.get("id") ?? "").trim();
  const fromScan = (searchParams.get("scan") ?? "") === "1" || (searchParams.get("scan") ?? "") === "true";
  const returnTo = (searchParams.get("return") ?? "").trim();
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  const queryClient = useQueryClient();
  const { me, activeEstablishmentId: establecimientoId, activeEstablishmentName } = useActiveEstablishment();
  void getEffectiveRole;
  const [tab, setTab] = useState<string>("todos");
  // UI: esta pantalla ya no permite editar stock directamente.
  const [search, setSearch] = useState<string>("");
  const [agruparPorProveedor, setAgruparPorProveedor] = useState(false);

  // Recargar neveras (salida multiproducto + devolución de vacíos al almacén)
  const [recargaOpen, setRecargaOpen] = useState(false);
  const [recargaSearch, setRecargaSearch] = useState("");
  const [recargaQty, setRecargaQty] = useState<Record<string, string>>({});
  const [recargaVacios, setRecargaVacios] = useState<Record<string, string>>({});
  const [recargaBusy, setRecargaBusy] = useState(false);
  const [recargaErr, setRecargaErr] = useState<string | null>(null);

  // Modificar stock (ajuste centralizado, multiproducto)
  const [modOpen, setModOpen] = useState(false);
  const [modSearch, setModSearch] = useState("");
  const [modPickedIds, setModPickedIds] = useState<Set<string>>(() => new Set());
  const [modQty, setModQty] = useState<Record<string, string>>({});
  const [modTipo, setModTipo] = useState<QuickMovimientoTipo>("entrada_compra");
  const [modBusy, setModBusy] = useState(false);
  const [modErr, setModErr] = useState<string | null>(null);
  const [modSubmitAttempted, setModSubmitAttempted] = useState(false);

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

  // Stock: solo lectura en esta lista (se mueve con Recargar Neveras / Pedidos).

  // Deep link: /stock?id=<producto_id>&scan=1 abre automáticamente "GESTIONAR" del producto.
  useEffect(() => {
    if (!data?.length) return;
    if (!deepLinkId) return;
    if (deepLinkDone) return;
    const p = data.find((x) => x.id === deepLinkId);
    if (!p) return;
    setDeepLinkDone(true);
    if (fromScan) {
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
      } catch {
        // ignore
      }
    }
    openGestionar(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, deepLinkDone, deepLinkId, fromScan]);

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

  const filteredBySearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredForMode;
    return filteredForMode.filter((p) => p.articulo.toLowerCase().includes(q));
  }, [filteredForMode, search]);

  // Eliminado: devolución de envases vacíos manual (ahora se captura dentro de "RECARGAR NEVERAS").

  const orderedList = useMemo(() => {
    const list = [...filteredBySearch];
    if (!agruparPorProveedor) return list;
    return list.sort((a, b) => {
      const pa = proveedorNombreOrDefault(a).toLowerCase();
      const pb = proveedorNombreOrDefault(b).toLowerCase();
      if (pa !== pb) return pa.localeCompare(pb);
      return a.articulo.localeCompare(b.articulo);
    });
  }, [filteredBySearch, agruparPorProveedor]);

  void activeEstablishmentName;

  const recargaPicked = useMemo(() => {
    const list = (data ?? []).filter((p) => {
      const q = Math.max(0, Math.trunc(Number(recargaQty[p.id] ?? "0") || 0));
      const v = Math.max(0, Math.trunc(Number(recargaVacios[p.id] ?? "0") || 0));
      return q > 0 || v > 0;
    });
    return list.slice().sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }));
  }, [data, recargaQty, recargaVacios]);

  const modPicked = useMemo(() => {
    const list = (data ?? []).filter((p) => modPickedIds.has(p.id));
    return list.slice().sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }));
  }, [data, modPickedIds]);

  function openRecarga() {
    setRecargaErr(null);
    setRecargaSearch("");
    setRecargaQty({});
    setRecargaVacios({});
    setRecargaOpen(true);
  }

  function openModificarStock(opts?: { preselect?: Producto | null }) {
    setModErr(null);
    setModSearch("");
    setModPickedIds(new Set());
    setModQty({});
    setModTipo("entrada_compra");
    setModSubmitAttempted(false);
    if (opts?.preselect) {
      const p = opts.preselect;
      setModPickedIds(new Set([p.id]));
      setModQty({ [p.id]: "1" });
    }
    setModOpen(true);
  }

  function addToMod(p: Producto) {
    setModPickedIds((prev) => {
      const n = new Set(prev);
      n.add(p.id);
      return n;
    });
    setModQty((prev) => ({ ...prev, [p.id]: prev[p.id] ?? "1" }));
  }

  function removeFromMod(id: string) {
    setModPickedIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  }

  function sanitizeIntString(raw: string): string {
    const cleaned = String(raw ?? "").replace(/[^\d]/g, "");
    return cleaned === "" ? "" : String(Math.max(0, Math.trunc(Number(cleaned) || 0)));
  }

  function familyLabel(p: { categoria: string | null; tipo: string | null }): string {
    const fam = (p.categoria ?? p.tipo ?? "Otros").toString().trim();
    return fam || "Otros";
  }

  const recargaFamilies = useMemo(() => {
    const q = recargaSearch.trim().toLowerCase();
    const list = (data ?? [])
      .filter((p) => {
        if (!q) return true;
        return (p.articulo ?? "").toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => {
        const fa = familyLabel(a).toLowerCase();
        const fb = familyLabel(b).toLowerCase();
        if (fa !== fb) return fa.localeCompare(fb, "es", { sensitivity: "base" });
        return a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" });
      });

    const map = new Map<string, Producto[]>();
    for (const p of list) {
      const fam = familyLabel(p);
      map.set(fam, [...(map.get(fam) ?? []), p]);
    }

    const families = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "es", { sensitivity: "base" }));
    return families;
  }, [data, recargaSearch]);

  function recargaQtyNum(id: string): number {
    return Math.max(0, Math.trunc(Number(recargaQty[id] ?? "0") || 0));
  }
  function recargaVaciosNum(id: string): number {
    return Math.max(0, Math.trunc(Number(recargaVacios[id] ?? "0") || 0));
  }

  function setRecargaQtyDelta(id: string, delta: number) {
    setRecargaQty((prev) => {
      const curr = Math.max(0, Math.trunc(Number(prev[id] ?? "0") || 0));
      const next = Math.max(0, curr + delta);
      return { ...prev, [id]: String(next) };
    });
  }
  function setRecargaVaciosDelta(id: string, delta: number) {
    setRecargaVacios((prev) => {
      const curr = Math.max(0, Math.trunc(Number(prev[id] ?? "0") || 0));
      const next = Math.max(0, curr + delta);
      return { ...prev, [id]: String(next) };
    });
  }

  async function commitRecargaNeveras() {
    if (!establecimientoId) return;
    if (!recargaPicked.length) return;
    setRecargaBusy(true);
    setRecargaErr(null);
    try {
      const usuario_id = await requireUserId();
      const nowIso = new Date().toISOString();

      const salidas = recargaPicked
        .map((p) => ({ p, n: Math.max(0, Math.trunc(Number(recargaQty[p.id] ?? "0") || 0)) }))
        .filter((x) => x.n > 0);
      const vaciosSubidos = recargaPicked
        .map((p) => ({ p, v: Math.max(0, Math.trunc(Number(recargaVacios[p.id] ?? "0") || 0)) }))
        .filter((x) => x.v > 0);
      if (salidas.length === 0 && vaciosSubidos.length === 0) {
        setRecargaErr("Indica una cantidad > 0 en “Cargar a Nevera” o “Subir Vacíos”.");
        return;
      }

      const movimientos: Array<Record<string, unknown>> = [];
      let totalNevera = 0;
      let totalVacios = 0;
      for (const { p, n } of salidas) {
        totalNevera += n;
        movimientos.push({
          client_uuid: newClientUuid(),
          producto_id: p.id,
          establecimiento_id: establecimientoId,
          tipo: "salida_barra",
          cantidad: n,
          usuario_id,
          timestamp: nowIso
        });
      }
      for (const { p, v } of vaciosSubidos) {
        totalVacios += v;
        movimientos.push({
          client_uuid: newClientUuid(),
          producto_id: p.id,
          establecimiento_id: establecimientoId,
          tipo: "devolucion_envase",
          cantidad: v,
          usuario_id,
          timestamp: nowIso
        });
      }

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { error } = await supabase().from("movimientos").upsert(movimientos, { onConflict: "client_uuid", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        // Offline: encolamos uno a uno para mantener compatibilidad con la cola existente.
        for (const m of movimientos) {
          await enqueueMovimiento(m as Parameters<typeof enqueueMovimiento>[0]);
        }
      }

      // Optimistic: ajustamos stock_actual y stock_vacios en caché
      const applyOptimistic = (prev: Producto[]) =>
        prev.map((x) => {
          const s = salidas.find((t) => t.p.id === x.id);
          const vv = vaciosSubidos.find((t) => t.p.id === x.id);
          if (!s && !vv) return x;
          const nextStock = s ? Math.max(0, Math.trunc(Number(x.stock_actual ?? 0) || 0) - s.n) : Math.max(0, Math.trunc(Number(x.stock_actual ?? 0) || 0));
          const nextVacios = vv
            ? Math.max(0, Math.trunc(Number(x.stock_vacios ?? 0) || 0) + vv.v)
            : Math.max(0, Math.trunc(Number(x.stock_vacios ?? 0) || 0));
          return { ...x, stock_actual: nextStock, stock_vacios: nextVacios };
        });

      queryClient.setQueryData(["productos", establecimientoId], (old) => applyOptimistic((old as Producto[] | undefined) ?? []));
      queryClient.setQueryData(["dashboard", "productos", establecimientoId], (old) => applyOptimistic((old as Producto[] | undefined) ?? []));
      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", establecimientoId] });

      await logActivity({
        establecimientoId,
        icon: "envases",
        message: `ha movido mercancía entre barra y almacén (nevera: -${totalNevera}, vacíos: +${totalVacios}).`,
        actorName: me?.email ?? null,
        metadata: {
          nevera: salidas.map((s) => ({ producto_id: s.p.id, cantidad: s.n })),
          vacios: vaciosSubidos.map((x) => ({ producto_id: x.p.id, cantidad: x.v }))
        }
      });

      setRecargaOpen(false);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setRecargaErr(errMsg(e));
    } finally {
      setRecargaBusy(false);
    }
  }

  const modTipoLabel = modTipo === "entrada_compra" ? "Entrada (Pedido/Inventario)" : "Salida (Merma/Ajuste)";

  async function commitModificarStock() {
    if (!establecimientoId) return;
    if (!modPicked.length) return;
    setModBusy(true);
    setModErr(null);
    setModSubmitAttempted(true);
    try {
      const usuario_id = await requireUserId();
      const nowIso = new Date().toISOString();
      const cambios = modPicked.map((p) => ({ p, n: Math.max(0, Math.trunc(Number(modQty[p.id] ?? "0") || 0)) }));
      const invalidos = cambios.filter((x) => x.n <= 0);
      const efectivos = cambios.filter((x) => x.n > 0);
      if (!efectivos.length) {
        setModErr("Indica al menos una cantidad > 0.");
        return;
      }
      if (invalidos.length) {
        setModErr("Revisa las cantidades marcadas en rojo (deben ser > 0).");
        return;
      }

      const movimientos = efectivos.map(({ p, n }) => ({
        client_uuid: newClientUuid(),
        producto_id: p.id,
        establecimiento_id: establecimientoId,
        tipo: modTipo,
        cantidad: n,
        usuario_id,
        timestamp: nowIso
      }));

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { error } = await supabase().from("movimientos").upsert(movimientos, { onConflict: "client_uuid", ignoreDuplicates: true });
        if (error) {
          // eslint-disable-next-line no-console
          console.error("Error completo de Supabase:", error);
          throw error;
        }
      } else {
        for (const m of movimientos) {
          await enqueueMovimiento(m as Parameters<typeof enqueueMovimiento>[0]);
        }
      }

      const applyOptimistic = (prev: Producto[]) =>
        prev.map((x) => {
          const c = efectivos.find((t) => t.p.id === x.id);
          if (!c) return x;
          const delta = modTipo === "entrada_compra" ? c.n : modTipo === "salida_barra" ? -c.n : 0;
          const nextStock = Math.max(0, Math.trunc(Number(x.stock_actual ?? 0) || 0) + delta);
          return { ...x, stock_actual: nextStock };
        });

      queryClient.setQueryData(["productos", establecimientoId], (old) => applyOptimistic((old as Producto[] | undefined) ?? []));
      queryClient.setQueryData(["dashboard", "productos", establecimientoId], (old) => applyOptimistic((old as Producto[] | undefined) ?? []));
      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", establecimientoId] });

      await logActivity({
        establecimientoId,
        icon: "stock",
        message: `ha modificado stock (${modTipoLabel}).`,
        actorName: me?.email ?? null,
        metadata: { tipo: modTipo, productos: efectivos.map((c) => ({ producto_id: c.p.id, cantidad: c.n })) }
      });

      setModOpen(false);
      if (returnTo) router.replace(returnTo);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setModErr(errMsg(e));
    } finally {
      setModBusy(false);
    }
  }

  // (bloqueado) Edición directa de stock desde la lista.
  const openGestionar = (p: Producto) => openModificarStock({ preselect: p });

  if (me?.role === null && !me?.profileReady) return <p className="text-sm text-slate-600">Cargando perfil…</p>;
  if (!establecimientoId) {
    return (
      <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        No hay establecimiento activo. Revisa tu perfil/rol o selecciona un establecimiento (superadmin) para cargar el catálogo.
      </p>
    );
  }
  if (isLoading) return <p className="text-sm text-slate-600">Cargando stock…</p>;
  if (error) {
    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        {errMsg(error)}
      </p>
    );
  }

  if (!data?.length) {
    return <p className="text-sm text-slate-600">No hay productos todavía.</p>;
  }

  return (
    <div className="space-y-4 pb-32">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => openRecarga()}
            className="min-h-12 w-full rounded-3xl bg-premium-blue px-5 text-sm font-extrabold uppercase tracking-wide text-white shadow-sm shadow-blue-900/10 hover:brightness-95 sm:w-auto"
          >
            BARRA ⇄ ALMACÉN
          </button>
          <button
            type="button"
            onClick={() => openModificarStock()}
            className="min-h-12 w-full rounded-3xl border border-slate-200 bg-white px-5 text-sm font-extrabold uppercase tracking-wide text-slate-900 shadow-sm hover:bg-slate-50 sm:w-auto"
          >
            MODIFICAR STOCK
          </button>
        </div>
      </div>
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

      <div className="relative w-full">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Buscar producto…"
          className="min-h-12 w-full rounded-3xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          aria-label="Buscar producto…"
        />
      </div>

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
                ? { bg: "#FFF7ED", text: "#9A3412", ring: "ring-1 ring-orange-100", label: "Bajo mínimos" }
                : { bg: "#ECFDF5", text: "#065F46", ring: "ring-1 ring-emerald-100", label: "OK" };

          const key = productTabKey(p);
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
                  "border-t-4",
                  sem === "sin"
                    ? "border-t-premium-orange"
                    : sem === "bajo"
                      ? "border-t-premium-orange"
                      : "border-t-premium-green"
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/p/${encodeURIComponent(p.id)}`} className="min-w-0">
                        <p className="text-lg font-black leading-snug text-slate-900">{p.articulo}</p>
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
                    {equivCajasTexto(p.stock_actual, p.unidades_por_caja) ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Equivale a{" "}
                        <span className="font-semibold text-slate-700">{equivCajasTexto(p.stock_actual, p.unidades_por_caja)}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <span className="text-[10px] font-bold uppercase text-slate-500">Stock</span>
                    <div aria-label={`Stock de ${p.articulo}`} className={STOCK_READONLY_CLASS}>
                      {String(Math.max(0, Math.trunc(Number(p.stock_actual) || 0)))}
                    </div>
                  </div>
                </div>

                {null}
              </div>
            </div>
          );
        })}
      </div>

      {filteredBySearch.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-base text-slate-600">
          {modoVacios
            ? "No hay envases vacíos pendientes en esta categoría."
            : listaCompra
              ? "No hay productos bajo el mínimo en esta categoría."
              : "No hay productos en esta categoría."}
        </p>
      ) : null}

      <Drawer
        open={recargaOpen}
        title="Recargar neveras"
        onClose={() => {
          if (recargaBusy) return;
          setRecargaOpen(false);
          setRecargaErr(null);
        }}
      >
        <div className="space-y-4 pb-2">
          {recargaErr ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{recargaErr}</p>
          ) : null}

          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Buscar producto… (filtra familias)"
            value={recargaSearch}
            onChange={(e) => setRecargaSearch(e.currentTarget.value)}
          />

          <div className="space-y-3">
            {recargaFamilies.map(([fam, items]) => {
              const open = !!recargaSearch.trim();
              return (
                <details key={fam} open={open} className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <summary className="cursor-pointer list-none rounded-3xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-extrabold uppercase tracking-wide text-slate-900">{fam}</p>
                      <p className="text-xs font-semibold text-slate-500">{items.length}</p>
                    </div>
                  </summary>
                  <div className="border-t border-slate-200 bg-white px-3 py-2">
                    <div className="space-y-2">
                      {items.map((p) => {
                        const q = recargaQtyNum(p.id);
                        const v = recargaVaciosNum(p.id);
                        return (
                          <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">{p.articulo}</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Stock: {Math.max(0, Math.trunc(Number(p.stock_actual) || 0))} · Vacíos:{" "}
                                  {Math.max(0, Math.trunc(Number(p.stock_vacios) || 0))}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={recargaBusy || (q === 0 && v === 0)}
                                onClick={() => {
                                  setRecargaQty((prev) => ({ ...prev, [p.id]: "0" }));
                                  setRecargaVacios((prev) => ({ ...prev, [p.id]: "0" }));
                                }}
                                className="min-h-10 shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                                aria-label={`Reset ${p.articulo}`}
                              >
                                Reset
                              </button>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl bg-slate-50 p-4">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">📥 Cargar a Nevera</p>
                                  <ArrowDown className="h-4 w-4 text-premium-blue" aria-hidden />
                                </div>
                                <div className="mt-2 grid grid-cols-[44px_1fr_44px] items-center gap-2">
                                  <button
                                    type="button"
                                    className="min-h-11 rounded-2xl border border-slate-200 bg-white text-xl font-black text-slate-900 hover:bg-slate-50 disabled:opacity-40"
                                    disabled={recargaBusy || q <= 0}
                                    onClick={() => setRecargaQtyDelta(p.id, -1)}
                                    aria-label={`Restar 1 a neveras (${p.articulo})`}
                                  >
                                    −
                                  </button>
                                  <input
                                    className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-black tabular-nums text-slate-900"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={String(q)}
                                    onChange={(e) => setRecargaQty((d) => ({ ...d, [p.id]: sanitizeIntString(e.currentTarget.value) }))}
                                    disabled={recargaBusy}
                                    aria-label={`Cantidad a neveras de ${p.articulo}`}
                                  />
                                  <button
                                    type="button"
                                    className="min-h-11 rounded-2xl border border-slate-200 bg-white text-xl font-black text-slate-900 hover:bg-slate-50 disabled:opacity-40"
                                    disabled={recargaBusy}
                                    onClick={() => setRecargaQtyDelta(p.id, +1)}
                                    aria-label={`Sumar 1 a neveras (${p.articulo})`}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              <div className="rounded-2xl bg-slate-50 p-4">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">📤 Subir Vacíos</p>
                                  <ArrowUp className="h-4 w-4 text-premium-green" aria-hidden />
                                </div>
                                <div className="mt-2 grid grid-cols-[44px_1fr_44px] items-center gap-2">
                                  <button
                                    type="button"
                                    className="min-h-11 rounded-2xl border border-slate-200 bg-white text-xl font-black text-slate-900 hover:bg-slate-50 disabled:opacity-40"
                                    disabled={recargaBusy || v <= 0}
                                    onClick={() => setRecargaVaciosDelta(p.id, -1)}
                                    aria-label={`Restar 1 vacío (${p.articulo})`}
                                  >
                                    −
                                  </button>
                                  <input
                                    className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-black tabular-nums text-slate-900"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={String(v)}
                                    onChange={(e) => setRecargaVacios((d) => ({ ...d, [p.id]: sanitizeIntString(e.currentTarget.value) }))}
                                    disabled={recargaBusy}
                                    aria-label={`Vacíos al almacén de ${p.articulo}`}
                                  />
                                  <button
                                    type="button"
                                    className="min-h-11 rounded-2xl border border-slate-200 bg-white text-xl font-black text-slate-900 hover:bg-slate-50 disabled:opacity-40"
                                    disabled={recargaBusy}
                                    onClick={() => setRecargaVaciosDelta(p.id, +1)}
                                    aria-label={`Sumar 1 vacío (${p.articulo})`}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
              );
            })}

            {!recargaFamilies.length ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No hay productos que coincidan.</p>
            ) : null}
          </div>

          <Button onClick={() => void commitRecargaNeveras()} disabled={recargaBusy || !recargaPicked.length}>
            {recargaBusy ? "Procesando…" : "Confirmar"}
          </Button>
        </div>
      </Drawer>

      <Drawer
        open={modOpen}
        title="Modificar stock"
        onClose={() => {
          if (modBusy) return;
          setModOpen(false);
          setModErr(null);
        }}
      >
        <div className="space-y-4 pb-2">
          {modErr ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{modErr}</p>
          ) : null}

          <div className="grid gap-2">
            <label className="text-sm font-semibold text-slate-900">Tipo</label>
            <select
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900"
              value={modTipo}
              onChange={(e) => setModTipo(e.currentTarget.value as QuickMovimientoTipo)}
              disabled={modBusy}
            >
              <option value="entrada_compra">Entrada (Pedido/Inventario)</option>
              <option value="salida_barra">Salida (Merma/Ajuste)</option>
            </select>
          </div>

          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Buscar y añadir producto…"
            value={modSearch}
            onChange={(e) => setModSearch(e.currentTarget.value)}
          />

          <div className="max-h-[30vh] overflow-auto rounded-2xl border border-slate-200 bg-white">
            {(data ?? [])
              .filter((p) => {
                const q = modSearch.trim().toLowerCase();
                if (!q) return false;
                if (modPickedIds.has(p.id)) return false;
                return (p.articulo ?? "").toLowerCase().includes(q);
              })
              .slice(0, 30)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={modBusy}
                  onClick={() => addToMod(p)}
                  className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{p.articulo}</span>
                  <span className="shrink-0 text-xs font-semibold text-slate-600">Añadir</span>
                </button>
              ))}
            {!modSearch.trim() ? <p className="p-4 text-sm text-slate-600">Escribe para buscar productos.</p> : null}
          </div>

          {modPicked.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="grid grid-cols-[1fr_124px_44px] gap-2 border-b border-slate-100 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <div>Producto</div>
                <div className="text-center">Cantidad</div>
                <div />
              </div>
              {modPicked.map((p) => (
                <div key={p.id} className="grid grid-cols-[1fr_124px_44px] items-center gap-2 border-b border-slate-100 px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{p.articulo}</p>
                    <p className="truncate text-xs text-slate-500">Stock: {Math.max(0, Math.trunc(Number(p.stock_actual) || 0))}</p>
                  </div>
                  <input
                    className={[
                      "min-h-10 w-full rounded-xl border px-3 text-center text-base font-bold tabular-nums text-slate-900",
                      modSubmitAttempted && Math.max(0, Math.trunc(Number(modQty[p.id] ?? "0") || 0)) <= 0
                        ? "border-red-300 bg-red-50"
                        : "border-slate-200 bg-slate-50"
                    ].join(" ")}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={modQty[p.id] ?? ""}
                    onChange={(e) => setModQty((d) => ({ ...d, [p.id]: sanitizeIntString(e.currentTarget.value) }))}
                    disabled={modBusy}
                    aria-label={`Cantidad de ${p.articulo}`}
                  />
                  <button
                    type="button"
                    className="min-h-10 w-full rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    disabled={modBusy}
                    onClick={() => removeFromMod(p.id)}
                    aria-label={`Quitar ${p.articulo}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600">Añade productos arriba para aplicar un ajuste.</p>
          )}

          <Button onClick={() => void commitModificarStock()} disabled={modBusy || !modPicked.length}>
            {modBusy ? "Guardando…" : "Confirmar"}
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
