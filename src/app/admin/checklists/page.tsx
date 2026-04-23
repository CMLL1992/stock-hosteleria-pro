"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobileHeader } from "@/components/MobileHeader";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole } from "@/lib/permissions";

type RegistroRow = {
  id: string;
  tipo: string;
  completado_at: string;
  completado_por: string;
  establecimiento_id: string;
  nombreUsuario?: string | null;
  nombreEstablecimiento?: string | null;
};

export default function AdminChecklistsHistorialPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const isSuper = role === "superadmin";

  const [rows, setRows] = useState<RegistroRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSuper) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        const { data, error } = await supabase()
          .from("checklists_registros")
          .select("id,tipo,completado_at,completado_por,establecimiento_id")
          .order("completado_at", { ascending: false })
          .limit(400);
        if (error) throw error;
        const base = (data ?? []) as unknown as RegistroRow[];
        const uids = [...new Set(base.map((r) => r.completado_por).filter(Boolean))];
        const eids = [...new Set(base.map((r) => r.establecimiento_id).filter(Boolean))];
        const mapU = new Map<string, string>();
        const mapE = new Map<string, string>();
        if (uids.length) {
          const u = await supabase().from("usuarios").select("id,nombre_completo").in("id", uids);
          if (u.error) throw u.error;
          for (const row of (u.data ?? []) as { id: string; nombre_completo?: string | null }[]) {
            mapU.set(row.id, String(row.nombre_completo ?? "").trim());
          }
        }
        if (eids.length) {
          const e = await supabase().from("establecimientos").select("id,nombre").in("id", eids);
          if (e.error) throw e.error;
          for (const row of (e.data ?? []) as { id: string; nombre?: string | null }[]) {
            mapE.set(row.id, String(row.nombre ?? "").trim());
          }
        }
        const enriched = base.map((r) => ({
          ...r,
          nombreUsuario: mapU.get(r.completado_por) || null,
          nombreEstablecimiento: mapE.get(r.establecimiento_id) || null
        }));
        if (!cancelled) setRows(enriched);
      } catch (e) {
        if (!cancelled) setErr(supabaseErrToString(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuper]);

  const grouped = useMemo(() => {
    const m = new Map<string, RegistroRow[]>();
    for (const r of rows) {
      const d = String(r.completado_at ?? "").slice(0, 10) || "—";
      const key = `${d}|${r.establecimiento_id}`;
      const list = m.get(key) ?? [];
      list.push(r);
      m.set(key, list);
    }
    return Array.from(m.entries())
      .map(([key, list]) => {
        const [fecha, estId] = key.split("|");
        const nombreEst = list[0]?.nombreEstablecimiento || estId;
        return { key, fecha, nombreEst, list: list.sort((a, b) => String(b.completado_at).localeCompare(String(a.completado_at))) };
      })
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [rows]);

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!isSuper) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Checklists" showBack backHref="/admin" />
        <main className="mx-auto max-w-md p-4">
          <p className="text-sm text-slate-600">Solo superadmin puede ver el historial global de checklists.</p>
          <Link href="/checklist" className="mt-4 inline-block text-sm font-semibold text-slate-900 underline">
            Ir a mi checklist (móvil)
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Checklists" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 sm:px-5">
        <h1 className="text-xl font-semibold text-slate-900">Historial de checklists</h1>
        <p className="mt-1 text-sm text-slate-600">Completados por día y establecimiento.</p>
        <p className="mt-2 text-sm">
          <Link href="/admin/checklists/tareas" className="font-semibold text-slate-900 underline">
            Gestionar tareas del local activo
          </Link>
        </p>

        {err ? <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}
        {loading ? <p className="mt-4 text-sm text-slate-600">Cargando…</p> : null}

        {!loading && !rows.length ? (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Aún no hay registros.</p>
        ) : null}

        <div className="mt-6 space-y-6">
          {grouped.map((g) => (
            <section key={g.key} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{g.fecha}</h2>
                <p className="text-sm font-semibold text-slate-900">{g.nombreEst}</p>
              </div>
              <ul className="mt-3 divide-y divide-slate-100">
                {g.list.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="font-semibold text-slate-800">{r.tipo}</span>
                    <span className="tabular-nums text-slate-600">
                      {new Date(r.completado_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                    <span className="w-full text-xs text-slate-500 sm:w-auto">
                      {r.nombreUsuario?.trim() || r.completado_por.slice(0, 8) + "…"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
