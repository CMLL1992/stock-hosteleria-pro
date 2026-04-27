"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDashboardProductos } from "@/lib/adminDashboardData";
import { useCambiosGlobalesRealtime } from "@/lib/useCambiosGlobalesRealtime";
import { Drawer } from "@/components/ui/Drawer";
import { requireUserId } from "@/lib/session";
import { enqueueMovimiento, newClientUuid } from "@/lib/offlineQueue";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { fetchEscandallosPrecioMapByProductIds, type EscandalloPrecioRow } from "@/lib/fetchEscandallosPrecioMap";
import { logActivity } from "@/lib/activityLog";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";


export function DashboardClient() {
  const { activeEstablishmentId: establecimientoId, activeEstablishmentName, me } = useActiveEstablishment();
  const role = getEffectiveRole(me);
  const canSeePrices = hasPermission(role, "admin");
  const canManageEnvases = hasPermission(role, "admin");
  const queryClient = useQueryClient();
  const [envasesOpen, setEnvasesOpen] = useState(false);
  const [pedidoRapidoOpen, setPedidoRapidoOpen] = useState(false);
  const [confirmProd, setConfirmProd] = useState<null | { id: string; articulo: string; stock_vacios: number }>(null);
  const [confirming, setConfirming] = useState(false);
  const [envasesErr, setEnvasesErr] = useState<string | null>(null);

  useCambiosGlobalesRealtime({
    establecimientoId: establecimientoId ?? null,
    queryClient,
    queryKeys: [
      ["dashboard", "productos", establecimientoId],
      ["dashboard", "escandallos-precio", establecimientoId],
      ["productos", establecimientoId],
      ["movimientos", establecimientoId],
      // compatibilidad (algunas pantallas invalidan sin establecimiento)
      ["productos"],
      ["dashboard"],
      ["movimientos"]
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

  const escandallosPrecioQuery = useQuery({
    queryKey: ["dashboard", "escandallos-precio", establecimientoId, productosQuery.data],
    enabled: !!establecimientoId && canSeePrices && !!productosQuery.data?.length,
    queryFn: async () => {
      const ids = (productosQuery.data ?? []).map((p) => p.id).filter(Boolean);
      return await fetchEscandallosPrecioMapByProductIds(ids, establecimientoId);
    },
    staleTime: 30_000,
    retry: 1
  });

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

  const productosConVacios = useMemo(() => {
    return rows
      .filter((p) => Number(p.stock_vacios ?? 0) > 0)
      .sort((a, b) => Number(b.stock_vacios ?? 0) - Number(a.stock_vacios ?? 0));
  }, [rows]);

  const envasesCatalogoQuery = useQuery({
    queryKey: ["catalogo", "envases", establecimientoId],
    enabled: !!establecimientoId && rows.some((p) => !!(p.envase_catalogo_id ?? "").trim() && (p.envase_coste ?? null) == null),
    queryFn: async () => {
      const { data, error } = await supabase()
        .from("envases_catalogo")
        .select("id,coste")
        .eq("establecimiento_id", establecimientoId as string);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of ((data ?? []) as unknown as Array<Record<string, unknown>>)) {
        const id = String(r.id ?? "").trim();
        if (!id) continue;
        const c = Number(r.coste ?? 0);
        map.set(id, Number.isFinite(c) ? c : 0);
      }
      return map;
    },
    staleTime: 30_000,
    retry: 1
  });

  const valorEconomicoInventario = useMemo(() => {
    const catalogo = envasesCatalogoQuery.data ?? new Map<string, number>();
    const escById = escandallosPrecioQuery.data ?? new Map<string, EscandalloPrecioRow>();

    let envasesVaciosEUR = 0;
    let envasesLlenosEUR = 0;
    let stockRealSinEnvaseEUR = 0;

    for (const p of rows) {
      const envaseKey = String(p.envase_catalogo_id ?? "").trim();
      const costeDirecto = typeof p.envase_coste === "number" && Number.isFinite(p.envase_coste) ? p.envase_coste : null;
      const precioEnvase = envaseKey ? Math.max(0, costeDirecto ?? (catalogo.get(envaseKey) ?? 0)) : 0;

      // Contabilidad SaaS: el valor del inventario solo refleja stock físico.
      // Excluimos unidades pendientes de pedidos (pendiente/parcial) hasta que existan movimientos de entrada.
      const pendientes = Math.max(0, Number((p as { unidades_pendientes?: unknown }).unidades_pendientes ?? 0) || 0);
      const qty = Math.max(0, (Number(p.stock_actual ?? 0) || 0) - pendientes);
      const vacios = Math.max(0, Number(p.stock_vacios ?? 0) || 0);

      if (precioEnvase > 0) {
        envasesVaciosEUR += vacios * precioEnvase;
        envasesLlenosEUR += qty * precioEnvase;
      }

      // Stock real (sin envase), a coste neto SIN IVA:
      // coste = tarifa - descuento (%,€) - rappel
      const esc = escById.get(String(p.id)) ?? null;
      const tarifa = Math.max(0, esc?.precio_tarifa ?? 0);
      const descVal = Math.max(0, esc?.descuento_valor ?? 0);
      const rappel = Math.max(0, esc?.rappel_valor ?? 0);
      const descTipo = esc?.descuento_tipo ?? "%";
      const afterDesc = descTipo === "%" ? tarifa * (1 - descVal / 100) : tarifa - descVal;
      const costeNeto = Math.max(0, afterDesc - rappel);
      const costeSinEnvase = Math.max(0, costeNeto - (precioEnvase > 0 ? precioEnvase : 0));
      stockRealSinEnvaseEUR += qty * costeSinEnvase;
    }

    const totalEUR = envasesVaciosEUR + envasesLlenosEUR + stockRealSinEnvaseEUR;
    return { envasesVaciosEUR, envasesLlenosEUR, stockRealSinEnvaseEUR, totalEUR };
  }, [envasesCatalogoQuery.data, escandallosPrecioQuery.data, rows]);

  const coloresValoracion = useMemo(() => {
    return {
      stock: "#1D4ED8", // Azul (Premium)
      "env-llenos": "#F97316", // Naranja
      "env-vacios": "#10B981" // Verde
    } as const;
  }, []);

  const valoracionItems = useMemo(() => {
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const { envasesVaciosEUR, envasesLlenosEUR, stockRealSinEnvaseEUR, totalEUR } = valorEconomicoInventario;
    const totalOk = Math.max(0, Number(totalEUR) || 0);
    const items = [
      { key: "stock" as const, label: "Valor Stock Real", value: round2(stockRealSinEnvaseEUR), color: coloresValoracion.stock },
      { key: "env-llenos" as const, label: "Envases en Stock (llenos)", value: round2(envasesLlenosEUR), color: coloresValoracion["env-llenos"] },
      { key: "env-vacios" as const, label: "Envases Vacíos (a recuperar)", value: round2(envasesVaciosEUR), color: coloresValoracion["env-vacios"] }
    ];
    return items.map((x) => ({
      ...x,
      pct: totalOk > 0 ? Math.max(0, Math.min(1, (Number(x.value) || 0) / totalOk)) : 0
    }));
  }, [coloresValoracion, valorEconomicoInventario]);

  function formatEUR(n: number): string {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
  }

  async function confirmarDevolucionTotal() {
    if (!establecimientoId || !confirmProd) return;
    const cantidad = Math.max(0, Math.trunc(Number(confirmProd.stock_vacios ?? 0)));
    if (cantidad <= 0) {
      setConfirmProd(null);
      return;
    }
    setConfirming(true);
    setEnvasesErr(null);
    try {
      const usuario_id = await requireUserId();
      const payload = {
        client_uuid: newClientUuid(),
        producto_id: confirmProd.id,
        establecimiento_id: establecimientoId,
        tipo: "devolucion_proveedor" as const,
        cantidad,
        usuario_id,
        timestamp: new Date().toISOString()
      };

      if (typeof navigator !== "undefined" && navigator.onLine) {
        const { error } = await supabase().from("movimientos").upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
        if (error) throw error;
      } else {
        await enqueueMovimiento(payload);
      }

      // Optimistic: asumimos devolución completa
      queryClient.setQueryData(["dashboard", "productos", establecimientoId], (old) => {
        const prev = (old as typeof rows | undefined) ?? [];
        return prev.map((p) => (p.id === confirmProd.id ? { ...p, stock_vacios: 0 } : p));
      });
      queryClient.setQueryData(["productos", establecimientoId], (old) => {
        const prev = (old as typeof rows | undefined) ?? [];
        return prev.map((p) => (p.id === confirmProd.id ? { ...p, stock_vacios: 0 } : p));
      });

      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", establecimientoId] });
      await queryClient.invalidateQueries({ queryKey: ["productos", establecimientoId] });
      setConfirmProd(null);

      await logActivity({
        establecimientoId,
        icon: "envases",
        message: `Devolución de envases registrada: ${cantidad} · ${confirmProd.articulo}.`,
        metadata: { producto_id: confirmProd.id, cantidad }
      });
    } catch (e) {
      setEnvasesErr(supabaseErrToString(e));
    } finally {
      setConfirming(false);
    }
  }

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
        <button
          type="button"
          onClick={() => setPedidoRapidoOpen(true)}
          className="block rounded-3xl border-2 border-premium-orange/30 bg-white p-6 text-left shadow-md ring-2 ring-premium-orange/15 transition hover:bg-slate-50"
          aria-label="Bajo mínimos (pedido rápido)"
        >
          <p className="text-center text-xs font-bold uppercase tracking-wide text-red-700">Bajo mínimos</p>
          <p className="mt-1 text-center text-[11px] text-red-600/90">Stock actual ≤ stock mínimo</p>
          <p className="mt-4 text-center text-5xl font-black tabular-nums tracking-tight text-red-600">{bajoMinimos.length}</p>
          <p className="mt-3 text-center text-xs font-semibold text-slate-600">Toca para Pedido Rápido</p>
        </button>
        <button
          type="button"
          onClick={() => setEnvasesOpen(true)}
          className="block rounded-3xl border-2 border-premium-green/30 bg-gradient-to-br from-premium-green/10 via-white to-white p-6 text-left text-sm text-slate-700 shadow-md ring-1 ring-premium-green/20 hover:bg-slate-50"
        >
          <p className="text-sm font-black tracking-tight text-slate-900">Envases para devolver</p>
          <p className="mt-1 text-sm text-slate-700">Dinero a recuperar + control de vacíos.</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-premium-green/15 bg-white/70 p-3 text-center shadow-sm">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-600">Cajas</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">{vacios.cajas}</p>
            </div>
            <div className="rounded-2xl border border-premium-green/15 bg-white/70 p-3 text-center shadow-sm">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-600">Barriles</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">{vacios.barriles}</p>
            </div>
            <div className="rounded-2xl border border-premium-green/15 bg-white/70 p-3 text-center shadow-sm">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-600">Gas</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-slate-900">{vacios.gas}</p>
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
              <p className="mt-2 text-xs text-slate-500">
                {canManageEnvases ? "Toca para devolver envases." : "Solo lectura (sin permisos para registrar devoluciones)."}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Sin envases pendientes.</p>
          )}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/pedidos/recepcion"
          className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50"
        >
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Gestión</p>
          <p className="mt-1 text-lg font-black tracking-tight text-slate-900">GESTIONAR RECEPCIÓN</p>
          <p className="mt-1 text-sm text-slate-600">Confirmar pedido llegado (pendiente/parcial).</p>
        </Link>
        <Link
          href="/admin/pedidos"
          className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50"
        >
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Pedidos</p>
          <p className="mt-1 text-lg font-black tracking-tight text-slate-900">IR A PEDIDOS ACTIVOS</p>
          <p className="mt-1 text-sm text-slate-600">Preparar y enviar por proveedor.</p>
        </Link>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Valor económico del inventario</p>
        <p className="mt-1 text-sm text-slate-600">Resumen por establecimiento (EUR). Se recalcula con cada movimiento.</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
            {valoracionItems.map((it) => {
              const donutData = [
                { key: it.key, label: it.label, value: Math.max(0, Number(it.value) || 0), color: it.color },
                { key: `${it.key}-rest`, label: "resto", value: Math.max(0, (Number(valorEconomicoInventario.totalEUR) || 0) - (Number(it.value) || 0)), color: "#E2E8F0" }
              ];
              return (
                <div
                  key={it.key}
                  className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                  style={{ borderTopColor: it.color, borderTopWidth: 4 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{it.label}</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(it.value)}</p>
                    </div>
                    <span className="mt-1 inline-flex h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: it.color }} aria-hidden />
                  </div>

                  <div className="relative mt-3 h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Tooltip formatter={(v) => formatEUR(Number(v) || 0)} contentStyle={{ borderRadius: 12, borderColor: "#E2E8F0" }} />
                        <Pie data={donutData} dataKey="value" nameKey="label" innerRadius={44} outerRadius={62} paddingAngle={1}>
                          {donutData.map((d) => (
                            <Cell key={d.key} fill={(d as { color?: string }).color ?? "#94A3B8"} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                      <p className="text-sm font-extrabold tabular-nums text-slate-900">{Math.round(it.pct * 100)}%</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Total: <span className="font-semibold text-slate-700">{formatEUR(valorEconomicoInventario.totalEUR)}</span>
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Configura envases en <span className="font-semibold">Panel → Catálogo de envases</span>.
        </p>
      </section>

      <Drawer open={envasesOpen} title="Envases para devolver" onClose={() => setEnvasesOpen(false)}>
        <div className="space-y-3 pb-4">
          {envasesErr ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{envasesErr}</p>
          ) : null}

          {productosConVacios.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Sin envases pendientes.</p>
          ) : (
            <ul className="space-y-2">
              {productosConVacios.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-60"
                    onClick={() => {
                      if (!canManageEnvases) return;
                      setConfirmProd({ id: p.id, articulo: p.articulo, stock_vacios: p.stock_vacios });
                    }}
                    disabled={!canManageEnvases}
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{p.articulo}</span>
                    <span className="shrink-0 font-bold tabular-nums text-slate-900">{p.stock_vacios}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {confirmProd && canManageEnvases ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Confirmar devolución</p>
              <p className="mt-1 text-sm text-slate-700">
                Total de envases a devolver de este producto: <span className="font-bold">{confirmProd.stock_vacios}</span>
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                  onClick={() => setConfirmProd(null)}
                  disabled={confirming}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="min-h-12 rounded-2xl bg-black px-4 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                  onClick={() => void confirmarDevolucionTotal()}
                  disabled={confirming}
                >
                  {confirming ? "Registrando…" : "Confirmar"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Drawer>

      <Drawer open={pedidoRapidoOpen} title="Pedido rápido · Bajo mínimos" onClose={() => setPedidoRapidoOpen(false)}>
        <div className="space-y-3 pb-4">
          <p className="text-sm text-slate-600">
            Productos bajo mínimos: <span className="font-bold text-slate-900">{bajoMinimos.length}</span>
          </p>
          {bajoMinimos.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">No hay productos bajo mínimos.</p>
          ) : (
            <ul className="space-y-2">
              {bajoMinimos
                .slice()
                .sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }))
                .slice(0, 50)
                .map((p) => (
                  <li key={p.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">{p.articulo}</p>
                      <p className="shrink-0 font-bold tabular-nums text-slate-900">
                        {p.stock_actual} / {p.stock_minimo}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Stock actual / stock mínimo</p>
                  </li>
                ))}
            </ul>
          )}

          <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
            <Link
              href="/admin/pedidos?bajoMinimos=1"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-premium-blue px-4 text-sm font-semibold text-white hover:brightness-95"
              onClick={() => setPedidoRapidoOpen(false)}
            >
              Generar pedido
            </Link>
            <Link
              href="/admin/bajo-minimos"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              onClick={() => setPedidoRapidoOpen(false)}
            >
              Ver detalle
            </Link>
          </div>
          <p className="text-xs text-slate-500">
            “Generar pedido” abre Pedidos con filtro de bajo mínimos (sin tocar base de datos).
          </p>
        </div>
      </Drawer>
    </div>
  );
}
