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
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ChecklistTipo = "Apertura" | "Cierre";
type ChecklistTask = { id: string; tipo: ChecklistTipo; titulo: string; orden: number; activo: boolean; completada: boolean };

export function DashboardClient() {
  const { activeEstablishmentId: establecimientoId, activeEstablishmentName, me } = useActiveEstablishment();
  const role = getEffectiveRole(me);
  const canSeePrices = hasPermission(role, "admin");
  const canManageEnvases = hasPermission(role, "admin");
  const queryClient = useQueryClient();
  const [envasesOpen, setEnvasesOpen] = useState(false);
  const [confirmProd, setConfirmProd] = useState<null | { id: string; articulo: string; stock_vacios: number }>(null);
  const [confirming, setConfirming] = useState(false);
  const [envasesErr, setEnvasesErr] = useState<string | null>(null);

  useCambiosGlobalesRealtime({
    establecimientoId: establecimientoId ?? null,
    queryClient,
    queryKeys: [
      ["dashboard", "productos", establecimientoId],
      ["dashboard", "checklist-estado", establecimientoId],
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

  const checklistQuery = useQuery({
    queryKey: ["dashboard", "checklist-estado", establecimientoId],
    enabled: !!establecimientoId,
    queryFn: async (): Promise<ChecklistTask[]> => {
      if (!establecimientoId) return [];
      const tareasRes = await supabase()
        .from("checklists_tareas")
        .select("id,tipo,titulo,orden,activo")
        .eq("establecimiento_id", establecimientoId)
        .eq("activo", true)
        .order("tipo", { ascending: true })
        .order("orden", { ascending: true });
      if (tareasRes.error) throw tareasRes.error;
      const base = (tareasRes.data ?? []) as unknown as Array<{ id: string; tipo: string; titulo: string; orden: number; activo: boolean }>;
      const ids = base.map((t) => String(t.id)).filter(Boolean);

      const completadas = new Set<string>();
      if (ids.length) {
        const s = await supabase()
          .from("checklists_tareas_estado")
          .select("tarea_id,completada")
          .eq("establecimiento_id", establecimientoId)
          .in("tarea_id", ids);
        if (!s.error) {
          for (const row of (s.data ?? []) as unknown as Array<{ tarea_id: string; completada: boolean }>) {
            if (row.completada) completadas.add(String(row.tarea_id));
          }
        }
      }

      return base.map((t) => ({
        id: String(t.id),
        tipo: t.tipo === "Cierre" ? "Cierre" : "Apertura",
        titulo: String(t.titulo ?? ""),
        orden: Math.trunc(Number(t.orden) || 0),
        activo: Boolean(t.activo),
        completada: completadas.has(String(t.id))
      }));
    },
    staleTime: 10_000,
    retry: 1
  });

  const checklistPendientes = useMemo(() => (checklistQuery.data ?? []).filter((t) => !t.completada), [checklistQuery.data]);
  const checklistResumen = useMemo(() => {
    const all = checklistQuery.data ?? [];
    const total = all.length;
    const done = all.filter((t) => t.completada).length;
    return { total, done, pending: Math.max(0, total - done) };
  }, [checklistQuery.data]);

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

  const valorStock = useMemo(() => {
    // Valor del stock actual a coste neto SIN IVA:
    // coste = tarifa - descuento (%,€) - rappel
    let total = 0;
    const escById = escandallosPrecioQuery.data ?? new Map<string, EscandalloPrecioRow>();
    for (const p of rows) {
      const esc = escById.get(p.id) ?? null;
      const tarifa = Math.max(0, esc?.precio_tarifa ?? 0);
      const descVal = Math.max(0, esc?.descuento_valor ?? 0);
      const rappel = Math.max(0, esc?.rappel_valor ?? 0);
      const descTipo = esc?.descuento_tipo ?? "%";
      const afterDesc = descTipo === "%" ? tarifa * (1 - descVal / 100) : tarifa - descVal;
      const coste = Math.max(0, afterDesc - rappel);
      // Contabilidad SaaS: el valor de stock solo refleja stock físico.
      // Excluimos unidades pendientes de pedidos (pendiente/parcial) hasta que existan movimientos de entrada.
      const pendientes = Math.max(0, Number((p as { unidades_pendientes?: unknown }).unidades_pendientes ?? 0) || 0);
      const qty = Math.max(0, (Number(p.stock_actual ?? 0) || 0) - pendientes);
      total += qty * coste;
    }
    return total;
  }, [escandallosPrecioQuery.data, rows]);

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

  const valorEnvases = useMemo(() => {
    const catalogo = envasesCatalogoQuery.data ?? new Map<string, number>();
    let total = 0;
    for (const p of rows) {
      const envaseKey = (p.envase_catalogo_id ?? "").trim();
      // Sin vínculo al catálogo: no inventamos valor (sin fallback al sistema antiguo).
      if (!envaseKey) continue;
      const costeDirecto = typeof p.envase_coste === "number" && Number.isFinite(p.envase_coste) ? p.envase_coste : null;
      const precioPorEnvase = Math.max(0, costeDirecto ?? (catalogo.get(envaseKey) ?? 0));
      if (precioPorEnvase <= 0) continue;
      const vacios = Math.max(0, Number(p.stock_vacios ?? 0) || 0);
      if (vacios <= 0) continue;
      total += vacios * precioPorEnvase;
    }
    return total;
  }, [envasesCatalogoQuery.data, rows]);

  const barrasResumen = useMemo(() => {
    return [
      { key: "stock", label: "Stock", value: Math.round((valorStock + Number.EPSILON) * 100) / 100 },
      { key: "envases", label: "Envases", value: Math.round((valorEnvases + Number.EPSILON) * 100) / 100 }
    ];
  }, [valorEnvases, valorStock]);

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
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Estado del Establecimiento</p>
        <p className="mt-1 text-sm text-slate-600">Checklist activo (en tiempo real) del local.</p>

        {checklistQuery.isError ? (
          <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {(checklistQuery.error as Error).message}
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Completadas</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{checklistResumen.done}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Pendientes</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{checklistResumen.pending}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{checklistResumen.total}</p>
            </div>
          </div>
        )}

        {checklistPendientes.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Pendientes (top)</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {checklistPendientes.slice(0, 6).map((t) => (
                <li key={t.id} className="truncate">
                  <span className="font-semibold">{t.tipo}:</span> {t.titulo}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Completa tareas desde <Link className="font-semibold underline" href="/checklist">Checklist</Link>.
            </p>
          </div>
        ) : checklistQuery.data?.length ? (
          <p className="mt-4 text-xs text-slate-500">Todo el checklist activo está completado.</p>
        ) : (
          <p className="mt-4 text-xs text-slate-500">No hay tareas activas configuradas para este local.</p>
        )}
      </section>

      {me?.isSuperadmin && activeEstablishmentName ? (
        <div className="w-full rounded-3xl border border-slate-100 bg-white p-4 text-base text-slate-600 shadow-sm">
          Establecimiento activo: <span className="font-semibold text-slate-900">{activeEstablishmentName}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/bajo-minimos"
          className="block rounded-3xl border-2 border-red-200 bg-white p-6 shadow-md ring-2 ring-red-100 transition hover:bg-slate-50"
          aria-label="Bajo mínimos"
        >
          <p className="text-center text-xs font-bold uppercase tracking-wide text-red-700">Bajo mínimos</p>
          <p className="mt-1 text-center text-[11px] text-red-600/90">Stock actual ≤ stock mínimo</p>
          <p className="mt-4 text-center text-5xl font-black tabular-nums tracking-tight text-red-600">{bajoMinimos.length}</p>
        </Link>
        <button
          type="button"
          onClick={() => setEnvasesOpen(true)}
          className="block rounded-3xl border border-slate-200 bg-white p-6 text-left text-sm text-slate-600 shadow-sm hover:bg-slate-50"
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
              <p className="mt-2 text-xs text-slate-500">
                {canManageEnvases ? "Toca para devolver envases." : "Solo lectura (sin permisos para registrar devoluciones)."}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Sin envases pendientes.</p>
          )}
        </button>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Valoración</p>
        <p className="mt-1 text-sm text-slate-600">Valor del stock (coste) y valor de envases (coste/fianza).</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Valor stock</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(valorStock)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Valor envases</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(valorEnvases)}</p>
          </div>
        </div>
        <div className="mt-4 h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barrasResumen} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="label" tick={{ fill: "#334155", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748B", fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip
                formatter={(v) => formatEUR(Number(v) || 0)}
                contentStyle={{ borderRadius: 12, borderColor: "#E2E8F0" }}
              />
              <Bar dataKey="value" radius={[10, 10, 10, 10]}>
                {barrasResumen.map((d) => (
                  <Cell key={d.key} fill={d.key === "stock" ? "#0F172A" : "#334155"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
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
    </div>
  );
}
