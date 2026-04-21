"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboardProductos } from "@/lib/adminDashboardData";
import { deficitPedido, waUrlPedidoGlobal, waUrlProductoPedido } from "@/lib/whatsappPedido";

function unidadTitulo(u: string | null | undefined): string {
  const t = (u ?? "uds").trim() || "uds";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function DashboardClient() {
  const { activeEstablishmentId: establecimientoId, activeEstablishmentName, me } = useActiveEstablishment();
  const [search, setSearch] = useState("");
  const [modoPedidoReposicion, setModoPedidoReposicion] = useState(false);

  const productosQuery = useQuery({
    queryKey: ["dashboard", "productos", establecimientoId],
    enabled: !!establecimientoId,
    queryFn: () => fetchDashboardProductos(establecimientoId as string),
    staleTime: 15_000,
    retry: 1
  });

  const rows = useMemo(() => productosQuery.data ?? [], [productosQuery.data]);

  const bajoMinimos = useMemo(() => rows.filter((p) => p.stock_actual <= p.stock_minimo), [rows]);

  const pedidoGlobalUrl = useMemo(() => waUrlPedidoGlobal(bajoMinimos), [bajoMinimos]);

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

  if (modoPedidoReposicion) {
    return (
      <div className="w-full max-w-full space-y-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModoPedidoReposicion(false)}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm active:bg-slate-50"
            aria-label="Volver al resumen"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900">Pedido de reposición</h2>
            <p className="text-sm text-slate-500">
              {urgentes.length} artículo{urgentes.length === 1 ? "" : "s"} bajo mínimos
              {search.trim() ? " (filtrado)" : ""}
            </p>
          </div>
        </div>

        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Buscar producto…"
            className="min-h-12 w-full rounded-3xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            aria-label="Buscar en pedido de reposición"
          />
        </div>

        {pedidoGlobalUrl ? (
          <button
            type="button"
            onClick={() => window.open(pedidoGlobalUrl, "_blank", "noopener,noreferrer")}
            className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-3xl border-2 border-emerald-600 bg-emerald-500 px-4 py-4 text-base font-bold text-white shadow-md hover:bg-emerald-600"
          >
            <IconWhatsApp className="h-8 w-8 shrink-0 text-white" />
            WhatsApp: pedido completo
          </button>
        ) : bajoMinimos.length > 0 ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Para un mensaje con todos los artículos, añade teléfono WhatsApp a un proveedor. Mientras tanto, usa el botón de cada línea.
          </p>
        ) : null}

        {urgentes.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-base text-slate-600 shadow-sm">
            {bajoMinimos.length === 0
              ? "No hay productos bajo mínimos. Buen trabajo."
              : "Ningún resultado coincide con la búsqueda."}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {urgentes.map((p) => {
              const hrefWa = waUrlProductoPedido(p);
              const diff = deficitPedido(p.stock_actual, p.stock_minimo);
              const cant = diff > 0 ? diff : Math.max(1, p.stock_minimo - p.stock_actual);
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold leading-snug text-slate-900">{p.articulo}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Stock <span className="font-mono font-semibold tabular-nums">{p.stock_actual}</span>
                      {" · "}
                      Mín. <span className="font-mono font-semibold tabular-nums">{p.stock_minimo}</span>
                      {p.unidad ? <span> · {unidadTitulo(p.unidad)}</span> : null}
                    </p>
                    {p.proveedor?.nombre ? <p className="mt-1 text-xs text-slate-500">Proveedor: {p.proveedor.nombre}</p> : null}
                    <p className="mt-2 text-sm font-semibold text-orange-700">A pedir: {cant}</p>
                  </div>
                  {hrefWa ? (
                    <a
                      href={hrefWa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[52px] w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-base font-bold text-white shadow-sm hover:bg-emerald-600 sm:w-auto sm:min-w-[160px]"
                    >
                      <IconWhatsApp className="h-7 w-7 text-white" />
                      WhatsApp
                    </a>
                  ) : (
                    <p className="text-sm text-amber-800">No se pudo generar el enlace.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
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
          <p className="font-semibold text-slate-900">Resumen</p>
          <p className="mt-2 leading-relaxed">
            Toca el botón inferior para preparar pedidos por WhatsApp con el texto profesional ya definido.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          setModoPedidoReposicion(true);
          setSearch("");
        }}
        className="flex min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 rounded-3xl border-2 border-slate-900 bg-slate-900 px-4 py-5 text-center shadow-xl active:scale-[0.99]"
      >
        <span className="text-2xl leading-none" aria-hidden>
          🛒
        </span>
        <span className="text-lg font-extrabold tracking-tight text-white">Generar Pedido de Reposición</span>
        <span className="text-xs font-medium text-slate-300">Filtra artículos bajo mínimos y abre WhatsApp</span>
      </button>

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
            {urgentes.map((p) => {
              const hrefWa = waUrlProductoPedido(p);
              const diff = deficitPedido(p.stock_actual, p.stock_minimo);
              const cant = diff > 0 ? diff : Math.max(1, p.stock_minimo - p.stock_actual);
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold leading-snug text-slate-900">{p.articulo}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Stock <span className="font-mono font-semibold tabular-nums">{p.stock_actual}</span>
                      {" · "}
                      Mín. <span className="font-mono font-semibold tabular-nums">{p.stock_minimo}</span>
                    </p>
                    <p className="mt-1 text-xs font-semibold text-orange-700">Reposición sugerida: {cant}</p>
                  </div>
                  {hrefWa ? (
                    <a
                      href={hrefWa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-600 sm:w-auto"
                    >
                      <IconWhatsApp className="h-6 w-6 text-white" />
                      WhatsApp
                    </a>
                  ) : (
                    <p className="text-xs text-amber-800">Sin enlace WhatsApp.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
