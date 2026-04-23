"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

type EnvaseRow = {
  id: string;
  nombre: string;
  coste: number;
};

function toNum(v: string): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function CatalogoEnvasesPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canManage = hasPermission(role, "admin");
  const { activeEstablishmentId } = useActiveEstablishment();

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<EnvaseRow[]>([]);

  const [nombre, setNombre] = useState("");
  const [coste, setCoste] = useState("0");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    if (!activeEstablishmentId) {
      setRows([]);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const { data, error } = await supabase()
        .from("envases_catalogo")
        .select("id,nombre,coste")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("nombre", { ascending: true });
      if (error) throw error;
      setRows(((data ?? []) as unknown as EnvaseRow[]) ?? []);
    } catch (e) {
      setErr(supabaseErrToString(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canManage) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, activeEstablishmentId]);

  const disabled = useMemo(() => !activeEstablishmentId || !nombre.trim() || saving, [activeEstablishmentId, nombre, saving]);

  async function crear() {
    if (!activeEstablishmentId) return;
    setErr(null);
    setSaving(true);
    try {
      const payload = {
        establecimiento_id: activeEstablishmentId,
        nombre: nombre.trim(),
        coste: Math.max(0, toNum(coste))
      };
      const { error } = await supabase().from("envases_catalogo").insert(payload);
      if (error) throw error;
      setNombre("");
      setCoste("0");
      await refresh();
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canManage) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Catálogo de envases" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <p className="text-sm text-slate-600">Acceso denegado.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Catálogo de envases" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Catálogo de envases</h1>
          <p className="mt-1 text-sm text-slate-600">Crea envases con coste real y asígnalos a productos.</p>
        </div>

        {err ? <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Nuevo envase</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="sm:col-span-2">
              <span className="block text-xs font-bold uppercase tracking-wide text-slate-600">Nombre</span>
              <input
                className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900"
                value={nombre}
                onChange={(e) => setNombre(e.currentTarget.value)}
                placeholder="Caja cerveza, Barril 30L, Botella vidrio…"
              />
            </label>
            <label>
              <span className="block text-xs font-bold uppercase tracking-wide text-slate-600">Coste (€)</span>
              <input
                className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base tabular-nums text-slate-900"
                value={coste}
                onChange={(e) => setCoste(e.currentTarget.value)}
                inputMode="decimal"
              />
            </label>
          </div>
          <div className="mt-3">
            <Button onClick={crear} disabled={disabled}>
              {saving ? "Creando…" : "Crear envase"}
            </Button>
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Envases</p>
            <button
              type="button"
              className="min-h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void refresh()}
              disabled={loading || !activeEstablishmentId}
            >
              {loading ? "Cargando…" : "Recargar"}
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No hay envases todavía.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{r.nombre}</span>
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-slate-900">
                    {(Number(r.coste ?? 0) || 0).toFixed(2)} €
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

