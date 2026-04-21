"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";

type Producto = {
  id: string;
  articulo: string;
  stock_actual: number;
  stock_minimo: number | null;
  qr_code_uid: string;
  tipo: string | null;
  unidad: string | null;
  categoria: string | null;
};

async function fetchProductos(establecimientoId: string | null): Promise<Producto[]> {
  if (!establecimientoId) return [];
  // Si la BD todavía no tiene las columnas tipo/unidad (schema cache), esta query puede fallar.
  // Hacemos fallback a una selección mínima para no "vaciar" la lista de stock.
  const baseSelect = "id,articulo,stock_actual,stock_minimo,qr_code_uid";
  const extendedSelect = `${baseSelect},tipo,unidad,categoria`;

  const { data, error } = await supabase()
    .from("productos")
    .select(extendedSelect)
    .eq("establecimiento_id", establecimientoId)
    .order("articulo", { ascending: true });

  if (!error) return (data as unknown as Producto[]) ?? [];

  const msg = (error as { message?: string }).message ?? "";
  const looksLikeMissingColumn =
    msg.toLowerCase().includes("column") &&
    (msg.toLowerCase().includes("tipo") ||
      msg.toLowerCase().includes("unidad") ||
      msg.toLowerCase().includes("categoria"));

  if (!looksLikeMissingColumn) throw error;

  const fallback = await supabase()
    .from("productos")
    .select(baseSelect)
    .eq("establecimiento_id", establecimientoId)
    .order("articulo", { ascending: true });
  if (fallback.error) throw fallback.error;
  return ((fallback.data ?? []) as unknown as Array<Omit<Producto, "tipo" | "unidad">>).map((p) => ({
    ...p,
    tipo: null,
    unidad: null,
    categoria: null
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
                "min-h-11 whitespace-nowrap rounded-full px-4 text-sm font-semibold",
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
          const low = p.stock_actual < minimo;
          const stockPill =
            low
              ? { bg: "#FEF2F2", text: "#991B1B", ring: "ring-1 ring-red-100" }
              : p.stock_actual > 0
                ? { bg: "#ECFDF5", text: "#065F46", ring: "ring-1 ring-emerald-100" }
                : { bg: "#F3F4F6", text: "#374151", ring: "ring-1 ring-gray-100" };

          const key = productTabKey(p);
          const chipBg = (CATEGORY_COLORS[key] ?? CATEGORY_COLORS.otros).bg;

          return (
            <div
              key={p.id}
              className="cursor-pointer rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition active:scale-[0.99]"
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
                  <div className="flex items-center gap-2">
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
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{p.unidad ?? "—"}</p>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={["grid h-10 min-w-10 place-items-center rounded-full px-3 text-sm font-semibold tabular-nums", stockPill.ring].join(" ")}
                    style={{ backgroundColor: stockPill.bg, color: stockPill.text }}
                  >
                    {p.stock_actual}
                  </div>
                  <a
                    className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    href={`/qr/${encodeURIComponent(p.id)}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    QR
                  </a>
                  {me?.isAdmin ? (
                    <a
                      className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
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

