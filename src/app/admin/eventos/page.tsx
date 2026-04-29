"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Save, Trash2 } from "lucide-react";
import { MobileHeader } from "@/components/MobileHeader";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";

type EventoRow = {
  id: string;
  establecimiento_id: string;
  nombre: string;
  fecha: string; // YYYY-MM-DD
  descripcion: string | null;
  created_at: string;
  updated_at: string | null;
};

function isoToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtFechaEs(dateIso: string): string {
  const s = String(dateIso ?? "").trim();
  if (!s) return "—";
  const d = new Date(`${s}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return s;
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function userFacingOpsError(e: unknown): string {
  const anyErr = e as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  const status = typeof anyErr?.status === "number" ? anyErr.status : null;
  const forbidden = status === 401 || status === 403 || code === "42501" || /permission denied|forbidden/i.test(msg);
  if (forbidden) return "Error de permisos o conexión.";
  if (/failed to fetch|network|timeout/i.test(msg)) return "Error de permisos o conexión.";
  return supabaseErrToString(e);
}

export default function AdminEventosPage() {
  const { activeEstablishmentId, activeEstablishmentName } = useActiveEstablishment();
  const { data: me, isLoading: loadingRole } = useMyRole();
  const role = getEffectiveRole(me ?? null);

  const canView = hasPermission(role, "staff");
  const canEdit = hasPermission(role, "admin");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [eventos, setEventos] = useState<EventoRow[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EventoRow | null>(null);
  const [draft, setDraft] = useState<{ nombre: string; fecha: string; descripcion: string }>({
    nombre: "",
    fecha: isoToday(),
    descripcion: ""
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const setDraftField = (field: "nombre" | "fecha" | "descripcion", value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value ?? "" }));
  };

  const sorted = useMemo(() => {
    const list = [...eventos];
    list.sort((a, b) => String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
    return list;
  }, [eventos]);

  async function loadEventos() {
    if (!activeEstablishmentId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await supabase()
        .from("eventos")
        .select("id,establecimiento_id,nombre,fecha,descripcion,created_at,updated_at")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("fecha", { ascending: false })
        .limit(500);
      if (res.error) throw res.error;
      setEventos((res.data ?? []) as unknown as EventoRow[]);
    } catch (e) {
      setErr(userFacingOpsError(e));
      setEventos([]);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setDraft({ nombre: "", fecha: isoToday(), descripcion: "" });
    setEditorOpen(true);
  }

  function openEdit(ev: EventoRow) {
    setEditing(ev);
    setDraft({
      nombre: String(ev.nombre ?? "").trim(),
      fecha: String(ev.fecha ?? "").trim() || isoToday(),
      descripcion: String(ev.descripcion ?? "")
    });
    setEditorOpen(true);
  }

  async function save() {
    if (!activeEstablishmentId) return;
    if (!canEdit) return;
    const nombre = draft.nombre.trim();
    if (!nombre) {
      setErr("Indica el nombre del evento.");
      return;
    }
    const fecha = String(draft.fecha ?? "").trim() || isoToday();
    setSaving(true);
    setErr(null);
    try {
      const insertPayload = {
        establecimiento_id: activeEstablishmentId,
        nombre,
        fecha,
        descripcion: draft.descripcion.trim() || null
      };
      const updatePayload = {
        nombre,
        fecha,
        descripcion: draft.descripcion.trim() || null
      };
      if (editing?.id) {
        const up = await supabase()
          .from("eventos")
          .update(updatePayload)
          .eq("id", editing.id)
          .eq("establecimiento_id", activeEstablishmentId);
        if (up.error) throw up.error;
      } else {
        const ins = await supabase().from("eventos").insert(insertPayload).select("id").single();
        if (ins.error) throw ins.error;
      }
      setEditorOpen(false);
      setEditing(null);
      await loadEventos();
    } catch (e) {
      setErr(userFacingOpsError(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(ev: EventoRow) {
    if (!activeEstablishmentId) return;
    if (!canEdit) return;
    const ok = typeof window !== "undefined" ? window.confirm(`¿Eliminar el evento "${ev.nombre}"?`) : false;
    if (!ok) return;
    setDeletingId(ev.id);
    setErr(null);
    try {
      const del = await supabase().from("eventos").delete().eq("id", ev.id).eq("establecimiento_id", activeEstablishmentId);
      if (del.error) throw del.error;
      setEventos((prev) => prev.filter((x) => x.id !== ev.id));
    } catch (e) {
      setErr(userFacingOpsError(e));
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (!canView) return;
    void loadEventos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEstablishmentId, canView]);

  if (loadingRole) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Eventos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28 text-sm text-slate-600">Cargando…</main>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Eventos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">Acceso denegado.</div>
        </main>
      </div>
    );
  }

  if (!activeEstablishmentId) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Eventos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
            Selecciona un establecimiento para ver los eventos.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Eventos" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-28">
        <header className="premium-card flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Establecimiento</p>
            <p className="truncate text-base font-black text-slate-900">{(activeEstablishmentName ?? "").trim() || "Mi local"}</p>
            <p className="mt-1 text-sm text-slate-600">Registro y control de eventos (solo Admin puede editar).</p>
          </div>
          <button
            type="button"
            className="premium-btn-primary inline-flex items-center gap-2"
            onClick={() => openCreate()}
            disabled={!canEdit}
            title={!canEdit ? "Solo Admin/Superadmin puede crear eventos" : "Crear evento"}
          >
            <Plus className="h-5 w-5" aria-hidden />
            Nuevo
          </button>
        </header>

        {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-900">{err}</div> : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="text-sm font-black text-slate-800">Eventos</h2>
            <button
              type="button"
              className="premium-btn-secondary inline-flex items-center justify-center"
              onClick={() => void loadEventos()}
              disabled={loading}
            >
              {loading ? "Cargando…" : "Recargar"}
            </button>
          </div>

          {sorted.length === 0 ? (
            <div className="premium-card text-sm text-slate-600">{loading ? "Cargando…" : "No hay eventos todavía."}</div>
          ) : (
            <div className="grid gap-3">
              {sorted.map((ev) => (
                <article key={ev.id} className="premium-card premium-topline-blue">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-slate-900">{ev.nombre}</p>
                      <p className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
                        <CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />
                        {fmtFechaEs(ev.fecha)}
                      </p>
                      {String(ev.descripcion ?? "").trim() ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{String(ev.descripcion ?? "").trim()}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                        onClick={() => openEdit(ev)}
                        disabled={!canEdit}
                        title={!canEdit ? "Solo Admin/Superadmin" : "Editar"}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 shadow-sm hover:bg-rose-100 disabled:opacity-60"
                        onClick={() => void remove(ev)}
                        disabled={!canEdit || deletingId === ev.id}
                        aria-label="Eliminar"
                        title="Eliminar"
                      >
                        <Trash2 className="h-5 w-5" aria-hidden />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <Drawer
        open={editorOpen}
        title={editing ? "Editar evento" : "Nuevo evento"}
        onClose={() => {
          if (saving) return;
          setEditorOpen(false);
        }}
      >
        <div className="space-y-3">
          {!canEdit ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
              Modo lectura: solo Admin/Superadmin puede guardar cambios.
            </div>
          ) : null}

          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Nombre</span>
            <input
              className="premium-input"
              value={draft.nombre || ""}
              onChange={(e) => setDraftField("nombre", e.currentTarget.value)}
              placeholder="Ej: Feria de Abril"
              disabled={saving || !canEdit}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Fecha</span>
            <input
              type="date"
              className="premium-input"
              value={draft.fecha || ""}
              onChange={(e) => setDraftField("fecha", e.currentTarget.value)}
              disabled={saving || !canEdit}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Descripción</span>
            <textarea
              className="premium-input min-h-28 py-3"
              value={draft.descripcion || ""}
              onChange={(e) => setDraftField("descripcion", e.currentTarget.value)}
              placeholder="Notas, detalles, previsión…"
              disabled={saving || !canEdit}
            />
          </label>

          <button
            type="button"
            className="premium-btn-primary inline-flex w-full items-center justify-center gap-2"
            onClick={() => void save()}
            disabled={!canEdit || saving}
          >
            {saving ? (
              "Guardando…"
            ) : (
              <>
                <Save className="h-5 w-5" aria-hidden />
                Guardar
              </>
            )}
          </button>
        </div>
      </Drawer>
    </div>
  );
}

