"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { stockSemaforo } from "@/lib/stockSemaforo";
import { waUrlProductoPedido } from "@/lib/whatsappPedido";

type Producto = {
  id: string;
  articulo: string;
  stock_actual: number;
  stock_minimo: number | null;
  qr_code_uid: string;
  tipo: string | null;
  unidad: string | null;
  categoria: string | null;
  proveedor: { nombre: string; telefono_whatsapp: string | null } | null;
};

async function fetchProductos(establecimientoId: string | null): Promise<Producto[]> {
  if (!establecimientoId) return [];
  const baseSelect = "id,articulo,stock_actual,stock_minimo,qr_code_uid";
  const extendedSelect = `${baseSelect},tipo,unidad,categoria,proveedor:proveedores(nombre,telefono_whatsapp)`;

  const { data, error } = await supabase()
    .from("productos")
    .select(extendedSelect)
    .eq("establecimiento_id", establecimientoId)
    .order("articulo", { ascending: true });

  if (!error) return (data as unknown as Producto[]) ?? [];

  const msg = (error as { message?: string }).message ?? "";
  const m = msg.toLowerCase();
  const looksLikeMissingColumn =
    (m.includes("column") &&
      (m.includes("tipo") || m.includes("unidad") || m.includes("categoria") || m.includes("proveedor"))) ||
    m.includes("embed") ||
    m.includes("schema cache");

  if (!looksLikeMissingColumn) throw error;

  const fallback = await supabase()
    .from("productos")
    .select(baseSelect)
    .eq("establecimiento_id", establecimientoId)
    .order("articulo", { ascending: true });
  if (fallback.error) throw fallback.error;
  return ((fallback.data ?? []) as unknown as Array<Omit<Producto, "tipo" | "unidad" | "proveedor">>).map((p) => ({
    ...p,
    tipo: null,
    unidad: null,
    categoria: null,
    proveedor: null
  })) as Producto[];
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

const CATEGORY_COLORS: Record<string, { bg: string }> = {
  cerveza: { bg: "#FEF3C7" },
  licor: { bg: "#F3E8FF" },
  refresco: { bg: "#DBEAFE" },
  vino: { bg: "#FFE4E6" },
  agua: { bg: "#CCFBF1" },
  otros: { bg: "#F4F4F5" }
};

function normalizeKey(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

function productTabKey(p: Producto): string {
  const c = normalizeKey(p.categoria);
  if (c) return c;
  const t = normalizeKey(p.tipo);
  return t || "otros";
}

export function ProductList() {
  const searchParams = useSearchParams();
  const listaCompra = searchParams.get("compra") === "1";
  const queryClient = useQueryClient();
  const { me, activeEstablishmentId: establecimientoId } = useActiveEstablishment();
  const [tab, setTab] = useState<string>("todos");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stockErr, setStockErr] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["productos", establecimientoId],
    queryFn: () => fetchProductos(establecimientoId),
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchInterval: 4000
  });

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

  async function deltaStock(p: Producto, delta: number) {
    if (!establecimientoId) return;
    setBusyId(p.id);
    setStockErr(null);
    try {
      const next = Math.max(0, Math.trunc(p.stock_actual + delta));
      const { error: upErr } = await supabase()
        .from("productos")
        .update({ stock_actual: next })
        .eq("id", p.id)
        .eq("establecimiento_id", establecimientoId);
      if (upErr) throw upErr;
      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
    } catch (e) {
      setStockErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
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
    <div className="space-y-4 pb-24">
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

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TAB_ORDER.map((t) => {
          const active = tab === t.key;
          const pastel = CATEGORY_COLORS[t.key] ?? CATEGORY_COLORS.otros;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                "min-h-12 whitespace-nowrap rounded-full px-4 text-base font-semibold",
                active ? "text-slate-900 shadow-sm" : "text-slate-700 border border-slate-200 bg-white"
              ].join(" ")}
              style={
                t.key === "todos"
                  ? active
                    ? { backgroundColor: "#111827", color: "white" }
                    : undefined
                  : { backgroundColor: pastel.bg }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {filtered.map((p) => {
          const minimo = typeof p.stock_minimo === "number" && Number.isFinite(p.stock_minimo) ? p.stock_minimo : 0;
          const sem = stockSemaforo(p.stock_actual, minimo);
          const stockPill =
            sem === "sin"
              ? { bg: "#FEF2F2", text: "#991B1B", ring: "ring-1 ring-red-100", label: "Agotado" }
              : sem === "bajo"
                ? { bg: "#FFF7ED", text: "#9A3412", ring: "ring-1 ring-orange-100", label: "Bajo mín." }
                : { bg: "#ECFDF5", text: "#065F46", ring: "ring-1 ring-emerald-100", label: "OK" };

          const hrefWa =
            p.stock_actual <= minimo
              ? waUrlProductoPedido({
                  articulo: p.articulo,
                  stock_actual: p.stock_actual,
                  stock_minimo: minimo,
                  unidad: p.unidad,
                  proveedor: p.proveedor
                })
              : null;

          const key = productTabKey(p);
          const chipBg = (CATEGORY_COLORS[key] ?? CATEGORY_COLORS.otros).bg;
          const busy = busyId === p.id;

          return (
            <div
              key={p.id}
              className={[
                "w-full max-w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-sm",
                sem === "sin" ? "border-l-4 border-l-red-500" : sem === "bajo" ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-emerald-500"
              ].join(" ")}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/p/${encodeURIComponent(p.id)}`} className="min-w-0">
                      <p className="text-lg font-bold leading-snug text-slate-900">{p.articulo}</p>
                    </Link>
                    <span
                      className="inline-flex min-h-8 items-center rounded-full px-2 text-xs font-semibold text-gray-900"
                      style={{ backgroundColor: chipBg }}
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
                  <p className="mt-1 text-sm text-slate-600">{p.unidad ?? "—"}</p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-4">
                <button
                  type="button"
                  disabled={busy || p.stock_actual <= 0}
                  onClick={() => deltaStock(p, -1)}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-300 bg-white text-2xl font-bold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Reducir stock"
                >
                  −
                </button>
                <span className="text-3xl font-bold tabular-nums text-slate-900">{p.stock_actual}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => deltaStock(p, 1)}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-900 bg-slate-900 text-2xl font-bold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Aumentar stock"
                >
                  +
                </button>
              </div>

              {hrefWa ? (
                <a
                  href={hrefWa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-3xl bg-emerald-500 px-4 py-3 text-base font-bold text-white shadow-md hover:bg-emerald-600"
                >
                  <IconWhatsApp className="h-7 w-7 text-white" />
                  Pedir por WhatsApp
                </a>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
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
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-base text-slate-600">
          {listaCompra ? "No hay productos bajo el mínimo en esta categoría." : "No hay productos en esta categoría."}
        </p>
      ) : null}
    </div>
  );
}
