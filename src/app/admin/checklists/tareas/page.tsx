"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobileHeader } from "@/components/MobileHeader";
import { Button } from "@/components/ui/Button";
import { DangerConfirmModal } from "@/components/ui/DangerConfirmModal";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";

type Tipo = "Apertura" | "Cierre";

type TareaRow = {
  id: string;
  tipo: Tipo;
  titulo: string;
  orden: number;
  activo: boolean;
};

function sortTareas(a: TareaRow, b: TareaRow): number {
  const ta = a.tipo === "Apertura" ? 0 : 1;
  const tb = b.tipo === "Apertura" ? 0 : 1;
  if (ta !== tb) return ta - tb;
  return a.orden - b.orden || a.titulo.localeCompare(b.titulo, "es");
}

export default function ChecklistTareasAdminPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canManage = hasPermission(role, "admin");

  const { activeEstablishmentId } = useActiveEstablishment();

  const [items, setItems] = useState<TareaRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [nuevoTipo, setNuevoTipo] = useState<Tipo>("Apertura");
  const [nuevoTitulo, setNuevoTitulo] = useState("");
  const [nuevoOrden, setNuevoOrden] = useState("");

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTareas = useCallback(async () => {
    if (!activeEstablishmentId || !canManage) {
      setItems([]);
      setLoading(false);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const { data, error } = await supabase()
        .from("checklists_tareas")
        .select("id,tipo,titulo,orden,activo")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("tipo", { ascending: true })
        .order("orden", { ascending: true });
      if (error) throw error;
      const rows = ((data ?? []) as unknown as TareaRow[]).map((r) => ({
        id: String(r.id),
        tipo: (r.tipo === "Cierre" ? "Cierre" : "Apertura") as Tipo,
        titulo: String(r.titulo ?? ""),
        orden: Math.trunc(Number(r.orden) || 0),
        activo: Boolean(r.activo)
      }));
      setItems(rows.sort(sortTareas));
    } catch (e) {
      setErr(supabaseErrToString(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeEstablishmentId, canManage]);

  useEffect(() => {
    void fetchTareas();
  }, [fetchTareas]);

  const porTipo = useMemo(() => {
    const ap = items.filter((x) => x.tipo === "Apertura");
    const ci = items.filter((x) => x.tipo === "Cierre");
    return { Apertura: ap, Cierre: ci };
  }, [items]);

  function nextOrden(tipo: Tipo): number {
    const list = tipo === "Apertura" ? porTipo.Apertura : porTipo.Cierre;
    const max = list.reduce((m, x) => Math.max(m, x.orden), 0);
    return max + 1;
  }

  async function guardarFila(t: TareaRow) {
    if (!activeEstablishmentId) return;
    const titulo = t.titulo.trim();
    if (!titulo) {
      setErr("El título no puede estar vacío.");
      return;
    }
    setErr(null);
    setOk(null);
    setSavingId(t.id);
    try {
      const { error } = await supabase()
        .from("checklists_tareas")
        .update({
          titulo,
          orden: Math.max(0, Math.trunc(Number(t.orden) || 0)),
          activo: t.activo,
          tipo: t.tipo
        })
        .eq("id", t.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      setOk("Cambios guardados.");
      window.setTimeout(() => setOk(null), 1600);
      await fetchTareas();
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSavingId(null);
    }
  }

  function patchLocal(id: string, patch: Partial<TareaRow>) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)).sort(sortTareas));
  }

  async function anadir() {
    if (!activeEstablishmentId) return;
    const titulo = nuevoTitulo.trim();
    if (!titulo) {
      setErr("Escribe un título para la nueva tarea.");
      return;
    }
    const orden =
      nuevoOrden.trim() === "" ? nextOrden(nuevoTipo) : Math.max(0, Math.trunc(Number(nuevoOrden.replace(",", ".")) || 0));
    setErr(null);
    setOk(null);
    setSavingId("__new__");
    try {
      const { error } = await supabase().from("checklists_tareas").insert({
        establecimiento_id: activeEstablishmentId,
        tipo: nuevoTipo,
        titulo,
        orden,
        activo: true
      });
      if (error) throw error;
      setNuevoTitulo("");
      setNuevoOrden("");
      setOk("Tarea añadida.");
      window.setTimeout(() => setOk(null), 1600);
      await fetchTareas();
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSavingId(null);
    }
  }

  async function confirmarBorrar() {
    if (!deleteId || !activeEstablishmentId) return;
    setDeleting(true);
    setErr(null);
    try {
      const { error } = await supabase()
        .from("checklists_tareas")
        .delete()
        .eq("id", deleteId)
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      setDeleteId(null);
      setOk("Tarea eliminada.");
      window.setTimeout(() => setOk(null), 1600);
      await fetchTareas();
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setDeleting(false);
    }
  }

  function fila(t: TareaRow) {
    const busy = savingId === t.id;
    return (
      <li
        key={t.id}
        className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 sm:col-span-1">
            Título
            <input
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={t.titulo}
              onChange={(e) => patchLocal(t.id, { titulo: e.currentTarget.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Orden
            <input
              inputMode="numeric"
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10 sm:w-24"
              value={String(t.orden)}
              onChange={(e) => patchLocal(t.id, { orden: Math.trunc(Number(e.currentTarget.value) || 0) })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Tipo
            <select
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={t.tipo}
              onChange={(e) => patchLocal(t.id, { tipo: e.currentTarget.value === "Cierre" ? "Cierre" : "Apertura" })}
            >
              <option value="Apertura">Apertura</option>
              <option value="Cierre">Cierre</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-slate-300"
              checked={t.activo}
              onChange={(e) => {
                const next = e.currentTarget.checked;
                patchLocal(t.id, { activo: next });
                // Persistencia inmediata (sin depender de pulsar Guardar)
                void (async () => {
                  if (!activeEstablishmentId) return;
                  setSavingId(t.id);
                  try {
                    const { error } = await supabase()
                      .from("checklists_tareas")
                      .update({ activo: next })
                      .eq("id", t.id)
                      .eq("establecimiento_id", activeEstablishmentId);
                    if (error) throw error;
                    setOk("Estado actualizado.");
                    window.setTimeout(() => setOk(null), 1200);
                  } catch (e2) {
                    setErr(supabaseErrToString(e2));
                  } finally {
                    setSavingId(null);
                  }
                })();
              }}
            />
            Activa (visible en el móvil)
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" className="!min-h-10 !px-3 !text-xs" disabled={busy} onClick={() => void guardarFila(t)}>
              {busy ? "Guardando…" : "Guardar"}
            </Button>
            <button
              type="button"
              className="min-h-10 rounded-2xl border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50"
              onClick={() => setDeleteId(t.id)}
            >
              Borrar
            </button>
          </div>
        </div>
      </li>
    );
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canManage) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Checklist · Tareas" showBack backHref="/admin" />
        <main className="mx-auto max-w-md p-4">
          <p className="text-sm text-slate-600">Solo administradores pueden gestionar las tareas del checklist.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Checklist · Tareas" showBack backHref="/admin" />
      <main className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4 sm:px-5">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Tareas del checklist</h1>
          <p className="text-sm text-slate-600">
            Del local activo: <strong>Apertura</strong> y <strong>Cierre</strong>. El personal las marca en{" "}
            <Link href="/checklist" className="font-semibold underline">
              /checklist
            </Link>
            .
          </p>
          <p className="text-xs text-slate-500">
            Superadmin: el historial de firmas está en{" "}
            <Link href="/admin/checklists" className="font-semibold underline">
              Checklists (historial)
            </Link>
            .
          </p>
        </header>

        {!activeEstablishmentId ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Selecciona un establecimiento activo (cabecera si eres superadmin).
          </p>
        ) : null}

        {err ? <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}
        {ok ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{ok}</p> : null}

        {loading ? <p className="text-sm text-slate-600">Cargando tareas…</p> : null}

        {!loading && activeEstablishmentId ? (
          <>
            <section className="rounded-3xl border border-slate-200 bg-slate-100/80 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Nueva tarea</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 sm:col-span-1">
                  Tipo
                  <select
                    className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                    value={nuevoTipo}
                    onChange={(e) => setNuevoTipo(e.currentTarget.value === "Cierre" ? "Cierre" : "Apertura")}
                  >
                    <option value="Apertura">Apertura</option>
                    <option value="Cierre">Cierre</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 sm:col-span-2">
                  Título
                  <input
                    className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                    placeholder="Ej: Revisar hieleras"
                    value={nuevoTitulo}
                    onChange={(e) => setNuevoTitulo(e.currentTarget.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 sm:col-span-1">
                  Orden (opcional)
                  <input
                    inputMode="numeric"
                    className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                    placeholder={`Auto: ${nextOrden(nuevoTipo)}`}
                    value={nuevoOrden}
                    onChange={(e) => setNuevoOrden(e.currentTarget.value)}
                  />
                </label>
                <div className="flex items-end sm:col-span-2">
                  <Button type="button" className="w-full sm:w-auto" disabled={savingId === "__new__"} onClick={() => void anadir()}>
                    {savingId === "__new__" ? "Añadiendo…" : "Añadir tarea"}
                  </Button>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Apertura</h2>
              <ul className="space-y-2">{porTipo.Apertura.map(fila)}</ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Cierre</h2>
              <ul className="space-y-2">{porTipo.Cierre.map(fila)}</ul>
            </section>

            {!items.length ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                No hay tareas todavía. Crea la primera con el formulario de arriba.
              </p>
            ) : null}
          </>
        ) : null}

        <DangerConfirmModal
          open={!!deleteId}
          title="Eliminar tarea"
          description="Se borrará del checklist del local. No afecta a registros ya firmados."
          busy={deleting}
          onClose={() => setDeleteId(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      </main>
    </div>
  );
}
