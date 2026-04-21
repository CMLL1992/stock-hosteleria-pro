"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";

type RangeKey = "week" | "month" | "year";
type MetricKey = "units";

type Movimiento = {
  producto_id: string;
  tipo: "entrada" | "salida" | "pedido";
  cantidad: number;
  timestamp: string;
  producto?: { articulo: string } | null;
};

type ProductoStock = {
  id: string;
  stock_actual: number;
  stock_minimo: number | null;
};

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function sinceForRange(range: RangeKey): string {
  const d = new Date();
  if (range === "week") d.setDate(d.getDate() - 7);
  if (range === "month") d.setMonth(d.getMonth() - 1);
  if (range === "year") d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

async function fetchTopProductosSalida(range: RangeKey, establecimientoId: string | null) {
  if (!establecimientoId) return { rows: [], totals: { units: 0, cost: 0, profit: 0 } };
  const since = sinceForRange(range);
  const { data, error } = await supabase()
    .from("movimientos")
    .select("producto_id,tipo,cantidad,timestamp,producto:productos(articulo)")
    .eq("tipo", "salida")
    .eq("establecimiento_id", establecimientoId)
    .gte("timestamp", since)
    .order("timestamp", { ascending: false })
    .limit(5000);
  if (error) throw error;

  const rows = (data as unknown as Movimiento[]) ?? [];
  const byProduct = new Map<string, { name: string; units: number }>();
  for (const r of rows) {
    const name = r.producto?.articulo ?? "Producto";
    const units = Math.abs(Number(r.cantidad) || 0);
    const prev = byProduct.get(r.producto_id) ?? { name, units: 0 };
    prev.units += units;
    prev.name = name;
    byProduct.set(r.producto_id, prev);
  }

  return {
    rows: Array.from(byProduct.values()),
    totals: rows.reduce(
      (acc, r) => {
        const units = Math.abs(Number(r.cantidad) || 0);
        acc.units += units;
        return acc;
      },
      { units: 0, cost: 0, profit: 0 }
    )
  };
}

async function fetchResumen(range: RangeKey, establecimientoId: string | null) {
  if (!establecimientoId) {
    return { totalGastadoHoy: 0, costeHoy: 0, alertasStockBajo: 0, pedidosPendientes: 0, beneficioEstimado: 0 };
  }
  const since = sinceForRange(range);
  const sinceToday = startOfTodayISO();

  const [{ data: salidasHoy }, { data: prods }, { count: pedidosCount }] = await Promise.all([
    supabase()
      .from("movimientos")
      .select("cantidad")
      .eq("tipo", "salida")
      .eq("establecimiento_id", establecimientoId)
      .gte("timestamp", sinceToday),
    supabase().from("productos").select("id,stock_actual,stock_minimo").eq("establecimiento_id", establecimientoId),
    supabase()
      .from("movimientos")
      .select("id", { count: "exact", head: true })
      .eq("tipo", "pedido")
      .eq("establecimiento_id", establecimientoId)
      .gte("timestamp", since)
  ]);

  const salidasHoyRows = (salidasHoy as unknown as Array<{ cantidad: number }>) ?? [];
  const totalGastadoHoy = salidasHoyRows.reduce((acc, r) => acc + (Number(r.cantidad) || 0), 0);
  const costeHoy = 0;

  const productos = (prods as unknown as ProductoStock[]) ?? [];
  const alertasStockBajo = productos.filter((p) => {
    const min = typeof p.stock_minimo === "number" && Number.isFinite(p.stock_minimo) ? p.stock_minimo : null;
    if (min == null) return false;
    return (Number(p.stock_actual) || 0) < min;
  }).length;

  // No existe estado “pendiente” en esquema; contamos pedidos registrados en el rango como proxy.
  const pedidosPendientes = pedidosCount ?? 0;

  const beneficioEstimado = 0;

  return { totalGastadoHoy, costeHoy, alertasStockBajo, pedidosPendientes, beneficioEstimado };
}

export function DashboardClient() {
  const [range, setRange] = useState<RangeKey>("week");
  const [metric] = useState<MetricKey>("units");
  const { me, activeEstablishmentId: establecimientoId, activeEstablishmentName } = useActiveEstablishment();

  const topQuery = useQuery({
    queryKey: ["dashboard", "topSalida", range, establecimientoId],
    queryFn: () => fetchTopProductosSalida(range, establecimientoId),
    staleTime: 30_000,
    retry: 1
  });

  const resumenQuery = useQuery({
    queryKey: ["dashboard", "resumen", range, establecimientoId],
    queryFn: () => fetchResumen(range, establecimientoId),
    staleTime: 20_000,
    retry: 1
  });

  const raw = topQuery.data;
  const totals = raw?.totals ?? { units: 0, cost: 0, profit: 0 };

  const data = useMemo(() => {
    const topRows = raw?.rows ?? [];
    const sorted = [...topRows].sort((a, b) => b.units - a.units);
    return sorted.slice(0, 5).map((x) => ({
      nombre: x.name,
      cantidad: x.units
    }));
  }, [raw?.rows]);
  const resumen = resumenQuery.data;

  const pills = useMemo(
    () => [
      { key: "week" as const, label: "Semanal" },
      { key: "month" as const, label: "Mensual" },
      { key: "year" as const, label: "Anual" }
    ],
    []
  );

  return (
    <div className="space-y-4">
      {me?.isSuperadmin && activeEstablishmentName ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm">
          Cargando datos de <span className="font-semibold">{activeEstablishmentName}</span>…
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {pills.map((p) => {
            const active = range === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setRange(p.key)}
                className={[
                  "min-h-11 rounded-full px-4 text-sm font-semibold",
                  active ? "bg-black text-white" : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                ].join(" ")}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <a
          href="/stock"
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
        >
          Ver Stock
        </a>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Gráfico</span>
          <span className="min-h-10 rounded-full bg-black px-4 grid place-items-center text-sm font-semibold text-white">
            Unidades gastadas
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Total rango:{" "}
          <span className="font-mono">
            {`${Math.round(totals.units)} uds`}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Total gastado hoy</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">
            {resumenQuery.isLoading ? "—" : resumen?.totalGastadoHoy ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Coste aprox.: <span className="font-mono">{resumenQuery.isLoading ? "—" : (resumen?.costeHoy ?? 0).toFixed(2)} €</span>
          </p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Alertas de stock bajo</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">
            {resumenQuery.isLoading ? "—" : resumen?.alertasStockBajo ?? 0}
          </p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Pedidos pendientes</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">
            {resumenQuery.isLoading ? "—" : resumen?.pedidosPendientes ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">En el rango seleccionado</p>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold text-slate-500">Beneficio estimado</p>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-900">
          {resumenQuery.isLoading ? "—" : (resumen?.beneficioEstimado ?? 0).toFixed(2)} €
        </p>
        <p className="mt-1 text-xs text-slate-500">Basado en salidas del rango y escandallos (PVP/IVA - coste neto).</p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Top productos (salidas)</p>
            <p className="text-xs text-slate-600">
              5 productos más gastados según movimientos tipo “salida” ({metric === "units" ? "unidades" : "€ coste"}).
            </p>
          </div>
          <Button
            onClick={() => {
              void topQuery.refetch();
              void resumenQuery.refetch();
            }}
            className="min-h-11"
          >
            Actualizar
          </Button>
        </div>

        {topQuery.isLoading ? (
          <p className="text-sm text-slate-600">Cargando gráfico…</p>
        ) : topQuery.error ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {(topQuery.error as Error).message}
          </p>
        ) : data.length ? (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                <XAxis dataKey="nombre" tick={{ fill: "#0F172A", fontSize: 12 }} interval={0} />
                <YAxis tick={{ fill: "#64748B", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 16,
                    border: "1px solid #E2E8F0",
                    background: "white"
                  }}
                  labelStyle={{ color: "#0F172A", fontWeight: 600 }}
                />
                <Bar dataKey="cantidad" fill="#000000" radius={[12, 12, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Aún no hay salidas en este rango.</p>
        )}
      </div>
    </div>
  );
}

