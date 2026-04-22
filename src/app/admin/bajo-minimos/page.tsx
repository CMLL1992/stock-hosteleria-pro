"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MobileHeader } from "@/components/MobileHeader";
import { useMyRole } from "@/lib/useMyRole";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { fetchDashboardProductos } from "@/lib/adminDashboardData";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useTranslations } from "next-intl";

export default function BajoMinimosPage() {
  const { data: me, isLoading } = useMyRole();
  const { activeEstablishmentId } = useActiveEstablishment();
  const t = useTranslations();

  const q = useQuery({
    queryKey: ["admin", "bajo-minimos", activeEstablishmentId],
    enabled: !!activeEstablishmentId && !!me?.isAdmin,
    queryFn: () => fetchDashboardProductos(activeEstablishmentId as string),
    staleTime: 15_000,
    retry: 1
  });

  const list = useMemo(() => {
    const rows = q.data ?? [];
    return rows
      .filter((p) => p.stock_actual <= p.stock_minimo)
      .slice()
      .sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }));
  }, [q.data]);

  if (isLoading) return <main className="p-4 text-base text-slate-600">{t("common.loading")}</main>;
  if (!me?.isAdmin) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold text-slate-900">{t("status.low")}</h1>
        <p className="mt-2 text-sm text-slate-500">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title={t("status.low")} showBack backHref="/admin/dashboard" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <p className="text-sm text-slate-600">{t("dashboard.lowStockHint")}</p>

        {q.error ? (
          <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {supabaseErrToString(q.error)}
          </p>
        ) : q.isLoading ? (
          <p className="mt-4 text-sm text-slate-600">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            {t("dashboard.lowStockEmpty")}
          </p>
        ) : (
          <ul className="mt-4 space-y-2" aria-label="Productos bajo mínimos">
            {list.map((p) => (
              <li key={p.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">{p.articulo}</p>
                  <p className="shrink-0 font-bold tabular-nums text-slate-900">
                    {p.stock_actual} / {p.stock_minimo}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500">{t("dashboard.stockRatioHint")}</p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

