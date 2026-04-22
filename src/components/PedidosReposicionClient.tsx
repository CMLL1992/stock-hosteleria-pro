"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { fetchDashboardProductos } from "@/lib/adminDashboardData";
import { deficitPedido, waUrlPedidoGlobal, waUrlProductoPedido } from "@/lib/whatsappPedido";

function unidadTitulo(u: string | null | undefined): string {
  const t = (u ?? "uds").trim() || "uds";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function PedidosReposicionClient() {
  const { activeEstablishmentId: establecimientoId } = useActiveEstablishment();
  const [search, setSearch] = useState("");

  const productosQuery = useQuery({
    queryKey: ["pedidos", "reposicion", establecimientoId],
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

  if (!establecimientoId) {
    return <p className="text-sm text-slate-600">Selecciona un establecimiento para preparar pedidos.</p>;
  }
  if (productosQuery.isLoading) return <p className="text-sm text-slate-600">Cargando…</p>;
  if (productosQuery.error) {
    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        {(productosQuery.error as Error).message}
      </p>
    );
  }

  return (
    <div className="w-full max-w-full space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Pedido de reposición</h2>
        <p className="text-sm text-slate-600">
          {urgentes.length} artículo{urgentes.length === 1 ? "" : "s"} bajo mínimos
          {search.trim() ? " (filtrado)" : ""}
        </p>
      </header>

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
          className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-3xl border border-slate-300 bg-slate-900 px-4 py-4 text-base font-semibold text-white shadow-md hover:bg-slate-950"
        >
          <IconWhatsApp className="h-7 w-7 shrink-0 text-white" />
          Enviar pedido completo por WhatsApp
        </button>
      ) : bajoMinimos.length > 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          Para un pedido completo, añade un teléfono de WhatsApp a algún proveedor. Mientras tanto, usa el botón de cada línea.
        </p>
      ) : null}

      {urgentes.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
          {bajoMinimos.length === 0 ? "No hay productos bajo mínimos." : "Ningún resultado coincide con la búsqueda."}
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
                  <p className="text-base font-semibold leading-snug text-slate-900">{p.articulo}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Stock <span className="font-mono font-semibold tabular-nums">{p.stock_actual}</span>
                    {" · "}
                    Mín. <span className="font-mono font-semibold tabular-nums">{p.stock_minimo}</span>
                    {p.unidad ? <span> · {unidadTitulo(p.unidad)}</span> : null}
                  </p>
                  {p.proveedor?.nombre ? <p className="mt-1 text-xs text-slate-500">Proveedor: {p.proveedor.nombre}</p> : null}
                  <p className="mt-2 text-sm font-semibold text-slate-900">A pedir: {cant}</p>
                </div>
                {hrefWa ? (
                  <a
                    href={hrefWa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[52px] w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 text-base font-semibold text-slate-800 shadow-sm hover:bg-slate-50 sm:w-auto sm:min-w-[160px]"
                  >
                    <IconWhatsApp className="h-6 w-6 text-slate-700" />
                    WhatsApp
                  </a>
                ) : (
                  <p className="text-sm text-slate-600">No se pudo generar el enlace.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

