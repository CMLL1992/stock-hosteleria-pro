"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { Button } from "@/components/ui/Button";
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
import { getEffectiveRole, hasPermission, canAdjustStockAbsolute, canGenerateQr } from "@/lib/permissions";

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

const STOCK_INPUT_CLASS =
  "h-14 w-[5.5rem] shrink-0 rounded-2xl border-2 border-slate-800 bg-white px-2 text-center text-2xl font-black tabular-nums text-slate-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-slate-300";

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

function readEvtValue(
  e:
    | { currentTarget?: { value?: unknown }; target?: { value?: unknown } }
    | null
    | undefined
): string {
  try {
    const v = e?.currentTarget?.value ?? e?.target?.value;
    return typeof v === "string" ? v : String(v ?? "");
  } catch {
    return "";
  }
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
  const role = getEffectiveRole(me);
  const canPedidos = hasPermission(role, "admin");
  const canSetStockAbsolute = canAdjustStockAbsolute(role);
  const canQr = canGenerateQr(role);
  const [tab, setTab] = useState<string>("todos");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stockErr, setStockErr] = useState<string | null>(null);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState<string>("");
  const [agruparPorProveedor, setAgruparPorProveedor] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [cestaOpen, setCestaOpen] = useState(false);

  const [movOpen, setMovOpen] = useState(false);
  const [movProd, setMovProd] = useState<Producto | null>(null);
  const [movStep, setMovStep] = useState<"menu" | "cantidad">("menu");
  const [movTipo, setMovTipo] = useState<QuickMovimientoTipo>("entrada_compra");
  const [movCantidad, setMovCantidad] = useState<string>("1");
  const [movBusy, setMovBusy] = useState(false);
  const qtyRef = useRef<HTMLInputElement | null>(null);

  // Devolver envases vacíos (manual, staff/admin/superadmin)
  const [vaciosOpen, setVaciosOpen] = useState(false);
  const [vaciosStep, setVaciosStep] = useState<"pick" | "qty">("pick");
  const [vaciosSearch, setVaciosSearch] = useState("");
  const [vaciosProd, setVaciosProd] = useState<Producto | null>(null);
  const [vaciosQty, setVaciosQty] = useState<string>("1");
  const [vaciosBusy, setVaciosBusy] = useState(false);
  const [vaciosErr, setVaciosErr] = useState<string | null>(null);

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

  const vaciosPickList = useMemo(() => {
    const q = vaciosSearch.trim().toLowerCase();
    const list = Array.isArray(data) ? data : [];
    if (!q) return list;
    return list.filter((p) => (p.articulo ?? "").toLowerCase().includes(q));
  }, [data, vaciosSearch]);

  async function commitDevolverVacios() {
    if (!establecimientoId || !vaciosProd) return;
    const n = Math.max(0, Math.trunc(Number(String(vaciosQty).replace(",", "."))));
    if (!Number.isFinite(n) || n <= 0) return;
    setVaciosBusy(true);
    setVaciosErr(null);
    try {
      const usuario_id = await requireUserId();
      const payload = {
        client_uuid: newClientUuid(),
        producto_id: vaciosProd.id,
        establecimiento_id: establecimientoId,
        tipo: "devolucion_envase" as const,
        cantidad: n,
        usuario_id,
        timestamp: new Date().toISOString()
      };

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { error } = await supabase()
          .from("movimientos")
          .upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        await enqueueMovimiento(payload);
      }

      // Optimistic: suma a stock_vacios
      const applyOptimistic = (prevList: Producto[]) =>
        prevList.map((x) => {
          if (x.id !== vaciosProd.id) return x;
          const nextV = Math.max(0, Math.trunc(Number(x.stock_vacios ?? 0)) + n);
          return { ...x, stock_vacios: nextV };
        });
      queryClient.setQueryData(["productos", establecimientoId], (old) => applyOptimistic(((old as Producto[] | undefined) ?? []) as Producto[]));
      queryClient.setQueryData(["dashboard", "productos", establecimientoId], (old) => applyOptimistic(((old as Producto[] | undefined) ?? []) as Producto[]));

      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", establecimientoId] });

      setVaciosOpen(false);
      setVaciosStep("pick");
      setVaciosSearch("");
      setVaciosProd(null);
      setVaciosQty("1");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setVaciosErr(errMsg(e));
    } finally {
      setVaciosBusy(false);
    }
  }

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
      const prev = Math.max(0, Math.trunc(Number(p.stock_actual) || 0));
      const delta = n - prev;
      if (delta === 0) {
        setStockDraft((d) => ({ ...d, [p.id]: String(n) }));
        return;
      }

      const tipo: "entrada" | "salida" = delta > 0 ? "entrada" : "salida";
      const cantidad = Math.abs(delta);
      const usuario_id = await requireUserId();
      const payload = {
        client_uuid: newClientUuid(),
        producto_id: p.id,
        establecimiento_id: establecimientoId,
        tipo,
        cantidad,
        usuario_id,
        timestamp: new Date().toISOString()
      };

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { error } = await supabase()
          .from("movimientos")
          .upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        await enqueueMovimiento(payload);
      }

      setStockDraft((d) => ({ ...d, [p.id]: String(n) }));

      // Optimistic UI: ajusta caches inmediatamente
      const applyOptimistic = (prevList: Producto[]) =>
        prevList.map((x) => {
          if (x.id !== p.id) return x;
          const nextStock = Math.max(0, Math.trunc(Number(x.stock_actual)) + (tipo === "entrada" ? cantidad : -cantidad));
          return { ...x, stock_actual: nextStock };
        });
      queryClient.setQueryData(["productos", establecimientoId], (old) => applyOptimistic(((old as Producto[] | undefined) ?? []) as Producto[]));
      queryClient.setQueryData(["dashboard", "productos", establecimientoId], (old) =>
        applyOptimistic(((old as Producto[] | undefined) ?? []) as Producto[])
      );

      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", establecimientoId] });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setStockErr(errMsg(e));
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

  const openGestionar = (p: Producto) => {
    setMovProd(p);
    setMovCantidad("1");
    setMovStep("menu");
    setMovOpen(true);
  };

  async function commitQuickMovimiento() {
    if (!establecimientoId || !movProd) return;
    const n = Math.max(0, Math.trunc(Number(String(movCantidad).replace(",", "."))));
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
      } = {
        client_uuid: newClientUuid(),
        producto_id: movProd.id,
        establecimiento_id: establecimientoId,
        tipo: movTipo,
        cantidad: n,
        usuario_id,
        timestamp: new Date().toISOString()
      };

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { error } = await supabase()
          .from("movimientos")
          .upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        await enqueueMovimiento(payload);
      }

      // Optimistic UI: actualiza caches inmediatamente (sin esperar realtime/refetch)
      const applyOptimistic = (prev: Producto[]) =>
        prev.map((x) => {
          if (x.id !== movProd.id) return x;
          const deltaStock = movTipo === "entrada_compra" ? n : movTipo === "salida_barra" ? -n : 0;
          const nextStock = Math.max(0, Math.trunc(Number(x.stock_actual)) + deltaStock);
          // Importante: 'salida_barra' ya NO genera vacíos automáticamente.
          return { ...x, stock_actual: nextStock };
        });

      queryClient.setQueryData(["productos", establecimientoId], (old) => {
        const prev = (old as Producto[] | undefined) ?? [];
        return applyOptimistic(prev);
      });
      queryClient.setQueryData(["dashboard", "productos", establecimientoId], (old) => {
        const prev = (old as Producto[] | undefined) ?? [];
        return applyOptimistic(prev);
      });

      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["productos"] });
      setMovOpen(false);
      setMovProd(null);
      setMovStep("menu");
      if (returnTo) {
        router.replace(returnTo);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setStockErr(errMsg(e));
    } finally {
      setMovBusy(false);
    }
  }

  if (me?.role === null && !me?.profileReady) return <p className="text-sm text-slate-600">Cargando perfil…</p>;
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
        <button
          type="button"
          onClick={() => {
            setVaciosErr(null);
            setVaciosOpen(true);
            setVaciosStep("pick");
            setVaciosProd(null);
            setVaciosQty("1");
          }}
          className="min-h-12 w-full rounded-3xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-900 shadow-sm hover:bg-slate-50 sm:w-auto"
        >
          Devolver Envases Vacíos
        </button>
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

      {stockErr ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{stockErr}</p>
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
                  {canPedidos ? (
                    <label className="mt-1 flex shrink-0 cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="h-6 w-6 rounded border-slate-300 text-slate-900"
                        aria-label={`Seleccionar ${p.articulo}`}
                      />
                    </label>
                  ) : null}

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
                    {equivCajasTexto(p.stock_actual, p.unidades_por_caja) ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Equivale a{" "}
                        <span className="font-semibold text-slate-700">{equivCajasTexto(p.stock_actual, p.unidades_por_caja)}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <span className="text-[10px] font-bold uppercase text-slate-500">Stock</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`Stock de ${p.articulo}`}
                      disabled={busy || !canSetStockAbsolute}
                      className={STOCK_INPUT_CLASS}
                      value={stockDraft[p.id] ?? String(p.stock_actual)}
                      onChange={(e) => {
                        const v = e.currentTarget?.value ?? readEvtValue(e);
                        setStockDraft((d) => ({ ...d, [p.id]: v }));
                      }}
                      onBlur={() => {
                        if (!canSetStockAbsolute) {
                          // Staff: no puede fijar stock absoluto desde aquí.
                          setStockDraft((d) => ({ ...d, [p.id]: String(p.stock_actual) }));
                          return;
                        }
                        // En algunos móviles el evento puede llegar sin currentTarget; usamos el estado controlado.
                        void setStockFromInput(p, stockDraft[p.id] ?? String(p.stock_actual));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-stretch gap-2 pl-9">
                  <button
                    type="button"
                    onClick={() => openGestionar(p)}
                    className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                  >
                    GESTIONAR
                  </button>
                  {canQr ? (
                    <Link
                      href={`/qr/${encodeURIComponent(p.id)}?print=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                    >
                      Generar QR
                    </Link>
                  ) : null}
                </div>
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

      {canPedidos && selectedIds.size > 0 ? (
        <button
          type="button"
          className="fixed bottom-24 right-4 z-30 flex min-h-[52px] items-center gap-2 rounded-full border-2 border-slate-900 bg-slate-900 px-5 py-3 text-base font-bold text-white shadow-xl"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          onClick={() => setCestaOpen(true)}
        >
          Pedido ({selectedIds.size})
        </button>
      ) : null}

      {canPedidos ? (
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
      ) : null}

      <Drawer
        open={movOpen}
        title={movProd ? `Gestionar · ${movProd.articulo}` : "Gestionar"}
        onClose={() => {
          if (movBusy) return;
          setMovOpen(false);
          setMovProd(null);
          setMovStep("menu");
        }}
      >
        <div className="space-y-3">
          {movStep === "menu" ? (
            <div className="space-y-2">
              {canPedidos ? (
                <button
                  type="button"
                  disabled={movBusy}
                  onClick={() => {
                    setMovTipo("entrada_compra");
                    setMovStep("cantidad");
                  }}
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  Registrar Entrada (Compra)
                </button>
              ) : null}
              <button
                type="button"
                disabled={movBusy}
                onClick={() => {
                  setMovTipo("salida_barra");
                  setMovStep("cantidad");
                }}
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Sacar a Barra
              </button>
              {canPedidos && movProd ? (
                <Link
                  href={`/admin/productos/${encodeURIComponent(movProd.id)}/editar`}
                  className="flex min-h-12 w-full items-center rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  Editar Producto
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                disabled={movBusy}
                onClick={() => setMovStep("menu")}
                className="min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Volver
              </button>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-900">Cantidad</label>
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base"
                  inputMode="numeric"
                  type="text"
                  pattern="[0-9]*"
                  value={movCantidad}
                  onChange={(e) => setMovCantidad(e.currentTarget.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  ref={qtyRef}
                  disabled={movBusy}
                />
                {movTipo === "entrada_compra" && movProd?.unidades_por_caja && movProd.unidades_por_caja > 1 ? (
                  <p className="text-xs text-slate-500">
                    Unidades por caja: <span className="font-semibold text-slate-700">{movProd.unidades_por_caja}</span> · Equivale a{" "}
                    <span className="font-semibold text-slate-700">
                      {Math.max(0, Math.trunc(Number(String(movCantidad).replace(",", ".")))) * movProd.unidades_por_caja} uds
                    </span>
                  </p>
                ) : null}
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
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (movBusy) return;
              setMovOpen(false);
              setMovProd(null);
              setMovStep("menu");
            }}
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Cerrar
          </button>
        </div>
      </Drawer>

      <Drawer
        open={vaciosOpen}
        title="Devolver envases vacíos"
        onClose={() => {
          if (vaciosBusy) return;
          setVaciosOpen(false);
          setVaciosErr(null);
          setVaciosStep("pick");
          setVaciosProd(null);
          setVaciosQty("1");
        }}
      >
        <div className="space-y-3 pb-2">
          {vaciosErr ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{vaciosErr}</p>
          ) : null}

          {vaciosStep === "pick" ? (
            <div className="space-y-3">
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                placeholder="Buscar producto…"
                value={vaciosSearch}
                onChange={(e) => setVaciosSearch(e.currentTarget.value)}
              />
              <div className="max-h-[55vh] overflow-auto rounded-2xl border border-slate-200 bg-white">
                {(() => {
                  const byFamily = new Map<string, typeof vaciosPickList>();
                  for (const p of vaciosPickList) {
                    const fam = (p.categoria ?? p.tipo ?? "Otros").toString().trim() || "Otros";
                    byFamily.set(fam, [...(byFamily.get(fam) ?? []), p]);
                  }
                  const families = Array.from(byFamily.keys()).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
                  let rendered = 0;
                  return families.map((fam) => {
                    const items = (byFamily.get(fam) ?? [])
                      .slice()
                      .sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }));
                    const out: React.ReactNode[] = [];
                    if (rendered < 80) {
                      out.push(
                        <div key={`fam-${fam}`} className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-2">
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{fam}</p>
                        </div>
                      );
                    }
                    for (const p of items) {
                      if (rendered >= 80) break;
                      rendered++;
                      out.push(
                        <button
                          key={p.id}
                          type="button"
                          disabled={vaciosBusy}
                          onClick={() => {
                            setVaciosProd(p);
                            setVaciosStep("qty");
                            setVaciosQty("1");
                          }}
                          className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{p.articulo}</span>
                          <span className="shrink-0 text-xs font-semibold text-slate-600">
                            Vacíos: {Math.max(0, Number(p.stock_vacios ?? 0) || 0)}
                          </span>
                        </button>
                      );
                    }
                    return out;
                  });
                })()}
                {!vaciosPickList.length ? (
                  <p className="p-4 text-sm text-slate-600">No hay productos que coincidan.</p>
                ) : null}
              </div>
              <p className="text-xs text-slate-500">
                Selecciona un producto y registra cuántos envases vacíos llevas al almacén.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900">{vaciosProd?.articulo ?? "Producto"}</p>
              <label className="text-sm font-semibold text-slate-900">Cantidad</label>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base"
                inputMode="numeric"
                type="number"
                min={1}
                step={1}
                value={vaciosQty}
                onChange={(e) => setVaciosQty(e.currentTarget.value)}
                disabled={vaciosBusy}
              />
              <div className="grid grid-cols-1 gap-2">
                <Button onClick={() => void commitDevolverVacios()} disabled={vaciosBusy || !vaciosProd}>
                  {vaciosBusy ? "Guardando…" : "Confirmar devolución"}
                </Button>
                <button
                  type="button"
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                  disabled={vaciosBusy}
                  onClick={() => {
                    setVaciosStep("pick");
                    setVaciosProd(null);
                  }}
                >
                  Cambiar producto
                </button>
              </div>
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
