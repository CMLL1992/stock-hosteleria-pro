"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { getEffectiveRole } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

type AlbaranRow = {
  id: string;
  establecimiento_id: string;
  proveedor_id: string | null;
  created_at: string;
  paths: string[] | null;
};

type AlbaranItemRow = {
  albaran_id: string;
  producto_id: string;
  precio_albaran: number | null;
};

type ProductoPrecioRow = {
  id: string;
  nombre?: string | null;
  articulo?: string | null;
  precio_compra?: number | null;
};

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function pct(from: number, to: number): number {
  if (!Number.isFinite(from) || from <= 0) return 0;
  return ((to - from) / from) * 100;
}

function isMissingTable(e: unknown): boolean {
  const anyErr = e as { code?: unknown; message?: unknown };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  return code === "PGRST205" || /could not find the table/i.test(msg);
}

export default function ControlAlbaranesPage() {
  const { data: me, isLoading } = useMyRole();
  const { activeEstablishmentId } = useActiveEstablishment();
  const role = getEffectiveRole(me ?? null);
  const isSuperadmin = role === "superadmin";

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [albaranes, setAlbaranes] = useState<AlbaranRow[]>([]);
  const [items, setItems] = useState<AlbaranItemRow[]>([]);
  const [productosById, setProductosById] = useState<Map<string, ProductoPrecioRow>>(new Map());

  const load = useCallback(async () => {
    if (!isSuperadmin || !activeEstablishmentId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await supabase()
        .from("albaranes")
        .select("id,establecimiento_id,proveedor_id,created_at,paths")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (res.error) throw res.error;
      const rows = ((res.data ?? []) as unknown as AlbaranRow[]) ?? [];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recent = rows.filter((r) => {
        const d = new Date(r.created_at);
        return d >= thirtyDaysAgo;
      });

      setAlbaranes(recent);

      if (!recent.length) {
        setItems([]);
        setProductosById(new Map());
        return;
      }

      const albIds = recent.map((x) => x.id);
      const itRes = await supabase()
        .from("albaran_items")
        .select("albaran_id,producto_id,precio_albaran")
        .in("albaran_id", albIds);

      if (itRes.error) throw itRes.error;
      const itRows = ((itRes.data ?? []) as unknown as AlbaranItemRow[]) ?? [];
      setItems(itRows);

      const prodIds = Array.from(new Set(itRows.map((x) => String(x.producto_id ?? "").trim()).filter(Boolean)));
      if (!prodIds.length) {
        setProductosById(new Map());
        return;
      }

      const pRes = await supabase()
        .from("productos")
        .select("id,nombre,articulo,precio_compra")
        .eq("establecimiento_id", activeEstablishmentId)
        .in("id", prodIds);
      if (pRes.error) throw pRes.error;
      const pRows = ((pRes.data ?? []) as unknown as ProductoPrecioRow[]) ?? [];
      const map = new Map<string, ProductoPrecioRow>();
      for (const p of pRows) map.set(String(p.id), p);
      setProductosById(map);
    } catch (e) {
      if (isMissingTable(e)) {
        setErr(
          "Falta la migración de Auditoría de albaranes: no existe `albaranes`/`albaran_items` en la base de datos. (La UI no rompe; solo muestra este aviso)."
        );
        setAlbaranes([]);
        setItems([]);
        setProductosById(new Map());
      } else {
        setErr(supabaseErrToString(e));
      }
    } finally {
      setLoading(false);
    }
  }, [activeEstablishmentId, isSuperadmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const alertsByAlbaran = useMemo(() => {
    const grouped = new Map<string, Array<{ msg: string; upPct: number }>>();
    for (const it of items) {
      const albId = String(it.albaran_id ?? "").trim();
      const pid = String(it.producto_id ?? "").trim();
      if (!albId || !pid) continue;
      const invoice = typeof it.precio_albaran === "number" ? it.precio_albaran : null;
      if (invoice === null || !Number.isFinite(invoice) || invoice <= 0) continue;

      const p = productosById.get(pid);
      const compra = typeof p?.precio_compra === "number" ? p.precio_compra : null;
      if (compra === null || !Number.isFinite(compra) || compra <= 0) continue;

      if (invoice > compra) {
        const nombre = String(p?.articulo ?? p?.nombre ?? pid).trim() || pid;
        const up = pct(compra, invoice);
        const msg = `${nombre}: Subió de ${compra.toFixed(2)}€ a ${invoice.toFixed(2)}€ ( +${up.toFixed(0)}% )`;
        const list = grouped.get(albId) ?? [];
        list.push({ msg, upPct: up });
        grouped.set(albId, list);
      }
    }
    for (const [, v] of grouped.entries()) v.sort((a, b) => b.upPct - a.upPct);
    return grouped;
  }, [items, productosById]);

  if (isLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;

  if (!isSuperadmin) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Auditoría de albaranes" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Acceso restringido</p>
            <p className="mt-1 text-sm text-slate-600">Solo Superadmin puede acceder a esta auditoría.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Auditoría de albaranes" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Control de costes</h1>
            <p className="mt-1 text-sm text-slate-600">
              Revisa recepciones recientes y detecta subidas de precio en albarán vs. precio de compra registrado.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !activeEstablishmentId}
            className="min-h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        {!activeEstablishmentId ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Selecciona un establecimiento para ver su auditoría.
          </div>
        ) : null}

        {err ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{err}</div> : null}

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <p className="text-sm font-semibold text-slate-900">Recepciones recientes</p>
            <p className="mt-0.5 text-xs text-slate-500">Solo se muestran las de los últimos 30 días.</p>
          </div>

          {albaranes.length === 0 ? (
            <div className="p-4">
              <p className="text-sm text-slate-600">No hay recepciones con albarán en los últimos 30 días.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {albaranes.map((a) => {
                const created = new Date(a.created_at);
                const ageDays = daysBetween(new Date(), created);
                const remaining = Math.max(0, 30 - ageDays);
                const alerts = alertsByAlbaran.get(a.id) ?? [];
                const bucket = "albaranes";
                const paths = (a.paths ?? []).filter(Boolean);
                return (
                  <li key={a.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Recepción</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {created.toLocaleString("es-ES")} · Se eliminará en {remaining} días
                        </p>
                      </div>
                      {alerts.length ? (
                        <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                          {alerts.length} alerta{alerts.length === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          Sin alertas
                        </span>
                      )}
                    </div>

                    {alerts.length ? (
                      <div className="mt-3 space-y-1">
                        {alerts.slice(0, 5).map((x, idx) => (
                          <p key={idx} className="text-sm text-slate-900">
                            {x.msg}
                          </p>
                        ))}
                        {alerts.length > 5 ? (
                          <p className="text-xs text-slate-500">… y {alerts.length - 5} más</p>
                        ) : null}
                      </div>
                    ) : null}

                    {paths.length ? (
                      <div className="mt-4">
                        <p className="text-xs font-semibold text-slate-700">Fotos del albarán</p>
                        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {paths.slice(0, 8).map((p) => {
                            const { data } = supabase().storage.from(bucket).getPublicUrl(p);
                            const url = data?.publicUrl ?? "";
                            return (
                              <a
                                key={p}
                                href={url || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                                title={p}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={url}
                                  alt="Albarán"
                                  className="h-20 w-full object-cover transition group-hover:scale-[1.02]"
                                  loading="lazy"
                                />
                              </a>
                            );
                          })}
                        </div>
                        {paths.length > 8 ? <p className="mt-2 text-xs text-slate-500">… y {paths.length - 8} más</p> : null}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">Sin fotos asociadas.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
          Nota: la auto-limpieza de Storage (borrado físico &gt; 30 días) requiere una tarea programada (Edge Function/Cron).
          Esta pantalla ya ignora entradas antiguas.
        </div>
      </main>
    </div>
  );
}

