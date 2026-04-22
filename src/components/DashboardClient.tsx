"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboardProductos } from "@/lib/adminDashboardData";

export function DashboardClient() {
  const { activeEstablishmentId: establecimientoId, activeEstablishmentName, me } = useActiveEstablishment();
  const [search, setSearch] = useState("");

  const productosQuery = useQuery({
    queryKey: ["dashboard", "productos", establecimientoId],
    enabled: !!establecimientoId,
    queryFn: () => fetchDashboardProductos(establecimientoId as string),
    staleTime: 15_000,
    retry: 1
  });

  const rows = useMemo(() => productosQuery.data ?? [], [productosQuery.data]);

  const bajoMinimos = useMemo(() => rows.filter((p) => p.stock_actual <= p.stock_minimo), [rows]);

  const vacios = useMemo(() => {
    const out = { cajas: 0, barriles: 0, gas: 0 };
    for (const p of rows) {
      const n = Number(p.stock_vacios ?? 0) || 0;
      if (n <= 0) continue;
      const unidad = (p.unidad ?? "").trim().toLowerCase();
      const cat = (p.categoria ?? "").trim().toLowerCase();
      const art = (p.articulo ?? "").trim().toLowerCase();
      if (unidad === "caja") out.cajas += n;
      else if (unidad === "barril") out.barriles += n;
      else if (cat.includes("gas") || art.includes("gas")) out.gas += n;
    }
    return out;
  }, [rows]);

  const urgentes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = bajoMinimos;
    if (!q) return base;
    return base.filter((p) => {
      const a = p.articulo.toLowerCase();
      const c = (p.categoria ?? "").toLowerCase();
      return a.includes(q) || c.includes(q);
    });
  }, [bajoMinimos, search]);

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
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
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
          <p className="mt-3 text-xs text-slate-500">Gas: detectado por “gas” en categoría o nombre.</p>
        </div>
      </div>

      <Link
        href="/stock?compra=1"
        className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
      >
        Ver lista de compra en inventario
      </Link>

      <div className="relative w-full">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="Buscar en alertas…"
          className="min-h-12 w-full rounded-3xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          aria-label="Buscar en alertas"
        />
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Alertas rápidas</h2>
          <p className="mt-1 text-sm text-slate-500">
            {urgentes.length} producto{urgentes.length === 1 ? "" : "s"}
            {search.trim() ? " (filtrado)" : ""}
          </p>
        </div>

        {urgentes.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-base text-slate-600 shadow-sm">
            {bajoMinimos.length === 0
              ? "Todo en orden: no hay productos por debajo del mínimo."
              : "Ninguna alerta coincide con la búsqueda."}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {urgentes.map((p) => (
              <li
                key={p.id}
                className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100"
              >
                <p className="text-base font-bold leading-snug text-slate-900">{p.articulo}</p>
                <p className="mt-1 text-sm text-slate-600">
                  Stock{" "}
                  <span className="font-mono font-semibold tabular-nums text-slate-900">{p.stock_actual}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
