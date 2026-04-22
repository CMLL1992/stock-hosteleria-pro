"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MobileHeader } from "@/components/MobileHeader";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";

type ProdEmbed = { articulo?: string | null; nombre?: string | null };
type UsuarioEmbed = { email?: string | null };

type MovRow = {
  id: string;
  tipo: string;
  cantidad: number;
  timestamp: string;
  genera_vacio?: boolean | null;
  usuarios?: UsuarioEmbed | UsuarioEmbed[] | null;
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
  if (t === "entrada_compra") return "Entrada (compra)";
  if (t === "salida") return "Salida";
  if (t === "pedido") return "Pedido";
  if (t === "salida_barra") return "Salida a barra";
  if (t === "entrada_vacio") return "Entrada de vacío";
  if (t === "devolucion_proveedor") return "Devolución a proveedor";
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
      const col = await resolveProductoTituloColumn(activeEstablishmentId);
      const t = tituloColSql(col);
      const resArticulo = await supabase()
        .from("movimientos")
        .select(`id,tipo,cantidad,timestamp,genera_vacio,productos(${t}),usuarios(email)` as "*")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("timestamp", { ascending: false })
        .limit(150);

      if (resArticulo.error) throw resArticulo.error;
      const data = resArticulo.data;
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
          <ul className="mt-4 flex flex-col gap-2" aria-label="Movimientos recientes">
            {rows.map((r) => {
              const raw = r.productos;
              const prod = Array.isArray(raw) ? raw[0] ?? null : raw;
              const articuloEtiqueta =
                String(prod?.articulo ?? prod?.nombre ?? "")
                  .trim() || "—";
              const rawU = r.usuarios ?? null;
              const u = Array.isArray(rawU) ? rawU[0] ?? null : rawU;
              const email = String(u?.email ?? "").trim();
              const ts = new Date(r.timestamp);
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug text-slate-900">{articuloEtiqueta}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {ts.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })} · {labelTipo(r.tipo)}
                      {r.tipo === "salida_barra" && r.genera_vacio ? " · genera vacío" : ""}
                      {email ? ` · ${email}` : ""}
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
            Volver al panel
          </Link>
        </p>
      </main>
    </div>
  );
}
