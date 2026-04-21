"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { fetchDashboardProductos, fetchMovimientosCountHoy } from "@/lib/adminDashboardData";
import { deficitPedido, waUrlPedidoGlobal, waUrlProductoPedido } from "@/lib/whatsappPedido";

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

  const movHoyQuery = useQuery({
    queryKey: ["dashboard", "movimientos-hoy", establecimientoId],
    enabled: !!establecimientoId,
    queryFn: () => fetchMovimientosCountHoy(establecimientoId as string),
    staleTime: 30_000,
    retry: 1
  });

  const rows = useMemo(() => productosQuery.data ?? [], [productosQuery.data]);

  const bajoMinimos = useMemo(() => rows.filter((p) => p.stock_actual <= p.stock_minimo), [rows]);

  const pedidoGlobalUrl = useMemo(() => waUrlPedidoGlobal(bajoMinimos), [bajoMinimos]);

  const kpis = useMemo(() => {
    const totalUnidades = rows.reduce((acc, p) => acc + p.stock_actual, 0);
    return {
      bajoMinimos: bajoMinimos.length,
      totalUnidades,
      pedidosHoy: movHoyQuery.data ?? 0
    };
  }, [rows, bajoMinimos.length, movHoyQuery.data]);

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

  return (
    <div className="w-full max-w-full space-y-6">
      {me?.isSuperadmin && activeEstablishmentName ? (
        <div className="w-full rounded-3xl border border-slate-100 bg-white p-4 text-base text-slate-600 shadow-sm">
          Establecimiento activo: <span className="font-semibold text-slate-900">{activeEstablishmentName}</span>
        </div>
      ) : null}

      <div className="relative w-full">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar en alertas…"
          className="min-h-12 w-full rounded-3xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          aria-label="Buscar en alertas"
        />
      </div>

      {productosQuery.isLoading ? (
        <p className="text-base text-slate-500">Cargando stock…</p>
      ) : productosQuery.error ? (
        <p className="rounded-3xl border border-red-200 bg-red-50 p-4 text-base text-red-800">
          {(productosQuery.error as Error).message}
        </p>
      ) : !establecimientoId ? (
        <p className="text-base text-slate-500">Selecciona un establecimiento para ver el inventario.</p>
      ) : (
        <>
          <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="rounded-3xl border border-red-100 bg-white p-6 shadow-sm ring-1 ring-red-50">
              <p className="text-sm font-semibold uppercase tracking-wide text-red-700">Bajo mínimos</p>
              <p className="mt-2 text-xs text-red-600/90">Actual ≤ mínimo</p>
              <p className="mt-4 text-5xl font-bold tabular-nums tracking-tight text-red-600">{kpis.bajoMinimos}</p>
            </div>
            <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm ring-1 ring-blue-50">
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Total stock</p>
              <p className="mt-2 text-xs text-blue-600/90">Unidades en almacén</p>
              <p className="mt-4 text-5xl font-bold tabular-nums tracking-tight text-blue-600">{kpis.totalUnidades}</p>
            </div>
            <div className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm ring-1 ring-emerald-50">
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Pedidos hoy</p>
              <p className="mt-2 text-xs text-emerald-600/90">Registros tipo pedido hoy</p>
              <p className="mt-4 text-5xl font-bold tabular-nums tracking-tight text-emerald-600">{kpis.pedidosHoy}</p>
            </div>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              disabled={!pedidoGlobalUrl}
              onClick={() => pedidoGlobalUrl && window.open(pedidoGlobalUrl, "_blank", "noopener,noreferrer")}
              className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-3xl border border-emerald-200 bg-emerald-500 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-200 disabled:text-emerald-800/70"
            >
              <IconWhatsApp className="h-7 w-7 shrink-0 text-white" />
              Pedido global (WhatsApp)
            </button>
            {!bajoMinimos.length ? (
              <p className="text-sm text-slate-500">No hay artículos en alerta de stock.</p>
            ) : !pedidoGlobalUrl ? (
              <p className="text-sm text-slate-500">
                Hay artículos bajo mínimos; añade teléfono WhatsApp a un proveedor para el pedido global con varias líneas.
              </p>
            ) : null}
          </div>

          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Acción urgente</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {urgentes.length} producto{urgentes.length === 1 ? "" : "s"} requieren atención
                  {search.trim() ? " (filtrado)" : ""}
                </p>
              </div>
              <Link
                href="/stock"
                className="inline-flex min-h-12 shrink-0 items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm"
              >
                Ver inventario
              </Link>
            </div>

            {urgentes.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-base text-slate-600 shadow-sm">
                {bajoMinimos.length === 0
                  ? "Todo en orden: no hay productos por debajo del mínimo."
                  : "Ninguna alerta coincide con la búsqueda."}
              </div>
            ) : (
              <ul className="flex flex-col gap-4">
                {urgentes.map((p) => {
                  const hrefWa = waUrlProductoPedido(p);
                  const cant = Math.max(1, deficitPedido(p.stock_actual, p.stock_minimo));
                  return (
                    <li
                      key={p.id}
                      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100"
                    >
                      <p className="text-lg font-bold leading-snug text-slate-900">{p.articulo}</p>
                      <p className="mt-2 text-base text-slate-600">
                        Stock <span className="font-mono font-semibold tabular-nums text-slate-900">{p.stock_actual}</span>
                        {" · "}
                        Mín. <span className="font-mono font-semibold tabular-nums text-slate-900">{p.stock_minimo}</span>
                        {p.unidad ? <span className="text-slate-500"> ({p.unidad})</span> : null}
                      </p>
                      {p.proveedor?.nombre ? (
                        <p className="mt-1 text-sm text-slate-500">Proveedor: {p.proveedor.nombre}</p>
                      ) : null}
                      {hrefWa ? (
                        <a
                          href={hrefWa}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-3xl bg-emerald-500 px-4 py-3 text-base font-bold text-white shadow-sm hover:bg-emerald-600"
                        >
                          <IconWhatsApp className="h-7 w-7 text-white" />
                          Pedir por WhatsApp ({cant})
                        </a>
                      ) : (
                        <p className="mt-3 text-sm text-amber-800">No se pudo preparar el enlace de WhatsApp.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
