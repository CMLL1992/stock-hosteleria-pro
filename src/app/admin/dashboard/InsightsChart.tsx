"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type CategoriaStockPoint = { name: string; total: number };

export function InsightsChart({ data }: { data: unknown }) {
  if (!Array.isArray(data)) {
    return <div className="py-8 text-center text-sm text-slate-500">Cargando estadísticas…</div>;
  }

  const safe = (data as CategoriaStockPoint[])
    .map((d) => ({ name: String(d?.name ?? "").trim() || "—", total: Number((d as { total?: unknown }).total ?? 0) || 0 }))
    .filter((d) => Number.isFinite(d.total) && d.total > 0);

  if (!safe.length) {
    return <div className="py-8 text-center text-sm text-slate-500">Cargando estadísticas…</div>;
  }

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={safe}
          margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
          barCategoryGap="18%"
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fontSize: 11, fill: "#475569" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              fontSize: "12px"
            }}
            formatter={(value) => [`${Number(value)} uds.`, "Stock"]}
          />
          <Bar dataKey="total" fill="#64748b" radius={[0, 8, 8, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
