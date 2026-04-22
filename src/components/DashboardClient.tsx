"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDashboardProductos } from "@/lib/adminDashboardData";
import { useProductosRealtime } from "@/lib/useProductosRealtime";

export function DashboardClient() {
  const { activeEstablishmentId: establecimientoId, activeEstablishmentName, me } = useActiveEstablishment();
  const queryClient = useQueryClient();

  useProductosRealtime({
    establecimientoId,
    queryClient,
    queryKeys: [
      ["dashboard", "productos", establecimientoId],
      ["productos", establecimientoId]
    ]
  });

  const productosQuery = useQuery({
    queryKey: ["dashboard", "productos", establecimientoId],
    enabled: !!establecimientoId,
    queryFn: () => fetchDashboardProductos(establecimientoId as string),
    staleTime: 15_000,
    retry: 1
  });

  const rows = useMemo(() => productosQuery.data ?? [], [productosQuery.data]);

  const bajoMinimos = useMemo(() => rows.filter((p) => p.stock_actual <= p.stock_minimo), [rows]);

  function bucketUnidad(p: { unidad: string | null; categoria: string | null; articulo: string }): "caja" | "barril" | "gas" | null {
    const unidad = (p.unidad ?? "").trim().toLowerCase();
    const cat = (p.categoria ?? "").trim().toLowerCase();
    const art = (p.articulo ?? "").trim().toLowerCase();
    if (cat.includes("gas") || art.includes("gas")) return "gas";
    // Acepta singular/plural y variantes típicas
    if (unidad.startsWith("caj")) return "caja"; // caja / cajas
    if (unidad.startsWith("barril")) return "barril"; // barril / barriles
    return null;
  }

  const vacios = useMemo(() => {
    const out = { cajas: 0, barriles: 0, gas: 0 };
    for (const p of rows) {
      const n = Number(p.stock_vacios ?? 0) || 0;
      if (n <= 0) continue;
      const b = bucketUnidad(p);
      if (b === "caja") out.cajas += n;
      else if (b === "barril") out.barriles += n;
      else if (b === "gas") out.gas += n;
    }
    return out;
  }, [rows]);

  const vaciosDetalleTop = useMemo(() => {
    const items = rows
      .map((p) => ({
        articulo: p.articulo,
        stock_vacios: Number(p.stock_vacios ?? 0) || 0,
        unidad: p.unidad,
        categoria: p.categoria
      }))
      .filter((x) => x.stock_vacios > 0)
      .sort((a, b) => b.stock_vacios - a.stock_vacios)
      .slice(0, 3);

    return items.map((x) => {
      const b = bucketUnidad({ unidad: x.unidad, categoria: x.categoria, articulo: x.articulo });
      const base = b === "gas" ? "gas" : b === "barril" ? "barril" : b === "caja" ? "caja" : (x.unidad ?? "").trim().toLowerCase() || "unidades";
      const plural = x.stock_vacios === 1 ? base : base.endsWith("s") ? base : `${base}s`;
      return `${x.stock_vacios} ${plural} de ${x.articulo}`;
    });
  }, [rows]);

  if (productosQuery.isLoading) {
    return <p className="text-base text-slate-500">Cargando stock…</p>;
  }
  if (productosQuery.error) {
    return (
      <p className="rounded-3xl border border-red-200 bg-red-50 p-4 text-base text-red-800">
        {(productosQuery.error as Error).message}
      </p>
    );
  }
  if (!establecimientoId) {
    return <p className="text-base text-slate-500">Selecciona un establecimiento para ver el inventario.</p>;
  }

  return (
    <div className="w-full max-w-full space-y-6">
      {me?.isSuperadmin && activeEstablishmentName ? (
        <div className="w-full rounded-3xl border border-slate-100 bg-white p-4 text-base text-slate-600 shadow-sm">
          Establecimiento activo: <span className="font-semibold text-slate-900">{activeEstablishmentName}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border-2 border-red-200 bg-white p-6 shadow-md ring-2 ring-red-100">
          <p className="text-center text-xs font-bold uppercase tracking-wide text-red-700">Bajo mínimos</p>
          <p className="mt-1 text-center text-[11px] text-red-600/90">Stock actual ≤ stock mínimo</p>
          <p className="mt-4 text-center text-5xl font-black tabular-nums tracking-tight text-red-600">{bajoMinimos.length}</p>
        </div>
        <Link
          href="/stock?vacios=1"
          className="block rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm hover:bg-slate-50"
        >
          <p className="font-semibold text-slate-900">Envases para devolver</p>
          <p className="mt-2 text-sm text-slate-600">Total en stock de vacíos (solo positivos).</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-slate-50 p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cajas</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{vacios.cajas}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Barriles</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{vacios.barriles}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Gas</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{vacios.gas}</p>
            </div>
          </div>
          {vaciosDetalleTop.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detalle (top 3)</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {vaciosDetalleTop.map((t) => (
                  <li key={t} className="truncate">
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Toca para ver inventario de vacíos.</p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Sin envases pendientes.</p>
          )}
        </Link>
      </div>

      <Link
        href="/stock?compra=1"
        className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
      >
        Ver lista de compra en inventario
      </Link>
    </div>
  );
}
