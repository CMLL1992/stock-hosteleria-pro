"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { useQueryClient } from "@tanstack/react-query";

type EnvaseRow = {
  id: string;
  nombre: string;
  coste: number;
};

type ProductoOpt = { id: string; articulo: string; categoria: string };

function toNum(v: string): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function CatalogoEnvasesPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canView = hasPermission(role, "staff");
  const canManage = hasPermission(role, "admin");
  const { activeEstablishmentId } = useActiveEstablishment();
  const queryClient = useQueryClient();

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<EnvaseRow[]>([]);
  const [productos, setProductos] = useState<ProductoOpt[]>([]);

  const [coste, setCoste] = useState("0");
  const [productoId, setProductoId] = useState<string>("");
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
        // Envases del local + envases globales del sistema (establecimiento_id NULL)
        .or(`establecimiento_id.eq.${activeEstablishmentId},establecimiento_id.is.null`)
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
    if (!canView) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, activeEstablishmentId]);

  useEffect(() => {
    if (!canManage) return;
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const col = await resolveProductoTituloColumn(activeEstablishmentId);
        const t = tituloColSql(col);
        const { data, error } = await supabase()
          .from("productos")
          .select(`id,${t},categoria,tipo` as "*")
          .eq("establecimiento_id", activeEstablishmentId)
          .order(t, { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        const list = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
          id: String(r.id ?? ""),
          articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "—").trim() || "—",
          categoria: String(r.categoria ?? r.tipo ?? "Otros").trim() || "Otros"
        }));
        setProductos(list);
      } catch {
        if (!cancelled) setProductos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, canManage]);

  const disabled = useMemo(() => !activeEstablishmentId || !productoId || saving, [activeEstablishmentId, productoId, saving]);
  const productosByCat = useMemo(() => {
    const map = new Map<string, ProductoOpt[]>();
    for (const p of productos) {
      const k = p.categoria || "Otros";
      const arr = map.get(k) ?? [];
      arr.push(p);
      map.set(k, arr);
    }
    // Orden estable: categorías por nombre, productos por artículo
    const cats = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
    for (const c of cats) {
      map.set(
        c,
        (map.get(c) ?? []).slice().sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }))
      );
    }
    return { map, cats };
  }, [productos]);

  async function crear() {
    if (!activeEstablishmentId) return;
    setErr(null);
    setSaving(true);
    try {
      const prod = productos.find((p) => p.id === productoId) ?? null;
      if (!prod) throw new Error("Selecciona un producto válido.");
      const payload = {
        establecimiento_id: activeEstablishmentId,
        nombre: prod.articulo,
        coste: Math.max(0, toNum(coste))
      };
      const { data, error } = await supabase().from("envases_catalogo").insert(payload).select("id").maybeSingle();
      if (error) throw error;
      const envaseId = String((data as { id?: unknown } | null)?.id ?? "");

      if (envaseId) {
        const { error: updErr } = await supabase()
          .from("productos")
          .update({ envase_catalogo_id: envaseId })
          .eq("id", productoId)
          .eq("establecimiento_id", activeEstablishmentId);
        if (updErr) throw updErr;
      }
      setCoste("0");
      setProductoId("");
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["catalogo", "envases", activeEstablishmentId] });
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  async function eliminarEnvase(id: string, nombre: string) {
    if (!activeEstablishmentId) return;
    const ok = window.confirm(`¿Eliminar envase "${nombre}"? Se desvinculará de los productos (envase_catalogo_id = null).`);
    if (!ok) return;
    setErr(null);
    setSaving(true);
    try {
      const { error } = await supabase().from("envases_catalogo").delete().eq("id", id).eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["catalogo", "envases", activeEstablishmentId] });
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canView) {
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
          <p className="mt-1 text-sm text-slate-600">Selecciona un producto y define su coste de envase (1:1).</p>
        </div>

        {err ? <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}

        {canManage ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Nuevo envase (vinculado a producto)</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="sm:col-span-2">
                <span className="block text-xs font-bold uppercase tracking-wide text-slate-600">Producto (obligatorio)</span>
                <select
                  className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900"
                  value={productoId}
                  onChange={(e) => setProductoId(e.currentTarget.value)}
                >
                  <option value="">(Selecciona…)</option>
                  {productosByCat.cats.map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {(productosByCat.map.get(cat) ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.articulo}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-600">El nombre del envase será el del producto.</p>
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
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Catálogo de envases</p>
            <p className="mt-1 text-sm text-slate-600">Solo lectura. Solo Admin/Superadmin puede crear/eliminar envases.</p>
          </section>
        )}

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
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-sm font-bold tabular-nums text-slate-900">
                      {(Number(r.coste ?? 0) || 0).toFixed(2)} €
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className="min-h-10 rounded-xl border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        onClick={() => void eliminarEnvase(r.id, r.nombre)}
                        disabled={saving}
                      >
                        Eliminar
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

