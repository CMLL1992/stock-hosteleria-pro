"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { Button } from "@/components/ui/Button";
import { useCambiosGlobalesRealtime } from "@/lib/useCambiosGlobalesRealtime";

type Tipo = "Apertura" | "Cierre";

type TareaRow = {
  id: string;
  titulo: string;
  orden: number;
  completada: boolean;
};

export function ChecklistClient() {
  const { activeEstablishmentId } = useActiveEstablishment();
  const [tipo, setTipo] = useState<Tipo>("Apertura");
  const [tareas, setTareas] = useState<TareaRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useCambiosGlobalesRealtime({
    establecimientoId: activeEstablishmentId,
    tables: ["checklists_tareas", "checklists_tareas_estado"],
    onChange: () => {
      void fetchTareas();
    }
  });

  const fetchTareas = useCallback(async () => {
    if (!activeEstablishmentId) {
      setTareas([]);
      setChecked(new Set());
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const { data, error } = await supabase()
        .from("checklists_tareas")
        .select("id,titulo,orden")
        .eq("establecimiento_id", activeEstablishmentId)
        .eq("activo", true)
        .eq("tipo", tipo)
        .order("orden", { ascending: true });
      if (error) throw error;
      const base = ((data ?? []) as unknown as Array<{ id: string; titulo: string; orden: number }>).filter((r) => !!r.id);

      // Estado compartido (si existe la tabla). Si no existe, seguimos sin persistencia global.
      const completedSet = new Set<string>();
      try {
        const ids = base.map((r) => r.id);
        if (ids.length) {
          const s = await supabase()
            .from("checklists_tareas_estado")
            .select("tarea_id,completada")
            .eq("establecimiento_id", activeEstablishmentId)
            .in("tarea_id", ids);
          if (!s.error) {
            for (const row of (s.data ?? []) as unknown as Array<{ tarea_id: string; completada: boolean }>) {
              if (row.completada) completedSet.add(String(row.tarea_id));
            }
          }
        }
      } catch {
        // ignore (tabla no existe / permisos / etc.)
      }

      const rows: TareaRow[] = base.map((r) => ({
        id: String(r.id),
        titulo: String(r.titulo ?? ""),
        orden: Math.trunc(Number(r.orden) || 0),
        completada: completedSet.has(String(r.id))
      }));
      setTareas(rows);
      setChecked(new Set(rows.filter((t) => t.completada).map((t) => t.id)));
    } catch (e) {
      setErr(supabaseErrToString(e));
      setTareas([]);
      setChecked(new Set());
    } finally {
      setLoading(false);
    }
  }, [activeEstablishmentId, tipo]);

  useEffect(() => {
    void fetchTareas();
  }, [fetchTareas]);

  const allChecked = useMemo(() => {
    if (!tareas.length) return false;
    return tareas.every((t) => checked.has(t.id));
  }, [tareas, checked]);

  function toggle(id: string) {
    if (!activeEstablishmentId) return;
    setChecked((prev) => {
      const next = new Set(prev);
      const willBeChecked = !next.has(id);
      if (willBeChecked) next.add(id);
      else next.delete(id);

      // Persistencia compartida (si la tabla existe). Si falla, mantenemos estado local.
      (async () => {
        try {
          const { data: auth } = await supabase().auth.getUser();
          const uid = auth?.user?.id ?? null;
          const payload = {
            establecimiento_id: activeEstablishmentId,
            tarea_id: id,
            completada: willBeChecked,
            updated_at: new Date().toISOString(),
            updated_by: uid
          };
          const { error } = await supabase()
            .from("checklists_tareas_estado")
            .upsert(payload, { onConflict: "establecimiento_id,tarea_id" });
          if (error) throw error;
        } catch {
          // ignore
        }
      })();

      setTareas((prevT) => prevT.map((t) => (t.id === id ? { ...t, completada: willBeChecked } : t)));
      return next;
    });
  }

  async function firmar() {
    if (!activeEstablishmentId) {
      setErr("Selecciona un establecimiento.");
      return;
    }
    if (!allChecked) return;
    setErr(null);
    setOk(null);
    setSaving(true);
    try {
      const { data: auth } = await supabase().auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) throw new Error("No hay sesión.");

      const { error } = await supabase().from("checklists_registros").insert({
        establecimiento_id: activeEstablishmentId,
        tipo,
        completado_por: uid
      });
      if (error) throw error;
      setOk("Checklist guardado. ¡Buen trabajo!");
      setChecked(new Set());
      setTimeout(() => setOk(null), 2400);
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  if (!activeEstablishmentId) {
    return (
      <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        No hay establecimiento activo. Un administrador debe asignarte sede o, si eres superadmin, elige local en la cabecera.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {err ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      ) : null}
      {ok ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{ok}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-100 p-1">
        {(["Apertura", "Cierre"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={[
              "min-h-11 rounded-xl text-sm font-bold transition",
              tipo === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            ].join(" ")}
            onClick={() => setTipo(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">Cargando tareas…</p>
      ) : tareas.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          No hay tareas de <strong>{tipo}</strong> para este local. Pide a un administrador que ejecute el SQL de checklists o que cree tareas.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {tareas.map((t) => {
            const on = checked.has(t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => toggle(t.id)}
                  className={[
                    "flex w-full min-h-[52px] items-start gap-3 px-4 py-3 text-left transition",
                    on ? "bg-emerald-50/80" : "hover:bg-slate-50 active:bg-slate-100"
                  ].join(" ")}
                >
                  <span
                    className={[
                      "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 text-sm font-bold",
                      on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-transparent"
                    ].join(" ")}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className={`text-base font-medium leading-snug ${on ? "text-emerald-950" : "text-slate-900"}`}>{t.titulo}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        onClick={() => void firmar()}
        disabled={!allChecked || saving || loading || !tareas.length}
        className="min-h-12 w-full"
      >
        {saving ? "Guardando…" : "Firmar y finalizar"}
      </Button>
      <p className="text-center text-xs text-slate-500">Se guarda la hora y tu usuario al completar todas las casillas.</p>
    </div>
  );
}
