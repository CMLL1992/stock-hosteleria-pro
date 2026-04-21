"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  // Si la BD todavía no tiene las columnas tipo/unidad (schema cache), esta query puede fallar.
  // Hacemos fallback a una selección mínima para no "vaciar" la lista de stock.
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
  // Tonos pastel muy suaves (exactos donde lo has pedido)
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
  // Preferimos categoria si existe; sino usamos tipo.
  const c = normalizeKey(p.categoria);
  if (c) return c;
  const t = normalizeKey(p.tipo);
  return t || "otros";
}

export function ProductList() {
  const { me, activeEstablishmentId: establecimientoId } = useActiveEstablishment();

  const { data, isLoading, error } = useQuery({
    queryKey: ["productos", establecimientoId],
    queryFn: () => fetchProductos(establecimientoId),
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchInterval: 4000
  });

  const [tab, setTab] = useState<string>("todos");

  const filtered = useMemo(() => {
    if (!data) return [];
    if (tab === "todos") return data;
    return data.filter((p) => productTabKey(p) === tab);
  }, [data, tab]);

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
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TAB_ORDER.map((t) => {
          const active = tab === t.key;
          const pastel = CATEGORY_COLORS[t.key] ?? CATEGORY_COLORS.otros;
          return (
            <button
              key={t.key}
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

      <div className="space-y-3">
        {filtered.map((p) => {
          const minimo = typeof p.stock_minimo === "number" && Number.isFinite(p.stock_minimo) ? p.stock_minimo : 0;
          const sem = stockSemaforo(p.stock_actual, minimo);
          const stockPill =
            sem === "sin"
              ? { bg: "#FEF2F2", text: "#991B1B", ring: "ring-1 ring-red-100", label: "Agotado" }
              : sem === "bajo"
                ? { bg: "#FFF7ED", text: "#9A3412", ring: "ring-1 ring-orange-100", label: "Bajo mín." }
                : { bg: "#ECFDF5", text: "#065F46", ring: "ring-1 ring-emerald-100", label: "OK" };

          const wa =
            me?.isAdmin &&
            waUrlProductoPedido({
              articulo: p.articulo,
              stock_actual: p.stock_actual,
              stock_minimo: minimo,
              unidad: p.unidad,
              proveedor: p.proveedor
            });

          const key = productTabKey(p);
          const chipBg = (CATEGORY_COLORS[key] ?? CATEGORY_COLORS.otros).bg;

          return (
            <div
              key={p.id}
              className={[
                "w-full max-w-full cursor-pointer rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition active:scale-[0.99]",
                sem === "sin" ? "border-l-4 border-l-red-500" : sem === "bajo" ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-emerald-500"
              ].join(" ")}
              role="link"
              tabIndex={0}
              onClick={() => {
                window.location.href = `/p/${encodeURIComponent(p.id)}`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  window.location.href = `/p/${encodeURIComponent(p.id)}`;
                }
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      className="min-w-0"
                      href={`/p/${encodeURIComponent(p.id)}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="truncate text-base font-semibold text-slate-900">{p.articulo}</p>
                    </a>
                    <span
                      className="inline-flex min-h-6 items-center rounded-full px-2 text-[11px] font-semibold text-gray-900"
                      style={{ backgroundColor: chipBg }}
                    >
                      {key === "todos" ? "otros" : key}
                    </span>
                    <span
                      className={["inline-flex min-h-6 items-center rounded-full px-2 text-[11px] font-semibold", stockPill.ring].join(" ")}
                      style={{ backgroundColor: stockPill.bg, color: stockPill.text }}
                    >
                      {stockPill.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{p.unidad ?? "—"}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <div
                    className={[
                      "grid min-h-12 min-w-12 place-items-center rounded-full px-3 text-base font-semibold tabular-nums",
                      stockPill.ring
                    ].join(" ")}
                    style={{ backgroundColor: stockPill.bg, color: stockPill.text }}
                  >
                    {p.stock_actual}
                  </div>
                  {wa ? (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-sm hover:bg-emerald-600"
                      aria-label="Pedido WhatsApp"
                      title="WhatsApp"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconWhatsApp className="h-6 w-6 text-white" />
                    </a>
                  ) : null}
                  <a
                    className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    href={`/qr/${encodeURIComponent(p.id)}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    QR
                  </a>
                  {me?.isAdmin ? (
                    <a
                      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                      href={`/admin/productos/${encodeURIComponent(p.id)}/editar`}
                      aria-label="Editar producto"
                      title="Editar"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ✎
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

