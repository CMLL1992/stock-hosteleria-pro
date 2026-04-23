"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobileHeader } from "@/components/MobileHeader";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

type ProdEmbed = { articulo?: string | null; nombre?: string | null };

type MovRow = {
  id: string;
  tipo: string;
  cantidad: number;
  timestamp: string;
  genera_vacio?: boolean | null;
  usuario_id?: string | null;
  productos: ProdEmbed | ProdEmbed[] | null;
};

type PeriodKey = "hoy" | "semana" | "mes";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function iso(d: Date): string {
  return d.toISOString();
}

export default function AdminMovimientosPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const { activeEstablishmentId } = useActiveEstablishment();
  const role = getEffectiveRole(me ?? null);
  const canAccessMovimientos = hasPermission(role, "admin");
  const [rows, setRows] = useState<MovRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>("hoy");

  const locale = "es-ES";
  function labelTipo(tipo: string): string {
    if (tipo === "entrada") return "Entrada";
    if (tipo === "entrada_compra") return "Entrada (compra)";
    if (tipo === "salida") return "Salida";
    if (tipo === "pedido") return "Pedido";
    if (tipo === "salida_barra") return "Salida a barra";
    if (tipo === "entrada_vacio") return "Entrada de vacío";
    if (tipo === "devolucion_envase") return "Devolución envase";
    if (tipo === "devolucion_proveedor") return "Devolución a proveedor";
    return tipo;
  }

  const range = useMemo(() => {
    const now = new Date();
    const hoy = startOfDay(now);
    const semana = new Date(now);
    semana.setDate(semana.getDate() - 7);
    const semanaStart = startOfDay(semana);
    const mesStart = startOfMonth(now);

    if (period === "hoy") return { from: hoy, to: null as Date | null };
    if (period === "semana") return { from: semanaStart, to: null as Date | null };
    // "Este mes": resto del mes actual, excluyendo la última semana (para segmentar sin solaparse)
    return { from: mesStart, to: semanaStart };
  }, [period]);

  const load = useCallback(async () => {
    if (!activeEstablishmentId || !canAccessMovimientos) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const col = await resolveProductoTituloColumn(activeEstablishmentId);
      const t = tituloColSql(col);
      let q = supabase()
        .from("movimientos")
        // Nota: no hacemos join con 'usuarios' porque no existe relación en Supabase.
        .select(`id,tipo,cantidad,timestamp,genera_vacio,usuario_id,productos(${t})` as "*")
        .eq("establecimiento_id", activeEstablishmentId)
        .gte("timestamp", iso(range.from))
        .order("timestamp", { ascending: false });

      if (range.to) q = q.lt("timestamp", iso(range.to));

      const resArticulo = await q.limit(200);

      if (resArticulo.error) throw resArticulo.error;
      const data = resArticulo.data;
      setRows((data as unknown as MovRow[]) ?? []);
    } catch (e) {
      setErr(supabaseErrToString(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeEstablishmentId, canAccessMovimientos, range.from, range.to]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;

  if (!canAccessMovimientos) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Movimientos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4">
          <p className="text-sm text-slate-600">Acceso denegado.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Movimientos" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <p className="text-sm text-slate-600">Últimos movimientos del establecimiento activo.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { key: "hoy", label: "Hoy" },
              { key: "semana", label: "Esta semana" },
              { key: "mes", label: "Este mes" }
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setPeriod(t.key)}
              className={[
                "min-h-10 rounded-2xl border px-3 text-sm font-semibold",
                period === t.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {err ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}

        {!activeEstablishmentId ? (
          <p className="mt-4 text-sm text-slate-600">Selecciona un establecimiento para ver el histórico.</p>
        ) : loading ? (
          <p className="mt-4 text-sm text-slate-600">Cargando movimientos…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            No hay movimientos registrados todavía.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2" aria-label="Movimientos">
            {rows.map((r) => {
              const raw = r.productos;
              const prod = Array.isArray(raw) ? raw[0] ?? null : raw;
              const articuloEtiqueta =
                String(prod?.articulo ?? prod?.nombre ?? "")
                  .trim() || "—";
              const uid = String(r.usuario_id ?? "").trim();
              const uidShort = uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : "";
              const ts = new Date(r.timestamp);
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug text-slate-900">{articuloEtiqueta}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {ts.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })} · {labelTipo(r.tipo)}
                      {r.tipo === "salida_barra" && r.genera_vacio ? " · genera vacío" : ""}
                      {uidShort ? ` · ${uidShort}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-bold tabular-nums text-slate-900">{r.cantidad}</p>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link href="/admin" className="font-medium text-slate-700 underline">
            Volver
          </Link>
        </p>
      </main>
    </div>
  );
}
