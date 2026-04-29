"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Pencil, Phone, Plus, Trash2, UserPlus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { digitsWaPhone, urlWhatsApp } from "@/lib/whatsappPedido";

type Turno = "Mañana" | "Comida" | "Tarde" | "Noche";
type Rol = "Barra" | "Sala" | "Cocina";

type Empleado = {
  id: string;
  establecimiento_id: string;
  nombre: string;
  telefono: string | null;
  rol: Rol;
  tipo: "Fijo" | "Extra";
  notas_rendimiento: string | null;
  activo: boolean;
};

type Restriccion = {
  id: string;
  empleado_id: string;
  dia_semana: number; // 1..7
  turno: Turno;
  motivo: string | null;
};

type SemanaRow = { id: string; semana_start: string };
type CeldaRow = { id: string; semana_id: string; dia_semana: number; turno: Turno; rol: Rol; required_count: number };
type AsigRow = { id: string; celda_id: string; empleado_id: string };

const TURNOS: Turno[] = ["Mañana", "Comida", "Tarde", "Noche"];
const ROLES: Rol[] = ["Barra", "Sala", "Cocina"];
const DIA_LABEL: Array<{ n: number; label: string }> = [
  { n: 1, label: "Lun" },
  { n: 2, label: "Mar" },
  { n: 3, label: "Mié" },
  { n: 4, label: "Jue" },
  { n: 5, label: "Vie" },
  { n: 6, label: "Sáb" },
  { n: 7, label: "Dom" }
];

function isMissingStaffSchema(e: unknown): boolean {
  const anyErr = e as { code?: unknown; message?: unknown };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  if (code === "PGRST205") return true;
  return /staff_empleados|staff_restricciones|staff_cuadrante/i.test(msg) && /schema cache|could not find the table/i.test(msg);
}

