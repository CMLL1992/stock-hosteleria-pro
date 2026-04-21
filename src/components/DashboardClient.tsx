"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";

type ProductoStock = {
  id: string;
  articulo: string;
  categoria: string | null;
  stock_actual: number;
  stock_minimo: number | null;
};

function toInt(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export function DashboardClient() {
  const { activeEstablishmentId: establecimientoId, activeEstablishmentName, me } = useActiveEstablishment();

  const productosQuery = useQuery({
    queryKey: ["dashboard", "productos", establecimientoId],
    enabled: !!establecimientoId,
    queryFn: async () => {
      // Compatibilidad multi-entorno: algunas BDs usan `nombre` en vez de `articulo`.
      const withArticulo = await supabase()
        .from("productos")
        .select("id,articulo,categoria,stock_actual,stock_minimo")
        .eq("establecimiento_id", establecimientoId as string)
        .order("articulo", { ascending: true });

      if (!withArticulo.error) {
        return (withArticulo.data as unknown as ProductoStock[]) ?? [];
      }

      const msg = (withArticulo.error as { message?: string }).message?.toLowerCase?.() ?? "";
      const looksLikeMissingArticulo =
        msg.includes("articulo") && (msg.includes("does not exist") || msg.includes("could not find") || msg.includes("column"));
      if (!looksLikeMissingArticulo) throw withArticulo.error;

      const withNombre = await supabase()
        .from("productos")
        .select("id,nombre,categoria,stock_actual,stock_minimo")
        .eq("establecimiento_id", establecimientoId as string)
        .order("nombre", { ascending: true });
      if (withNombre.error) throw withNombre.error;

      return ((withNombre.data ?? []) as unknown as Array<{
        id: string;
        nombre: string;
        categoria: string | null;
        stock_actual: number;
        stock_minimo: number | null;
      }>).map((p) => ({
        id: p.id,
        articulo: p.nombre,
        categoria: p.categoria,
        stock_actual: p.stock_actual,
        stock_minimo: p.stock_minimo
      })) as ProductoStock[];
    },
    staleTime: 15_000,
    retry: 1
  });

  const productosData = productosQuery.data;

  const kpis = useMemo(() => {
    const productos = productosData ?? [];
    const totalReferencias = productos.length;
    const unidadesEnAlmacen = productos.reduce((acc, p) => acc + toInt(p.stock_actual, 0), 0);
    const criticos = productos
      .map((p) => {
        const min = p.stock_minimo;
        if (typeof min !== "number" || !Number.isFinite(min)) return null;
        const actual = toInt(p.stock_actual, 0);
        const minimo = toInt(min, 0);
        const deficit = minimo - actual;
        if (actual > minimo) return null;
        return { ...p, actual, minimo, deficit };
      })
      .filter(Boolean) as Array<
      ProductoStock & {
        actual: number;
        minimo: number;
        deficit: number;
      }
    >;

    criticos.sort((a, b) => b.deficit - a.deficit || a.articulo.localeCompare(b.articulo));
    return {
      totalReferencias,
      unidadesEnAlmacen,
      atencionRequerida: criticos.length,
      criticos
    };
  }, [productosData]);

  return (
    <div className="space-y-6 bg-slate-50">
      {me?.isSuperadmin && activeEstablishmentName ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-700 shadow-sm">
          Establecimiento activo: <span className="font-semibold">{activeEstablishmentName}</span>
        </div>
      ) : null}

      {productosQuery.isLoading ? (
        <p className="text-sm text-slate-600">Cargando stock…</p>
      ) : productosQuery.error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {(productosQuery.error as Error).message}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Atención Requerida</p>
                  <p className="mt-1 text-sm text-slate-500">Bajo mínimos o igual al mínimo</p>
                </div>
                <span className="text-xl" aria-hidden>
                  ⚠️
                </span>
              </div>
              <p className="mt-4 text-3xl font-semibold tabular-nums text-red-600">{kpis.atencionRequerida}</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Total Referencias</p>
                  <p className="mt-1 text-sm text-slate-500">Productos únicos</p>
                </div>
                <span className="text-xl" aria-hidden>
                  📦
                </span>
              </div>
              <p className="mt-4 text-3xl font-semibold tabular-nums text-slate-900">{kpis.totalReferencias}</p>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Unidades en Almacén</p>
                  <p className="mt-1 text-sm text-slate-500">Suma total de stock actual</p>
                </div>
                <span className="text-xl" aria-hidden>
                  📊
                </span>
              </div>
              <p className="mt-4 text-3xl font-semibold tabular-nums text-slate-900">{kpis.unidadesEnAlmacen}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-1">
              <p className="text-base font-semibold text-slate-800">Artículos a Reponer</p>
              <p className="text-sm text-slate-500">Lista crítica (stock actual ≤ stock mínimo), ordenada por déficit.</p>
            </div>

            {!kpis.criticos.length ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl" aria-hidden>
                    ✅
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-emerald-900">El stock está saneado.</p>
                    <p className="mt-0.5 text-sm text-emerald-800">No hay alertas urgentes.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3">Artículo</th>
                      <th className="px-4 py-3">Categoría</th>
                      <th className="px-4 py-3 text-right">Stock actual</th>
                      <th className="px-4 py-3 text-right">Stock mínimo</th>
                      <th className="px-4 py-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpis.criticos.map((p) => {
                      const badge =
                        p.actual <= 0
                          ? "bg-red-50 text-red-700 ring-1 ring-red-100"
                          : "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
                      return (
                        <tr key={p.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50">
                          <td className="px-4 py-3 font-semibold text-slate-900">{p.articulo}</td>
                          <td className="px-4 py-3 text-slate-700">{p.categoria ?? "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={["inline-flex items-center rounded-full px-2.5 py-1 font-mono text-xs tabular-nums", badge].join(" ")}>
                              {p.actual}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700">{p.minimo}</td>
                          <td className="px-4 py-3 text-right">
                            <a
                              href="/admin/pedido-rapido"
                              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                            >
                              Pedir →
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

