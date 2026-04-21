"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MobileHeader } from "@/components/MobileHeader";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";

type ProdEmbed = { articulo?: string | null; nombre?: string | null };

type MovRow = {
  id: string;
  tipo: string;
  cantidad: number;
  timestamp: string;
  productos: ProdEmbed | ProdEmbed[] | null;
};

function supabaseErrToString(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e) {
    const anyErr = e as { message?: unknown; details?: unknown; hint?: unknown };
    const msg = typeof anyErr.message === "string" ? anyErr.message : "";
    const details = typeof anyErr.details === "string" ? anyErr.details : "";
    const hint = typeof anyErr.hint === "string" ? anyErr.hint : "";
    return [msg, details, hint].filter(Boolean).join(" · ") || "Error desconocido";
  }
  return String(e);
}

function labelTipo(t: string): string {
  if (t === "entrada") return "Entrada";
  if (t === "salida") return "Salida";
  if (t === "pedido") return "Pedido";
  return t;
}

export default function AdminMovimientosPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const { activeEstablishmentId } = useActiveEstablishment();
  const [rows, setRows] = useState<MovRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeEstablishmentId || !me?.isAdmin) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const resArticulo = await supabase()
        .from("movimientos")
        .select("id,tipo,cantidad,timestamp,productos(articulo)")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("timestamp", { ascending: false })
        .limit(150);

      const resNombre =
        resArticulo.error && supabaseErrToString(resArticulo.error).toLowerCase().includes("articulo")
          ? await supabase()
              .from("movimientos")
              .select("id,tipo,cantidad,timestamp,productos(nombre)")
              .eq("establecimiento_id", activeEstablishmentId)
              .order("timestamp", { ascending: false })
              .limit(150)
          : null;

      const data = resNombre?.data ?? resArticulo.data;
      const error = resNombre?.error ?? resArticulo.error;
      if (error) throw error;
      setRows((data as unknown as MovRow[]) ?? []);
    } catch (e) {
      setErr(supabaseErrToString(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeEstablishmentId, me?.isAdmin]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;

  if (!me?.isAdmin) {
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
          <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Cant.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const raw = r.productos;
                  const prod = Array.isArray(raw) ? raw[0] ?? null : raw;
                  const nombre =
                    (prod?.articulo && String(prod.articulo)) ||
                    (prod?.nombre && String(prod.nombre)) ||
                    "—";
                  const ts = new Date(r.timestamp);
                  return (
                    <tr key={r.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {ts.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="max-w-[140px] truncate px-3 py-2 font-medium text-slate-900">{nombre}</td>
                      <td className="px-3 py-2 text-slate-700">{labelTipo(r.tipo)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{r.cantidad}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link href="/admin" className="font-medium text-slate-700 underline">
            Volver al panel
          </Link>
        </p>
      </main>
    </div>
  );
}