function isForbiddenRls(e: unknown): boolean {
  const anyErr = e as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  const status = typeof anyErr?.status === "number" ? anyErr.status : null;
  if (status === 401 || status === 403) return true;
  if (code === "42501") return true; // insufficient_privilege
  if (/permission denied|not allowed|forbidden/i.test(msg)) return true;
  return false;
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeParseDateIso(dateIso: string): Date | null {
  const s = String(dateIso ?? "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function mondayOf(dateIso: string): string {
  const d = safeParseDateIso(dateIso) ?? new Date();
  const day = d.getDay(); // 0..6 (Dom..Sáb)
  const diff = (day === 0 ? -6 : 1) - day; // a Lunes
  d.setDate(d.getDate() + diff);
  return toIsoDate(d);
}

function addDays(dateIso: string, days: number): string {
  const d = safeParseDateIso(dateIso) ?? new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

function fmtDia(dateIso: string): string {
  const d = safeParseDateIso(dateIso) ?? new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function WaIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.52 3.48A11.86 11.86 0 0 0 12.01 0C5.39 0 .01 5.38.01 12c0 2.11.55 4.17 1.59 5.99L0 24l6.2-1.63A11.97 11.97 0 0 0 12.01 24C18.63 24 24 18.62 24 12c0-3.19-1.24-6.19-3.48-8.52ZM12.01 21.93c-1.9 0-3.76-.51-5.39-1.48l-.39-.23-3.68.97.98-3.59-.25-.41A9.92 9.92 0 0 1 2.1 12c0-5.46 4.45-9.9 9.91-9.9 2.65 0 5.14 1.03 7.01 2.9A9.85 9.85 0 0 1 21.92 12c0 5.46-4.45 9.93-9.91 9.93Zm5.76-7.44c-.31-.16-1.85-.91-2.13-1.01-.29-.11-.5-.16-.7.16-.2.31-.81 1.01-.99 1.22-.18.2-.36.23-.67.08-.31-.16-1.31-.48-2.5-1.54-.92-.82-1.54-1.83-1.72-2.14-.18-.31-.02-.48.14-.63.14-.14.31-.36.47-.54.16-.18.2-.31.31-.52.11-.2.05-.39-.03-.54-.08-.16-.7-1.68-.96-2.3-.25-.61-.5-.52-.7-.53h-.6c-.2 0-.54.08-.82.39-.28.31-1.07 1.04-1.07 2.54 0 1.5 1.1 2.95 1.25 3.15.16.2 2.16 3.29 5.25 4.61.73.31 1.3.49 1.74.63.73.23 1.39.2 1.92.12.58-.09 1.85-.75 2.11-1.47.26-.72.26-1.34.18-1.47-.08-.13-.28-.2-.59-.36Z"
      />
    </svg>
  );
}

function buildWaMessage(opts: {
  nombreExtra: string;
  establecimiento: string;
  rol: Rol;
  diaLabel: string;
  turno: Turno;
}): string {
  const est = opts.establecimiento.trim() || "Piquillos Blinders";
  const nombre = opts.nombreExtra.trim() || "¿qué tal?";
  return `Hola ${nombre}, soy el gerente de ${est}. He visto que tenemos un hueco libre para ${opts.rol} este ${opts.diaLabel} en el turno de ${opts.turno}. ¿Te cuadra venir? Confírmame por aquí. ¡Gracias!`;
}

export default function AdminStaffPage() {
  const { data: me } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canEdit = hasPermission(role, "admin");
  const canView = hasPermission(role, "staff");

  const { activeEstablishmentId, activeEstablishmentName } = useActiveEstablishment();

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [missingSchema, setMissingSchema] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const [isMobile, setIsMobile] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setIsMobile(!!mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 400px)");
    const apply = () => setIsNarrow(!!mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const [semanaAnchor, setSemanaAnchor] = useState<string>(() => toIsoDate(new Date()));
  const semanaStart = useMemo(() => mondayOf(semanaAnchor), [semanaAnchor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(semanaStart, i)), [semanaStart]);
  const [mobileDia, setMobileDia] = useState<number>(1);
  const [mobileOpenTurno, setMobileOpenTurno] = useState<Turno | null>(null);
  // Nota: antes había un desplegable de acciones en la cabecera móvil.
  // El nuevo layout usa 3 filas con botones directos para evitar capas/overlays que bloqueen clicks.

  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [restricciones, setRestricciones] = useState<Restriccion[]>([]);
  const [semanaRow, setSemanaRow] = useState<SemanaRow | null>(null);
  const [celdas, setCeldas] = useState<CeldaRow[]>([]);
  const [asigs, setAsigs] = useState<AsigRow[]>([]);

  // ===== CRUD: plantilla =====
  const [plantillaOpen, setPlantillaOpen] = useState(false);
  const [empleadoEditing, setEmpleadoEditing] = useState<Empleado | null>(null);
  const [empleadoDraft, setEmpleadoDraft] = useState<{
    nombre: string;
    telefono: string;
    rol: Rol;
    tipo: "Fijo" | "Extra";
    notas_rendimiento: string;
    activo: boolean;
  }>({ nombre: "", telefono: "", rol: "Sala", tipo: "Fijo", notas_rendimiento: "", activo: true });
  const [savingEmpleado, setSavingEmpleado] = useState(false);
  const [selectedEmpleadoId, setSelectedEmpleadoId] = useState<string>("");
  const [restrDraft, setRestrDraft] = useState<{ dia_semana: number; turno: Turno; motivo: string }>({ dia_semana: 1, turno: "Comida", motivo: "" });
  const [savingRestr, setSavingRestr] = useState(false);
  const empleadoEditorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!plantillaOpen) return;
    // UX: al crear/editar, baja automáticamente al formulario para evitar la sensación de “no hace nada”.
    window.setTimeout(() => {
      empleadoEditorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 80);
  }, [plantillaOpen, empleadoEditing?.id]);

  // DEBUG temporal: ver qué elemento recibe el click cuando el modal está abierto.
  useEffect(() => {
    if (!plantillaOpen) return;
    const handleGlobalClick = (e: MouseEvent) => {
      try {
        // eslint-disable-next-line no-console
        console.log("Clic en:", e.target);
      } catch {
        // ignore
      }
    };
    window.addEventListener("click", handleGlobalClick, { capture: true });
    return () => window.removeEventListener("click", handleGlobalClick, { capture: true } as unknown as boolean);
  }, [plantillaOpen]);

  const empleadosById = useMemo(() => {
    const m = new Map<string, Empleado>();
    for (const e of empleados) m.set(e.id, e);
    return m;
  }, [empleados]);

  const restriccionesByEmpleado = useMemo(() => {
    const m = new Map<string, Restriccion[]>();
    for (const r of restricciones) m.set(r.empleado_id, [...(m.get(r.empleado_id) ?? []), r]);
    return m;
  }, [restricciones]);

  const celdasKeyed = useMemo(() => {
    const m = new Map<string, CeldaRow>();
    for (const c of celdas) m.set(`${c.dia_semana}|${c.turno}|${c.rol}`, c);
    return m;
  }, [celdas]);

  const asigsByCelda = useMemo(() => {
    const m = new Map<string, AsigRow[]>();
    for (const a of asigs) m.set(a.celda_id, [...(m.get(a.celda_id) ?? []), a]);
    return m;
  }, [asigs]);

  const fijosPorRol = useMemo(() => {
    const m = new Map<Rol, Empleado[]>();
    for (const r of ROLES) m.set(r, []);
    for (const e of empleados) {
      if (!e.activo) continue;
      if (e.tipo !== "Fijo") continue;
      m.set(e.rol, [...(m.get(e.rol) ?? []), e]);
    }
    for (const [k, v] of m.entries()) {
      v.sort((a, b) => a.nombre.localeCompare(b.nombre));
      m.set(k, v);
    }
    return m;
  }, [empleados]);

  const extrasPorRol = useMemo(() => {
    const m = new Map<Rol, Empleado[]>();
    for (const r of ROLES) m.set(r, []);
    for (const e of empleados) {
      if (!e.activo) continue;
      if (e.tipo !== "Extra") continue;
      m.set(e.rol, [...(m.get(e.rol) ?? []), e]);
    }
    for (const [k, v] of m.entries()) {
      v.sort((a, b) => a.nombre.localeCompare(b.nombre));
      m.set(k, v);
    }
    return m;
  }, [empleados]);

  const loadAll = useCallback(async () => {
    if (!activeEstablishmentId) return;
    setLoading(true);
    setErr(null);
    setOk(null);
    setMissingSchema(false);
    try {
      const emp = await supabase()
        .from("staff_empleados")
        .select("id,establecimiento_id,nombre,telefono,rol,tipo,notas_rendimiento,activo")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("nombre", { ascending: true });
      if (emp.error) {
        if (isMissingStaffSchema(emp.error)) {
          setMissingSchema(true);
          setEmpleados([]);
          setRestricciones([]);
          setSemanaRow(null);
          setCeldas([]);
          setAsigs([]);
          return;
        }
        throw emp.error;
      }
      setEmpleados((emp.data ?? []) as unknown as Empleado[]);

      const resR = await supabase()
        .from("staff_restricciones")
        .select("id,empleado_id,dia_semana,turno,motivo")
        .eq("establecimiento_id", activeEstablishmentId);
      if (resR.error) throw resR.error;
      setRestricciones((resR.data ?? []) as unknown as Restriccion[]);

      // Escritura del cuadrante (crear semana) solo para Admin.
      // Staff puede ver si existe, pero no debe intentar crear filas (RLS).
      let semRow: SemanaRow | null = null;
      if (canEdit) {
        const sem = await supabase()
          .from("staff_cuadrante_semanas")
          .upsert(
            { establecimiento_id: activeEstablishmentId, semana_start: semanaStart },
            { onConflict: "establecimiento_id,semana_start" }
          )
          .select("id,semana_start")
          .single();
        if (sem.error) {
          if (isForbiddenRls(sem.error)) {
            semRow = null;
          } else {
            throw sem.error;
          }
        } else {
          semRow = sem.data as unknown as SemanaRow;
        }
      } else {
        const sem = await supabase()
          .from("staff_cuadrante_semanas")
          .select("id,semana_start")
          .eq("establecimiento_id", activeEstablishmentId)
          .eq("semana_start", semanaStart)
          .maybeSingle();
        if (sem.error) {
          if (isForbiddenRls(sem.error)) {
            semRow = null;
          } else {
            throw sem.error;
          }
        } else {
          semRow = (sem.data as unknown as SemanaRow | null) ?? null;
        }
      }
      setSemanaRow(semRow);

      // Requerido: debug en puntos clave
      // eslint-disable-next-line no-console
      console.log("DEBUG STAFF:", {
        establecimiento_id: activeEstablishmentId,
        semana_start: semanaStart,
        empleados: (emp.data ?? []).length,
        restricciones: (resR.data ?? []).length,
        semanaRow: semRow
      });

      if (!semRow?.id) {
        setCeldas([]);
        setAsigs([]);
        return;
      }

      const cel = await supabase()
        .from("staff_cuadrante_celdas")
        .select("id,semana_id,dia_semana,turno,rol,required_count")
        .eq("establecimiento_id", activeEstablishmentId)
        .eq("semana_id", semRow.id);
      if (cel.error) throw cel.error;
      const celRows = ((cel.data ?? []) as unknown as CeldaRow[]) ?? [];
      setCeldas(celRows);

      // Nota: PostgREST falla si hacemos `.in(..., [])`. Si no hay celdas, no hay asignaciones.
      const celdaIds = celRows.map((c) => String((c as { id?: string }).id ?? "")).filter(Boolean);
      if (!celdaIds.length) {
        setAsigs([]);
      } else {
        const as = await supabase()
          .from("staff_cuadrante_asignaciones")
          .select("id,celda_id,empleado_id")
          .eq("establecimiento_id", activeEstablishmentId)
          .in("celda_id", celdaIds);
        if (as.error) throw as.error;
        setAsigs((((as.data ?? []) as unknown as AsigRow[]) ?? []) as AsigRow[]);
      }
    } catch (e) {
      if (isMissingStaffSchema(e)) {
        setMissingSchema(true);
        setErr("Falta aplicar el esquema de Staff en Supabase. Ejecuta: `supabase/patches/staff-cuadrante.sql`");
      } else {
        setErr(supabaseErrToString(e));
      }
    } finally {
      setLoading(false);
    }
  }, [activeEstablishmentId, canEdit, semanaStart]);

  function openNuevoEmpleado() {
    setEmpleadoEditing(null);
    setEmpleadoDraft({ nombre: "", telefono: "", rol: "Sala", tipo: "Fijo", notas_rendimiento: "", activo: true });
    setPlantillaOpen(true);
  }

  function openEditarEmpleado(e: Empleado) {
    setEmpleadoEditing(e);
    setEmpleadoDraft({
      nombre: String(e.nombre ?? "").trim(),
      telefono: String(e.telefono ?? "").trim(),
      rol: e.rol,
      tipo: e.tipo,
      notas_rendimiento: String(e.notas_rendimiento ?? ""),
      activo: !!e.activo
    });
    setPlantillaOpen(true);
    setSelectedEmpleadoId(e.id);
  }

  async function saveEmpleado() {
    if (!canEdit) return;
    if (!activeEstablishmentId) return;
    const nombre = empleadoDraft.nombre.trim();
    if (!nombre) {
      setErr("Indica el nombre del empleado.");
      return;
    }
    setSavingEmpleado(true);
    setErr(null);
    setOk(null);
    try {
      const payload = {
        establecimiento_id: activeEstablishmentId,
        nombre,
        telefono: empleadoDraft.telefono.trim() || null,
        rol: empleadoDraft.rol,
        tipo: empleadoDraft.tipo,
        notas_rendimiento: empleadoDraft.notas_rendimiento.trim() || null,
        activo: !!empleadoDraft.activo
      };
      if (empleadoEditing) {
        const up = await supabase().from("staff_empleados").update(payload).eq("id", empleadoEditing.id).eq("establecimiento_id", activeEstablishmentId);
        if (up.error) throw up.error;
      } else {
        const ins = await supabase().from("staff_empleados").insert(payload).select("id").single();
        if (ins.error) throw ins.error;
        const newId = (ins.data as unknown as { id?: string } | null)?.id ?? "";
        if (newId) setSelectedEmpleadoId(newId);
      }
      setOk("Empleado guardado.");
      await loadAll();
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSavingEmpleado(false);
    }
  }

  async function deleteEmpleado(id: string) {
    if (!canEdit) return;
    if (!activeEstablishmentId) return;
    const emp = empleadosById.get(id) ?? null;
    const okConfirm = typeof window !== "undefined" ? window.confirm(`¿Eliminar empleado ${emp?.nombre ?? ""}?`) : false;
    if (!okConfirm) return;
    setErr(null);
    setOk(null);
    try {
      const del = await supabase().from("staff_empleados").delete().eq("id", id).eq("establecimiento_id", activeEstablishmentId);
      if (del.error) throw del.error;
      if (selectedEmpleadoId === id) setSelectedEmpleadoId("");
      setOk("Empleado eliminado.");
      await loadAll();
    } catch (e) {
      setErr(supabaseErrToString(e));
    }
  }

  async function addRestriccion() {
    if (!canEdit) return;
    if (!activeEstablishmentId) return;
    const empleado_id = selectedEmpleadoId.trim();
    if (!empleado_id) {
      setErr("Selecciona un empleado para añadir restricciones.");
      return;
    }
    setSavingRestr(true);
    setErr(null);
    setOk(null);
    try {
      const ins = await supabase()
        .from("staff_restricciones")
        .insert({
          establecimiento_id: activeEstablishmentId,
          empleado_id,
          dia_semana: restrDraft.dia_semana,
          turno: restrDraft.turno,
          motivo: restrDraft.motivo.trim() || null
        })
        .select("id");
      if (ins.error) throw ins.error;
      setOk("Restricción guardada.");
      await loadAll();
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSavingRestr(false);
    }
  }

  async function deleteRestriccion(id: string) {
    if (!canEdit) return;
    if (!activeEstablishmentId) return;
    const okConfirm = typeof window !== "undefined" ? window.confirm("¿Eliminar restricción?") : false;
    if (!okConfirm) return;
    setErr(null);
    setOk(null);
    try {
      const del = await supabase().from("staff_restricciones").delete().eq("id", id).eq("establecimiento_id", activeEstablishmentId);
      if (del.error) throw del.error;
      setOk("Restricción eliminada.");
      await loadAll();
    } catch (e) {
      setErr(supabaseErrToString(e));
    }
  }

  useEffect(() => {
    if (!canView) return;
    loadAll().catch((e) => setErr(supabaseErrToString(e)));
  }, [canView, loadAll]);

  async function ensureCelda(dia: number, turno: Turno, rol: Rol): Promise<CeldaRow> {
    if (!activeEstablishmentId || !semanaRow) throw new Error("Falta establecimiento o semana.");
    const key = `${dia}|${turno}|${rol}`;
    const cached = celdasKeyed.get(key) ?? null;
    if (cached) return cached;

    const up = await supabase()
      .from("staff_cuadrante_celdas")
      .upsert(
        {
          establecimiento_id: activeEstablishmentId,
          semana_id: semanaRow.id,
          dia_semana: dia,
          turno,
          rol,
          required_count: 0
        },
        { onConflict: "semana_id,dia_semana,turno,rol" }
      )
      .select("id,semana_id,dia_semana,turno,rol,required_count")
      .single();
    if (up.error) throw up.error;
    const row = up.data as unknown as CeldaRow;
    setCeldas((prev) => {
      const next = [...prev.filter((x) => x.id !== row.id), row];
      return next;
    });
    return row;
  }

  async function setRequiredCount(dia: number, turno: Turno, rol: Rol, required: number) {
    if (!canEdit) return;
    setErr(null);
    setOk(null);
    try {
      const celda = await ensureCelda(dia, turno, rol);
      const required_count = Math.max(0, Math.trunc(Number(required) || 0));
      setCeldas((prev) => prev.map((c) => (c.id === celda.id ? { ...c, required_count } : c)));
      const up = await supabase()
        .from("staff_cuadrante_celdas")
        .update({ required_count })
        .eq("id", celda.id)
        .eq("establecimiento_id", activeEstablishmentId ?? "");
      if (up.error) throw up.error;
      setOk("Cuadrante guardado.");
      setTimeout(() => setOk(null), 1200);
    } catch (e) {
      setErr(supabaseErrToString(e));
    }
  }

  async function addAsignacion(dia: number, turno: Turno, rol: Rol, empleadoId: string) {
    if (!canEdit) return;
    setErr(null);
    setOk(null);
    try {
      const celda = await ensureCelda(dia, turno, rol);
      const already = (asigsByCelda.get(celda.id) ?? []).some((a) => a.empleado_id === empleadoId);
      if (already) return;

      const ins = await supabase()
        .from("staff_cuadrante_asignaciones")
        .insert({ establecimiento_id: activeEstablishmentId, celda_id: celda.id, empleado_id: empleadoId })
        .select("id,celda_id,empleado_id")
        .single();
      if (ins.error) throw ins.error;
      const row = ins.data as unknown as AsigRow;
      setAsigs((prev) => [...prev, row]);
      setOk("Asignación guardada.");
      setTimeout(() => setOk(null), 1200);
    } catch (e) {
      setErr(supabaseErrToString(e));
    }
  }

  async function removeAsignacion(asigId: string) {
    if (!canEdit) return;
    setErr(null);
    setOk(null);
    try {
      const del = await supabase().from("staff_cuadrante_asignaciones").delete().eq("id", asigId).eq("establecimiento_id", activeEstablishmentId ?? "");
      if (del.error) throw del.error;
      setAsigs((prev) => prev.filter((a) => a.id !== asigId));
      setOk("Asignación eliminada.");
      setTimeout(() => setOk(null), 1200);
    } catch (e) {
      setErr(supabaseErrToString(e));
    }
  }

  function conflictText(opts: { empleadoId: string; dia: number; turno: Turno }): string | null {
    const rs = restriccionesByEmpleado.get(opts.empleadoId) ?? [];
    const hit = rs.find((r) => Number(r.dia_semana) === opts.dia && r.turno === opts.turno) ?? null;
    if (!hit) return null;
    return String(hit.motivo ?? "").trim() || "No disponible (restricción)";
  }

  const [extraPicker, setExtraPicker] = useState<null | { dia: number; turno: Turno; rol: Rol }>(null);

  if (!canView) {
    return <main className="p-4 text-sm text-slate-700">No tienes permisos para ver esta sección.</main>;
  }

  if (!activeEstablishmentId) {
    return (
      <main className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <h1 className="text-lg font-extrabold">Staff / Turnos</h1>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            No hay establecimiento activo para tu usuario. Selecciona/solicita un establecimiento en tu perfil para ver el cuadrante.
          </div>
        </div>
      </main>
    );
  }

  if (missingSchema) {
    return (
      <main className="min-h-dvh bg-slate-50 p-4 pb-28">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <h1 className="text-lg font-extrabold text-slate-900">Staff / Turnos</h1>
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-extrabold">Falta el esquema en Supabase.</p>
            <p className="mt-2 font-semibold">
              El error de la imagen corresponde a tablas no creadas (por ejemplo, <span className="font-mono">staff_empleados</span>).
            </p>
            <p className="mt-2">
              Ejecuta en Supabase SQL Editor el archivo: <span className="font-mono">supabase/patches/staff-cuadrante.sql</span>
            </p>
          </div>
          {err ? <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700">{err}</div> : null}
          <button
            type="button"
            className="min-h-12 w-full rounded-2xl bg-slate-900 text-sm font-extrabold text-white hover:bg-black"
            onClick={() => void loadAll()}
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh w-full bg-slate-50">
      <div className="sticky top-0 z-30 border-b border-slate-200/70 bg-slate-50/95 px-2 pt-2 backdrop-blur sm:px-4 sm:pt-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* Cabecera */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              className="grid min-h-11 min-w-11 place-items-center rounded-2xl border border-slate-200 bg-white shadow-sm hover:bg-slate-50 md:min-h-10 md:min-w-10"
              aria-label="Volver"
              onClick={() => {
                if (typeof window !== "undefined") window.history.back();
              }}
            >
              <ArrowLeft className="h-5 w-5 text-slate-700" />
            </button>
            <p className="min-w-0 truncate text-sm font-black tracking-tight text-slate-900">
              Staff · {(activeEstablishmentName ?? "").trim() || "Mi local"}
            </p>
          </div>

          {/* Acción principal */}
          <button
            type="button"
            className={[
              "min-h-11 rounded-2xl bg-slate-900 text-sm font-extrabold text-white shadow-sm hover:bg-black disabled:opacity-60 md:min-h-10 md:text-xs",
              isMobile ? "px-3" : "px-3",
              isMobile && isNarrow ? "min-w-11 px-0 grid place-items-center" : ""
            ].join(" ")}
            disabled={!canEdit}
            onClick={() => openNuevoEmpleado()}
            title={!canEdit ? "Solo Admin puede crear empleados" : "Añadir empleado"}
            aria-label="Añadir empleado"
          >
            {isMobile ? (
              isNarrow ? (
                <Plus className="h-5 w-5" aria-hidden="true" />
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Plus className="h-5 w-5" aria-hidden="true" />
                  <span>Empleado</span>
                </span>
              )
            ) : (
              "+ Empleado"
            )}
          </button>

          {/* Controles */}
          {isMobile ? (
            <div className="w-full space-y-2">
              {/* Fechas (2ª fila) */}
              <div className="grid w-full grid-cols-2 gap-2">
                <input
                  type="date"
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm"
                  value={semanaAnchor}
                  onChange={(e) => setSemanaAnchor((e.target as HTMLInputElement).value)}
                  aria-label="Semana"
                />
                <div className="flex min-h-11 w-full items-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm">
                  Semana {fmtDia(semanaStart)}–{fmtDia(addDays(semanaStart, 6))}
                </div>
              </div>

              {/* Acciones (3ª fila): botones directos */}
              <div className="grid w-full grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => void loadAll()}
                  disabled={loading}
                >
                  {loading ? "Cargando…" : "Recargar"}
                </button>
                <button
                  type="button"
                  className="min-h-11 w-full rounded-2xl bg-slate-900 px-3 text-sm font-extrabold text-white shadow-sm hover:bg-black disabled:opacity-60"
                  disabled={!canEdit}
                  onClick={() => {
                    setPlantillaOpen(true);
                    if (!selectedEmpleadoId) setSelectedEmpleadoId(empleados[0]?.id ?? "");
                  }}
                  title={!canEdit ? "Solo Admin puede gestionar plantilla" : "Gestionar empleados y restricciones"}
                >
                  Plantilla
                </button>
              </div>

              {!canEdit ? (
                <p className="text-[11px] font-semibold text-slate-500">Modo lectura: solo Admin puede editar plantilla o asignaciones.</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-1 -mx-2 w-full px-2 pb-1 md:w-auto">
              <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-2 md:overflow-x-auto md:whitespace-nowrap">
                <input
                  type="date"
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm md:min-h-9 md:w-auto md:px-3 md:text-xs"
                  value={semanaAnchor}
                  onChange={(e) => setSemanaAnchor((e.target as HTMLInputElement).value)}
                  aria-label="Semana"
                />
                <div className="flex min-h-11 w-full items-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm md:min-h-9 md:w-auto md:text-xs">
                  Semana {fmtDia(semanaStart)}–{fmtDia(addDays(semanaStart, 6))}
                </div>
                <button
                  type="button"
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-900 shadow-sm hover:bg-slate-50 md:min-h-9 md:w-auto md:text-xs disabled:opacity-60"
                  onClick={() => void loadAll()}
                  disabled={loading}
                >
                  {loading ? "Cargando…" : "Recargar"}
                </button>
                <button
                  type="button"
                  className="min-h-11 w-full rounded-2xl bg-slate-900 px-3 text-sm font-extrabold text-white shadow-sm hover:bg-black md:min-h-9 md:w-auto md:text-xs disabled:opacity-60"
                  disabled={!canEdit}
                  onClick={() => {
                    setPlantillaOpen(true);
                    if (!selectedEmpleadoId) setSelectedEmpleadoId(empleados[0]?.id ?? "");
                  }}
                  title={!canEdit ? "Solo Admin puede gestionar plantilla" : "Gestionar empleados y restricciones"}
                >
                  Plantilla
                </button>
              </div>
            </div>
          )}
        </div>

        {err ? <div className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{err}</div> : null}
        {ok ? <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{ok}</div> : null}
      </div>

      <div className="h-[calc(100dvh-64px)] overflow-auto p-2 pt-3 pb-28 sm:h-[calc(100dvh-80px)] sm:p-4 sm:pt-4">
          {/* Plantilla: resumen rápido */}
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-extrabold text-slate-900">Empleados</p>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                  disabled={!canEdit}
                  onClick={() => openNuevoEmpleado()}
                >
                  <Plus className="h-4 w-4" /> Añadir
                </button>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {empleados.filter((e) => e.activo).length} activos · {empleados.filter((e) => e.tipo === "Extra").length} extras
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {empleados.slice(0, 8).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-900 hover:bg-slate-50"
                    onClick={() => openEditarEmpleado(e)}
                  >
                    {e.nombre}
                  </button>
                ))}
                {empleados.length > 8 ? <span className="text-xs font-semibold text-slate-500">…</span> : null}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-extrabold text-slate-900">Restricciones</p>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {restricciones.length} registradas (no disponibilidad por día/turno).
              </p>
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                disabled={!canEdit}
                onClick={() => {
                  setPlantillaOpen(true);
                  if (!selectedEmpleadoId) setSelectedEmpleadoId(empleados[0]?.id ?? "");
                }}
              >
                Gestionar restricciones
              </button>
            </div>
          </div>

          {(() => {
            const renderCell = (dia: number, t: Turno, r: Rol) => {
              const cel = celdasKeyed.get(`${dia}|${t}|${r}`) ?? null;
              const assigned = cel ? (asigsByCelda.get(cel.id) ?? []) : [];
              const assignedEmps = assigned.map((a) => empleadosById.get(a.empleado_id)).filter(Boolean) as Empleado[];
              const required = cel?.required_count ?? 0;
              const deficit = Math.max(0, required - assigned.length);
              const conflictNames = assigned
                .map((a) => {
                  const e = empleadosById.get(a.empleado_id);
                  if (!e) return null;
                  const c = conflictText({ empleadoId: a.empleado_id, dia, turno: t });
                  return c ? `${e.nombre}: ${c}` : null;
                })
                .filter(Boolean) as string[];
              const hasConflict = conflictNames.length > 0;
              const cellClass = hasConflict ? "border-amber-200 bg-amber-50" : deficit > 0 ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white";

              return (
                <div className={["space-y-2 rounded-3xl border p-3", cellClass].join(" ")} title={hasConflict ? `Conflicto de restricción:\n${conflictNames.join("\n")}` : ""}>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Necesarios</label>
                    <input
                      type="number"
                      min={0}
                      className="h-9 w-20 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-900 disabled:opacity-60"
                      defaultValue={String(required)}
                      disabled={!canEdit}
                      onBlur={(e) => void setRequiredCount(dia, t, r, Number((e.target as HTMLInputElement).value))}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {assignedEmps.length ? (
                      assignedEmps.map((e) => {
                        const a = assigned.find((x) => x.empleado_id === e.id) ?? null;
                        return (
                          <button
                            key={e.id}
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                            disabled={!canEdit}
                            onClick={() => {
                              if (!a) return;
                              void removeAsignacion(a.id);
                            }}
                            aria-label={`Quitar ${e.nombre}`}
                          >
                            <span className="truncate max-w-[140px]">{e.nombre}</span>
                            <span className="text-slate-400">×</span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="text-sm font-semibold text-slate-600">Sin asignaciones.</p>
                    )}
                  </div>

                  <select
                    className="h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 disabled:opacity-60"
                    disabled={!canEdit || (fijosPorRol.get(r) ?? []).length === 0}
                    value=""
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      if (!v) return;
                      void addAsignacion(dia, t, r, v);
                      (e.target as HTMLSelectElement).value = "";
                    }}
                  >
                    <option value="">{(fijosPorRol.get(r) ?? []).length ? "Añadir fijo…" : "Sin fijos"}</option>
                    {(fijosPorRol.get(r) ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                    <p className="text-sm font-extrabold text-slate-900">
                      {assigned.length}/{required} asignados
                    </p>
                    {deficit > 0 ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-extrabold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                        disabled={!canEdit}
                        onClick={() => setExtraPicker({ dia, turno: t, rol: r })}
                      >
                        <UserPlus className="h-4 w-4" />
                        + Añadir Extra
                      </button>
                    ) : null}
                  </div>

                  {hasConflict ? <p className="text-xs font-semibold text-amber-800">Conflicto detectado (se permite mantener la asignación).</p> : null}
                </div>
              );
            };

            if (isMobile) {
              const TURNOS_HORARIO: Record<Turno, string> = {
                Mañana: "Mañana",
                Comida: "Comida",
                Tarde: "Tarde",
                Noche: "Noche"
              };

              const dayIdx = Math.max(0, Math.min(6, mobileDia - 1));
              const diaLabel = `${DIA_LABEL.find((d) => d.n === mobileDia)?.label ?? `Día ${mobileDia}`} · ${fmtDia(weekDays[dayIdx] ?? weekDays[0])}`;
              const estName = (activeEstablishmentName ?? "").trim() || "Piquillos Blinders";

              const assignedRowsForTurno = (t: Turno): Array<{ empleado: Empleado; rol: Rol; asigId: string | null; conflicto: string | null }> => {
                const out: Array<{ empleado: Empleado; rol: Rol; asigId: string | null; conflicto: string | null }> = [];
                for (const r of ROLES) {
                  const cel = celdasKeyed.get(`${mobileDia}|${t}|${r}`) ?? null;
                  const assigned = cel ? (asigsByCelda.get(cel.id) ?? []) : [];
                  for (const a of assigned) {
                    const emp = empleadosById.get(a.empleado_id) ?? null;
                    if (!emp) continue;
                    out.push({ empleado: emp, rol: r, asigId: a.id ?? null, conflicto: conflictText({ empleadoId: emp.id, dia: mobileDia, turno: t }) });
                  }
                }
                out.sort((a, b) => a.empleado.nombre.localeCompare(b.empleado.nombre, "es", { sensitivity: "base" }));
                return out;
              };

              const TurnoAccordion = (t: Turno) => {
                const rows = assignedRowsForTurno(t);
                const open = mobileOpenTurno === t;
                return (
                  <details
                    key={t}
                    open={open}
                    className="rounded-3xl border border-slate-200 bg-white shadow-sm"
                    onToggle={(e) => {
                      const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                      setMobileOpenTurno(isOpen ? t : null);
                    }}
                  >
                    <summary className="cursor-pointer list-none px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{diaLabel}</p>
                          <p className="mt-1 text-lg font-extrabold text-slate-900">{t}</p>
                        </div>
                        <span className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-700">
                          {rows.length} {rows.length === 1 ? "asignación" : "asignaciones"}
                        </span>
                      </div>
                    </summary>

                    <div className="border-t border-slate-100 px-4 py-4">
                      {!canEdit ? (
                        <div className="space-y-2">
                          {rows.length ? (
                            rows.map((it) => {
                              const phoneDigits = digitsWaPhone(it.empleado.telefono);
                              const msg = buildWaMessage({
                                nombreExtra: it.empleado.nombre,
                                establecimiento: estName,
                                rol: it.rol,
                                diaLabel,
                                turno: t
                              });
                              const href = phoneDigits ? urlWhatsApp(phoneDigits, msg) : null;
                              return (
                                <div key={`${it.empleado.id}|${it.rol}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-extrabold text-slate-900">{it.empleado.nombre}</p>
                                    <p className="mt-0.5 text-xs font-semibold text-slate-600">
                                      {it.rol} · {TURNOS_HORARIO[t]}
                                    </p>
                                    {it.conflicto ? <p className="mt-1 text-xs font-semibold text-amber-800">{it.conflicto}</p> : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                      onClick={() => {
                                        if (typeof window === "undefined") return;
                                        window.location.href = href ?? `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
                                      }}
                                      aria-label="WhatsApp"
                                      title="WhatsApp"
                                    >
                                      <WaIcon className="h-5 w-5 text-emerald-600" />
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                      onClick={() => {
                                        if (typeof window === "undefined") return;
                                        const tel = (it.empleado.telefono ?? "").trim();
                                        if (!tel) return;
                                        window.location.href = `tel:${tel}`;
                                      }}
                                      aria-label="Llamar"
                                      title="Llamar"
                                    >
                                      <Phone className="h-5 w-5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <p className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">Sin asignaciones.</p>
                          )}
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          {ROLES.map((r) => (
                            <div key={r} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                              <p className="text-sm font-extrabold text-slate-900">{r}</p>
                              <div className="mt-2">{renderCell(mobileDia, t, r)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                );
              };

              return (
                <div className="space-y-3">
                  <label className="grid gap-1">
                    <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Día</span>
                    <select
                      className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900"
                      value={String(mobileDia)}
                      onChange={(e) => setMobileDia(Number((e.target as HTMLSelectElement).value) || 1)}
                    >
                      {DIA_LABEL.map((d, idx) => (
                        <option key={d.n} value={String(d.n)}>
                          {d.label} · {fmtDia(weekDays[idx] ?? semanaStart)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-3">{TURNOS.map((t) => TurnoAccordion(t))}</div>
                </div>
              );
            }

            return (
              <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-auto rounded-3xl">
                  <table className="min-w-[980px] w-full border-collapse">
                    <thead className="sticky top-0 z-10 bg-white">
                      <tr>
                        <th className="sticky left-0 z-20 w-[140px] border-b border-slate-200 bg-white p-3 text-left text-xs font-extrabold uppercase tracking-wide text-slate-600">
                          Turno / Rol
                        </th>
                        {DIA_LABEL.map((d, idx) => (
                          <th key={d.n} className="border-b border-slate-200 p-3 text-left">
                            <p className="text-xs font-extrabold text-slate-900">
                              {d.label} <span className="text-slate-500">{fmtDia(weekDays[idx] ?? semanaStart)}</span>
                            </p>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {TURNOS.map((t) =>
                        ROLES.map((r) => (
                          <tr key={`${t}|${r}`} className="align-top">
                            <td className="sticky left-0 z-10 border-b border-slate-100 bg-white p-3">
                              <p className="text-sm font-extrabold text-slate-900">{t}</p>
                              <p className="mt-0.5 text-xs font-semibold text-slate-600">{r}</p>
                            </td>
                            {DIA_LABEL.map((d) => (
                              <td key={`${d.n}|${t}|${r}`} className="border-b border-slate-100 p-3">
                                {renderCell(d.n, t, r)}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
      </div>

      {/* Modal simple de extras */}
      {extraPicker ? (
        <div className="absolute inset-0 z-[1000]">
          <button type="button" className="absolute inset-0 bg-black/30" aria-label="Cerrar" onClick={() => setExtraPicker(null)} />
          <div
            className="absolute bottom-0 left-0 w-full rounded-t-3xl border border-slate-200 bg-white shadow-2xl"
            style={{ maxHeight: "70vh" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-extrabold text-slate-900">Extras disponibles · {extraPicker.rol}</p>
              <button type="button" className="min-h-9 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50" onClick={() => setExtraPicker(null)}>
                Cerrar
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto px-4 py-4 pb-8">
              {(() => {
                const list = extrasPorRol.get(extraPicker.rol) ?? [];
                if (!list.length) return <p className="text-sm font-semibold text-slate-700">No hay extras configurados para este rol.</p>;
                const diaLabel = `${DIA_LABEL.find((x) => x.n === extraPicker.dia)?.label ?? "Día"} (${fmtDia(weekDays[extraPicker.dia - 1] ?? weekDays[0])})`;
                const estName = (activeEstablishmentName ?? "").trim() || "Piquillos Blinders";
                return (
                  <div className="space-y-2">
                    {list.map((e) => {
                      const phoneDigits = digitsWaPhone(e.telefono);
                      const msg = buildWaMessage({ nombreExtra: e.nombre, establecimiento: estName, rol: extraPicker.rol, diaLabel, turno: extraPicker.turno });
                      const href = phoneDigits ? urlWhatsApp(phoneDigits, msg) : null;
                      return (
                        <div key={e.id} className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-extrabold text-slate-900">{e.nombre}</p>
                            <p className="mt-0.5 text-xs font-semibold text-slate-600">{(e.telefono ?? "").trim() || "Sin teléfono"}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                if (typeof window === "undefined") return;
                                window.location.href = href ?? `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
                              }}
                              aria-label="Abrir WhatsApp"
                              title="Abrir WhatsApp"
                            >
                              <WaIcon className="h-5 w-5 text-emerald-600" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                if (typeof window === "undefined") return;
                                const tel = (e.telefono ?? "").trim();
                                if (!tel) return;
                                window.location.href = `tel:${tel}`;
                              }}
                              aria-label="Llamar"
                              title="Llamar"
                            >
                              <Phone className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal plantilla (CRUD empleados y restricciones) - portal al <body> */}
      {plantillaOpen && isClient
        ? createPortal(
            <div className="fixed inset-0 z-[1200]" style={{ pointerEvents: "auto" }}>
              <button
                type="button"
                className="fixed inset-0 z-0 bg-black/30"
                style={{ pointerEvents: "auto" }}
                aria-label="Cerrar"
                onClick={() => setPlantillaOpen(false)}
              />

              <div
                className="fixed bottom-0 left-0 z-10 w-full rounded-t-3xl border border-slate-200 bg-white shadow-2xl"
                style={{ maxHeight: "80vh", pointerEvents: "auto" }}
                onPointerDownCapture={(e) => e.stopPropagation()}
                onClickCapture={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-extrabold text-slate-900">Plantilla</p>
                  <button
                    type="button"
                    className="relative z-[9999] inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-900 hover:bg-slate-50"
                    onClick={() => setPlantillaOpen(false)}
                  >
                    <X className="h-4 w-4" /> Cerrar
                  </button>
                </div>

                <div className="max-h-[80vh] overflow-auto px-4 py-4 pb-10">
                  {err ? <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{err}</div> : null}
                  {ok ? <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{ok}</div> : null}

                  {/* Empleados */}
                  <div className="rounded-3xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Empleados</p>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-black disabled:opacity-60"
                        disabled={!canEdit}
                        onClick={() => openNuevoEmpleado()}
                      >
                        <Plus className="h-4 w-4" /> Nuevo
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2">
                      {empleados.map((e) => (
                        <div key={e.id} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-extrabold text-slate-900">{e.nombre}</p>
                            <p className="mt-0.5 text-xs font-semibold text-slate-600">
                              {e.rol} · {e.tipo} · {(e.telefono ?? "").trim() || "Sin teléfono"} {e.activo ? "" : "· Inactivo"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60"
                              disabled={!canEdit}
                              onClick={() => openEditarEmpleado(e)}
                              aria-label="Editar"
                              title="Editar"
                            >
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                              disabled={!canEdit}
                              onClick={() => void deleteEmpleado(e.id)}
                              aria-label="Eliminar"
                              title="Eliminar"
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Editor empleado */}
                    <div ref={empleadoEditorRef} className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{empleadoEditing ? "Editar empleado" : "Nuevo empleado"}</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="grid gap-2">
                          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Nombre</label>
                          <input
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                            value={empleadoDraft.nombre}
                            onChange={(e) => setEmpleadoDraft((d) => ({ ...d, nombre: (e.target as HTMLInputElement).value }))}
                          />
                        </div>
                        <div className="grid gap-2">
                          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Teléfono</label>
                          <input
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                            value={empleadoDraft.telefono}
                            onChange={(e) => setEmpleadoDraft((d) => ({ ...d, telefono: (e.target as HTMLInputElement).value }))}
                            inputMode="tel"
                          />
                        </div>
                        <div className="grid gap-2">
                          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Rol</label>
                          <select
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                            value={empleadoDraft.rol}
                            onChange={(e) => setEmpleadoDraft((d) => ({ ...d, rol: (e.target as HTMLSelectElement).value as Rol }))}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-2">
                          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tipo</label>
                          <select
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                            value={empleadoDraft.tipo}
                            onChange={(e) => setEmpleadoDraft((d) => ({ ...d, tipo: (e.target as HTMLSelectElement).value as "Fijo" | "Extra" }))}
                          >
                            <option value="Fijo">Fijo</option>
                            <option value="Extra">Extra</option>
                          </select>
                        </div>
                        <div className="md:col-span-2 grid gap-2">
                          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Notas rendimiento</label>
                          <textarea
                            className="min-h-20 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                            value={empleadoDraft.notas_rendimiento}
                            onChange={(e) => setEmpleadoDraft((d) => ({ ...d, notas_rendimiento: (e.target as HTMLTextAreaElement).value }))}
                          />
                        </div>
                        <label className="md:col-span-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={empleadoDraft.activo}
                            onChange={(e) => setEmpleadoDraft((d) => ({ ...d, activo: (e.target as HTMLInputElement).checked }))}
                          />
                          Activo
                        </label>
                      </div>
                      <button
                        type="button"
                        className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-sm font-extrabold text-white hover:bg-blue-700 disabled:opacity-60"
                        disabled={!canEdit || savingEmpleado}
                        onClick={() => void saveEmpleado()}
                      >
                        {savingEmpleado ? "Guardando…" : "Guardar empleado"}
                      </button>
                      {!canEdit ? <p className="mt-2 text-xs font-semibold text-slate-500">Solo Admin puede modificar plantilla.</p> : null}
                    </div>
                  </div>

                  {/* Restricciones */}
                  <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Restricciones (no disponible)</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="grid gap-2">
                        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Empleado</label>
                        <select
                          className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                          value={selectedEmpleadoId}
                          onChange={(e) => setSelectedEmpleadoId((e.target as HTMLSelectElement).value)}
                        >
                          <option value="">Selecciona…</option>
                          {empleados.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.nombre}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-2">
                          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Día</label>
                          <select
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                            value={String(restrDraft.dia_semana)}
                            onChange={(e) =>
                              setRestrDraft((d) => ({ ...d, dia_semana: Math.max(1, Math.min(7, Number((e.target as HTMLSelectElement).value) || 1)) }))
                            }
                          >
                            {DIA_LABEL.map((d) => (
                              <option key={d.n} value={String(d.n)}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="grid gap-2">
                          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Turno</label>
                          <select
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                            value={restrDraft.turno}
                            onChange={(e) => setRestrDraft((d) => ({ ...d, turno: (e.target as HTMLSelectElement).value as Turno }))}
                          >
                            {TURNOS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="md:col-span-2 grid gap-2">
                        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Motivo</label>
                        <input
                          className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                          value={restrDraft.motivo}
                          onChange={(e) => setRestrDraft((d) => ({ ...d, motivo: (e.target as HTMLInputElement).value }))}
                          placeholder="Ej: No disponible"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-extrabold text-white hover:bg-black disabled:opacity-60"
                      disabled={!canEdit || savingRestr || !selectedEmpleadoId}
                      onClick={() => void addRestriccion()}
                    >
                      {savingRestr ? "Guardando…" : "Añadir restricción"}
                    </button>

                    <div className="mt-3 space-y-2">
                      {(restriccionesByEmpleado.get(selectedEmpleadoId) ?? []).map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-extrabold text-slate-900">
                              {(DIA_LABEL.find((d) => d.n === Number(r.dia_semana))?.label ?? `Día ${r.dia_semana}`)} · {r.turno}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold text-slate-600">{String(r.motivo ?? "").trim() || "—"}</p>
                          </div>
                          <button
                            type="button"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                            disabled={!canEdit}
                            onClick={() => void deleteRestriccion(r.id)}
                            aria-label="Eliminar restricción"
                            title="Eliminar"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      ))}
                      {selectedEmpleadoId && !(restriccionesByEmpleado.get(selectedEmpleadoId) ?? []).length ? (
                        <p className="text-sm font-semibold text-slate-600">Sin restricciones para este empleado.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </main>
  );
}

