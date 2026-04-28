"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Circle, LayoutGrid, Lock, Minus, RotateCw, Square, Type } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useCambiosGlobalesRealtime } from "@/lib/useCambiosGlobalesRealtime";

type MesaEstado = "libre" | "reservada";

type Mesa = {
  id: string;
  zona_id: string;
  numero: number;
  pax_max: number;
  forma?: "rect" | "round";
  es_decorativo?: boolean | null;
  nombre?: string | null;
  x: number; // 0..1
  y: number; // 0..1
  /** Dimensiones relativas 0..1 respecto al contenedor del plano (compat: puede no existir en BD antigua). */
  width?: number | null;
  height?: number | null;
  estado: MesaEstado;
  hora_checkin?: string | null;
  updated_at?: string | null;
  /** Grados; paredes y decorativos (columna opcional en BD antigua). */
  rotacion_deg?: number | null;
};

type Zona = { id: string; nombre: string; sort: number };
type ReservaEstado = "pendiente" | "confirmada" | "cancelada";
type ReservaRow = {
  id: string;
  mesa_id: string;
  fecha: string;
  hora: string;
  pax: number;
  nombre: string;
  telefono?: string | null;
  notas?: string | null;
  estado?: ReservaEstado | string | null;
};

type TurnoKey = "comida" | "cena";

const RESERVA_DEFAULT_MINUTES = 90;

function parseHoraToMinutes(hora: string): number | null {
  const m = String(hora ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function turnoRange(turno: TurnoKey): { start: number; end: number } {
  // MVP: rangos operativos típicos; configurable en siguiente iteración (sala_horarios).
  if (turno === "comida") return { start: 12 * 60, end: 17 * 60 }; // 12:00-17:00
  return { start: 19 * 60, end: 24 * 60 }; // 19:00-24:00
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function clampRange(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const SIZE_MIN = 0.04; // 4% del ancho/alto del contenedor
const SIZE_MAX = 0.8; // 80%

function haptic(ms = 50) {
  try {
    if (typeof window !== "undefined") window.navigator?.vibrate?.(ms);
  } catch {
    // ignore
  }
}

function mesaUi(estado: MesaEstado, selected: boolean) {
  const base = { border: "border-slate-300", ring: "", dot: "bg-slate-400", bg: "bg-white" };
  if (estado === "reservada") return { ...base, dot: "bg-sky-500", bg: "bg-sky-50" };
  if (selected) return { ...base, ring: "ring-2 ring-blue-500/30" };
  return base;
}

function isDecorativo(m: Pick<Mesa, "es_decorativo" | "pax_max" | "numero"> | null | undefined): boolean {
  if (!m) return false;
  if (m.es_decorativo) return true;
  // Fallback de compatibilidad: instalaciones sin columna `es_decorativo`
  // Si pax_max=0 y numero negativo => lo tratamos como estructural.
  return (Number(m.pax_max ?? 0) || 0) <= 0 && (Number(m.numero ?? 0) || 0) < 0;
}

function decorKind(m: Pick<Mesa, "nombre"> | null | undefined): "pared" | "barra" | "texto" | "decor" {
  const n = String(m?.nombre ?? "").toLowerCase();
  if (n.includes("pared")) return "pared";
  if (n.includes("barra")) return "barra";
  if (n.startsWith("texto") || n.includes("texto:") || n.includes("[texto]")) return "texto";
  return "decor";
}

function addMinutesToHora(hora: string, minsToAdd: number): string {
  const m = String(hora ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const hh = Math.max(0, Math.min(23, Number(m[1]) || 0));
  const mm = Math.max(0, Math.min(59, Number(m[2]) || 0));
  const total = hh * 60 + mm + minsToAdd;
  const nh = Math.floor(((total % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
  const nm = ((total % 60) + 60) % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export default function ReservasPlanoPage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-slate-600">Cargando…</main>}>
      <ReservasPlanoInner />
    </Suspense>
  );
}

function ReservasPlanoInner() {
  const { data: me, isLoading: meLoading, error } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canView = hasPermission(role, "staff");
  const canDrag = hasPermission(role, "admin");
  const { activeEstablishmentId, activeEstablishmentName } = useActiveEstablishment();

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktop(!!mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [zonaId, setZonaId] = useState<string | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });
  const [reservasDia, setReservasDia] = useState<ReservaRow[]>([]);
  const [turno, setTurno] = useState<TurnoKey>("cena");
  const [horaFocus, setHoraFocus] = useState<string>(() => (new Date().getHours() < 17 ? "14:00" : "21:00"));
  const focusMins = useMemo(() => parseHoraToMinutes(horaFocus) ?? (turno === "comida" ? 14 * 60 : 21 * 60), [horaFocus, turno]);

  const mesaReservaNowById = useMemo(() => {
    const m = new Map<string, ReservaRow | null>();
    const { start: tStart, end: tEnd } = turnoRange(turno);
    for (const r of reservasDia) {
      const mesaId = String(r.mesa_id ?? "").trim();
      if (!mesaId) continue;
      const h = parseHoraToMinutes(String(r.hora ?? ""));
      if (h == null) continue;
      const rStart = h;
      const rEnd = h + RESERVA_DEFAULT_MINUTES;
      const isInTurno = overlaps(rStart, rEnd, tStart, tEnd);
      if (!isInTurno) continue;
      const isNow = overlaps(rStart, rEnd, focusMins, focusMins + 1);
      if (isNow) m.set(mesaId, r);
    }
    return m;
  }, [focusMins, reservasDia, turno]);

  const mesaHasLaterById = useMemo(() => {
    const m = new Map<string, boolean>();
    const { start: tStart, end: tEnd } = turnoRange(turno);
    for (const r of reservasDia) {
      const mesaId = String(r.mesa_id ?? "").trim();
      if (!mesaId) continue;
      const h = parseHoraToMinutes(String(r.hora ?? ""));
      if (h == null) continue;
      const rStart = h;
      const rEnd = h + RESERVA_DEFAULT_MINUTES;
      if (!overlaps(rStart, rEnd, tStart, tEnd)) continue;
      if (rStart > focusMins) m.set(mesaId, true);
    }
    return m;
  }, [focusMins, reservasDia, turno]);
  const reservasByMesa = useMemo(() => {
    const map = new Map<string, ReservaRow[]>();
    for (const r of reservasDia) {
      const id = String(r.mesa_id ?? "").trim();
      if (!id) continue;
      map.set(id, [...(map.get(id) ?? []), r]);
    }
    for (const [k, v] of map.entries()) {
      v.sort((a, b) => String(a.hora ?? "").localeCompare(String(b.hora ?? "")));
      map.set(k, v);
    }
    return map;
  }, [reservasDia]);

  const [planoUnlocked, setPlanoUnlocked] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [, setIsInteracting] = useState(false);
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });

  const boardRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<null | { mesaId: string; startClientX: number; startClientY: number; startX: number; startY: number }>(null);
  const panningRef = useRef<null | { startClientX: number; startClientY: number; startPanX: number; startPanY: number }>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number; mesaId: string | null }>());
  const pinchRef = useRef<null | { mesaId: string; a: number; b: number; startDist: number; startW: number; startH: number }>(null);
  // mergeHoverRef: retirado en versión simplificada

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selMesaId, setSelMesaId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [creatingMesa, setCreatingMesa] = useState<null | "rect" | "round" | "pared" | "texto">(null);
  const [deletingMesa, setDeletingMesa] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [zonaNameDraft, setZonaNameDraft] = useState("");

  const selMesa = useMemo(() => mesas.find((m) => m.id === selMesaId) ?? null, [mesas, selMesaId]);
  const mesasZona = useMemo(() => mesas.filter((m) => m.zona_id === (zonaId ?? "")), [mesas, zonaId]);
  const selIsDecor = useMemo(() => isDecorativo(selMesa), [selMesa]);
  /** Pared y otros decor rect.; no barras (suelen ser horizontales). */
  const selPuedeGirarDecor = useMemo(
    () => selIsDecor && decorKind(selMesa) !== "barra",
    [selIsDecor, selMesa]
  );

  const [reservaDraft, setReservaDraft] = useState({
    nombre: "",
    telefono: "",
    pax: 2,
    hora: "21:00",
    notas: ""
  });
  const [editingReservaId, setEditingReservaId] = useState<string | null>(null);
  const [savingReserva, setSavingReserva] = useState(false);
  const [pinchSizingMesaId, setPinchSizingMesaId] = useState<string | null>(null);

  const mesasRef = useRef(mesas);
  useEffect(() => {
    mesasRef.current = mesas;
  }, [mesas]);

  const load = useCallback(async () => {
    if (!activeEstablishmentId) return;
    setErrMsg(null);
    try {
      const z = await supabase()
        .from("sala_zonas")
        .select("id,nombre,sort")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("sort", { ascending: true });
      if (z.error) throw z.error;
      const zs = ((z.data ?? []) as unknown as Zona[]) ?? [];
      setZonas(zs);
      setZonaId((prev) => prev ?? zs[0]?.id ?? null);

      // Compatibilidad de esquema:
      // Algunas instalaciones aún no tienen `es_decorativo`/`nombre` y el select falla (400).
      // Hacemos fallback automático sin bloquear la pantalla.
      const selects = [
        "id,zona_id,numero,pax_max,forma,es_decorativo,nombre,x,y,width,height,estado,hora_checkin,updated_at,rotacion_deg",
        "id,zona_id,numero,pax_max,forma,es_decorativo,nombre,x,y,width,height,estado,hora_checkin,updated_at",
        "id,zona_id,numero,pax_max,forma,es_decorativo,nombre,x,y,estado,hora_checkin,updated_at,rotacion_deg",
        "id,zona_id,numero,pax_max,forma,es_decorativo,nombre,x,y,estado,hora_checkin,updated_at",
        "id,zona_id,numero,pax_max,forma,x,y,estado,hora_checkin,updated_at"
      ] as const;
      let lastErr: unknown = null;
      for (const sel of selects) {
        const m = await supabase().from("sala_mesas").select(sel).eq("establecimiento_id", activeEstablishmentId);
        if (!m.error) {
          setMesas(((m.data ?? []) as unknown as Mesa[]) ?? []);
          lastErr = null;
          break;
        }
        lastErr = m.error;
      }
      if (lastErr) throw lastErr;
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    }
  }, [activeEstablishmentId]);

  const loadRef = useRef(load);
  loadRef.current = load;

  const loadReservasForDate = useCallback(async () => {
    if (!activeEstablishmentId) {
      setReservasDia([]);
      return;
    }
    if (!selectedDate) {
      setReservasDia([]);
      return;
    }
    setErrMsg(null);
    try {
      const selects = [
        "id,mesa_id,fecha,hora,pax,nombre,telefono,notas,estado",
        "id,mesa_id,fecha,hora,pax,nombre,telefono,notas",
        "id,mesa_id,fecha,hora,pax,nombre,estado",
        "id,mesa_id,fecha,hora,pax,nombre"
      ] as const;
      let lastErr: unknown = null;
      for (const sel of selects) {
        const q = supabase()
          .from("sala_reservas")
          .select(sel)
          .eq("establecimiento_id", activeEstablishmentId)
          .eq("fecha", selectedDate)
          .order("hora", { ascending: true });
        const r = await q;
        if (!r.error) {
          const rows = ((r.data ?? []) as unknown as ReservaRow[]) ?? [];
          // Solo confirmadas (si existe columna estado); si no existe, mostramos todas.
          const filtered =
            sel.includes("estado") ? rows.filter((x) => String((x as ReservaRow).estado ?? "").toLowerCase() === "confirmada") : rows;
          setReservasDia(filtered);
          lastErr = null;
          break;
        }
        lastErr = r.error;
      }
      if (lastErr) throw lastErr;
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
      setReservasDia([]);
    }
  }, [activeEstablishmentId, selectedDate]);

  useEffect(() => {
    void loadReservasForDate();
  }, [loadReservasForDate]);

  const realtimeReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (realtimeReloadTimerRef.current != null) {
        clearTimeout(realtimeReloadTimerRef.current);
        realtimeReloadTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useCambiosGlobalesRealtime({
    establecimientoId: activeEstablishmentId,
    tables: ["sala_zonas", "sala_mesas", "sala_reservas"],
    onChange: () => {
      // Evita carrera: el propio UPDATE dispara Realtime y un load inmediato puede leer fila aún antigua.
      if (realtimeReloadTimerRef.current != null) clearTimeout(realtimeReloadTimerRef.current);
      realtimeReloadTimerRef.current = setTimeout(() => {
        realtimeReloadTimerRef.current = null;
        void loadRef.current();
      }, 450);
    }
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = isDesktop ? prev : "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isDesktop]);

  // iOS Safari / Android: asegura que `preventDefault()` funcione en movimientos táctiles.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    // Medir tamaño real del tablero (para convertir width/height relativos → px)
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBoardSize({ w: Math.max(0, r.width), h: Math.max(0, r.height) });
    };
    measure();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    } catch {
      // ignore
    }
    const pointToWorld01 = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = el.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const worldPxX = sx / scale - pan.x;
      const worldPxY = sy / scale - pan.y;
      return { x: clamp01(worldPxX / rect.width), y: clamp01(worldPxY / rect.height) };
    };

    const isTouchInsideMesa = (mesa: Mesa, clientX: number, clientY: number): boolean => {
      const rect = el.getBoundingClientRect();
      const wPx =
        mesa.width != null && Number.isFinite(Number(mesa.width)) && rect.width > 0 ? Math.max(6, Number(mesa.width) * rect.width) : 60;
      const hPx =
        mesa.height != null && Number.isFinite(Number(mesa.height)) && rect.height > 0 ? Math.max(6, Number(mesa.height) * rect.height) : 60;
      const p = pointToWorld01(clientX, clientY);
      const w01 = wPx / Math.max(1, rect.width);
      const h01 = hPx / Math.max(1, rect.height);
      return p.x >= mesa.x - w01 / 2 && p.x <= mesa.x + w01 / 2 && p.y >= mesa.y - h01 / 2 && p.y <= mesa.y + h01 / 2;
    };

    const MIN_SIZE = 0.05;

    const onTouchMove: EventListener = (evt) => {
      const ev = evt as TouchEvent;
      // Bloquea zoom nativo siempre dentro del tablero
      ev.preventDefault();
      ev.stopPropagation();

      if (!planoUnlocked) return;
      if (!selMesaId) return;
      const mesa = mesasRef.current.find((m) => m.id === selMesaId) ?? null;
      if (!mesa || isDecorativo(mesa)) return;

      if (ev.touches.length !== 2) return;
      const t1 = ev.touches[0];
      const t2 = ev.touches[1];
      if (!t1 || !t2) return;

      // Solo si ambos dedos están sobre la mesa seleccionada
      if (!isTouchInsideMesa(mesa, t1.clientX, t1.clientY)) return;
      if (!isTouchInsideMesa(mesa, t2.clientX, t2.clientY)) return;

      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      if (!Number.isFinite(dist) || dist <= 0) return;

      if (!pinchRef.current || pinchRef.current.mesaId !== mesa.id) {
        // Inicializa pinch con tamaños actuales
        pinchRef.current = {
          mesaId: mesa.id,
          a: -1,
          b: -2,
          startDist: dist,
          startW: clampRange(Number(mesa.width ?? 0.18) || 0.18, MIN_SIZE, SIZE_MAX),
          startH: clampRange(Number(mesa.height ?? 0.18) || 0.18, MIN_SIZE, SIZE_MAX)
        };
        setPinchSizingMesaId(mesa.id);
        return;
      }

      const pinch = pinchRef.current;
      const factor = dist / Math.max(10, pinch.startDist);
      const nextW = clampRange(pinch.startW * factor, MIN_SIZE, SIZE_MAX);
      const nextH = clampRange(pinch.startH * factor, MIN_SIZE, SIZE_MAX);
      setMesas((prev) => prev.map((m) => (m.id === mesa.id ? { ...m, width: nextW, height: nextH } : m)));
    };

    const onTouchEnd: EventListener = (evt) => {
      const ev = evt as TouchEvent;
      ev.preventDefault();
      ev.stopPropagation();
      const pinch = pinchRef.current;
      if (!pinch) return;
      // Si ya no hay 2 dedos, persistimos
      if (ev.touches.length >= 2) return;
      pinchRef.current = null;
      setPinchSizingMesaId(null);

      const mesa = mesasRef.current.find((m) => m.id === pinch.mesaId) ?? null;
      if (!mesa || !activeEstablishmentId) return;
      const patch = {
        width: mesa.width != null ? clampRange(Number(mesa.width) || 0, MIN_SIZE, SIZE_MAX) : null,
        height: mesa.height != null ? clampRange(Number(mesa.height) || 0, MIN_SIZE, SIZE_MAX) : null
      };
      void (async () => {
        try {
          const res = await supabase().from("sala_mesas").update(patch).eq("id", mesa.id).eq("establecimiento_id", activeEstablishmentId);
          if (res.error) throw res.error;
        } catch (err) {
          setErrMsg(supabaseErrToString(err));
          void load();
        }
      })();
    };

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd, { passive: false });
    return () => {
      try {
        ro?.disconnect();
      } catch {
        // ignore
      }
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [activeEstablishmentId, pan.x, pan.y, planoUnlocked, scale, selMesaId, load]);

  function openMesa(mesaId: string) {
    const m = mesas.find((x) => x.id === mesaId) ?? null;
    setSelMesaId(mesaId);
    // En modo agenda (plano bloqueado): el Drawer es para reservas manuales.
    // Decorativos no abren agenda cuando está bloqueado.
    if (!planoUnlocked && isDecorativo(m)) return;
    setManageOpen(isDecorativo(m) && planoUnlocked);
    setSheetOpen(true);
    setMergeMode(false);
    setEditingReservaId(null);
    setReservaDraft({
      nombre: "",
      telefono: "",
      pax: 2,
      hora: horaFocus || (turno === "comida" ? "14:00" : "21:00"),
      notas: ""
    });
  }

  useEffect(() => {
    if (!planoUnlocked) {
      setMergeMode(false);
    }
  }, [planoUnlocked]);

  useEffect(() => {
    const z = zonas.find((x) => x.id === zonaId) ?? null;
    setZonaNameDraft(z?.nombre ?? "");
  }, [zonaId, zonas]);

  async function saveZonaName(nextName: string) {
    if (!activeEstablishmentId || !zonaId) return;
    if (!canDrag || !planoUnlocked) return;
    const nombre = String(nextName ?? "").trim();
    if (!nombre) return;
    setErrMsg(null);
    try {
      const res = await supabase()
        .from("sala_zonas")
        .update({ nombre })
        .eq("id", zonaId)
        .eq("establecimiento_id", activeEstablishmentId);
      if (res.error) throw res.error;
      void load();
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    }
  }

  async function createNuevaZona() {
    if (!activeEstablishmentId || !canDrag) return;
    setErrMsg(null);
    try {
      const maxSort = zonas.reduce((acc, z) => Math.max(acc, z.sort), -1);
      const nextSort = maxSort + 1;
      const nombre = `Sala ${zonas.length + 1}`;
      const res = await supabase()
        .from("sala_zonas")
        .insert({ establecimiento_id: activeEstablishmentId, nombre, sort: nextSort })
        .select("id")
        .single();
      if (res.error) throw res.error;
      const newId = (res.data as unknown as { id: string } | null)?.id ?? null;
      if (newId) {
        setZonaId(newId);
        setZonaNameDraft(nombre);
        haptic(50);
      }
      await load();
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    }
  }

  async function deleteZonaActual() {
    if (!activeEstablishmentId || !zonaId) return;
    if (!canDrag) return;
    const z = zonas.find((x) => x.id === zonaId) ?? null;
    const nombre = String(z?.nombre ?? "").trim() || "esta sala";
    const count = mesas.filter((m) => m.zona_id === zonaId).length;
    const ok = typeof window !== "undefined" ? window.confirm(count > 0 ? `La sala “${nombre}” tiene ${count} mesas. ¿Eliminar sala y sus mesas?` : `¿Eliminar la sala “${nombre}”?`) : false;
    if (!ok) return;
    setErrMsg(null);
    try {
      if (count > 0) {
        const delMesas = await supabase().from("sala_mesas").delete().eq("zona_id", zonaId).eq("establecimiento_id", activeEstablishmentId);
        if (delMesas.error) throw delMesas.error;
      }
      const delZona = await supabase().from("sala_zonas").delete().eq("id", zonaId).eq("establecimiento_id", activeEstablishmentId);
      if (delZona.error) throw delZona.error;
      haptic(50);
      // Seleccionar otra zona disponible
      const remaining = zonas.filter((x) => x.id !== zonaId).sort((a, b) => a.sort - b.sort);
      setZonaId(remaining[0]?.id ?? null);
      setZonaNameDraft(remaining[0]?.nombre ?? "");
      await load();
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
      void load();
    }
  }

  function centerOfViewportToWorld01(): { x: number; y: number } {
    const el = boardRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const rect = el.getBoundingClientRect();
    // Inverse de transform: screen = (worldPx + pan) * scale
    const worldPxX = rect.width / 2 / scale - pan.x;
    const worldPxY = rect.height / 2 / scale - pan.y;
    return { x: clamp01(worldPxX / rect.width), y: clamp01(worldPxY / rect.height) };
  }

  async function createMesa(kind: "rect" | "round" | "pared" | "texto") {
    if (!activeEstablishmentId || !zonaId) return;
    if (!canDrag || !planoUnlocked) return;
    if (creatingMesa) return;
    setErrMsg(null);
    setCreatingMesa(kind);
    try {
      const { x, y } = centerOfViewportToWorld01();
      const isPared = kind === "pared";
      const isTexto = kind === "texto";
      const forma = kind === "round" ? "round" : "rect";
      const maxPos = mesasZona.reduce((acc, m) => Math.max(acc, m.numero || 0), 0);
      const minNum = mesasZona.reduce((acc, m) => Math.min(acc, m.numero || 0), 0);
      const nextNumero = isPared || isTexto ? Math.min(-1, minNum - 1) : maxPos + 1;

      const payload: Record<string, unknown> = {
        establecimiento_id: activeEstablishmentId,
        zona_id: zonaId,
        numero: nextNumero,
        pax_max: isPared || isTexto ? 0 : 4,
        forma,
        x,
        y,
        estado: "libre",
        es_decorativo: isPared || isTexto,
        nombre: isPared ? "Pared" : isTexto ? "Texto: Zona" : null,
        rotacion_deg: 0
      };

      let newId: string | null = null;
      // Compatibilidad: columnas opcionales según migración aplicada.
      const tryInsert = async (data: Record<string, unknown>) => {
        const res = await supabase().from("sala_mesas").insert(data).select("id").single();
        if (res.error) throw res.error;
        return (res.data as unknown as { id: string } | null)?.id ?? null;
      };
      try {
        newId = await tryInsert(payload);
      } catch (e) {
        try {
          // eslint-disable-next-line no-console
          console.error("[reservas] insert mesa failed; fallback columnas", e);
        } catch {
          // ignore
        }
        const fallback = { ...payload };
        delete (fallback as Record<string, unknown>).rotacion_deg;
        try {
          newId = await tryInsert(fallback);
        } catch (e2) {
          try {
            // eslint-disable-next-line no-console
            console.error("[reservas] insert fallback 2", e2);
          } catch {
            // ignore
          }
          delete (fallback as Record<string, unknown>).es_decorativo;
          delete (fallback as Record<string, unknown>).nombre;
          newId = await tryInsert(fallback);
        }
      }

      haptic(50);
      if (newId) {
        setSelMesaId(newId);
        setSheetOpen(true);
        setManageOpen(isPared || isTexto);
      }
      // El realtime traerá la nueva mesa; refrescamos por si acaso.
      void load();
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    } finally {
      setCreatingMesa(null);
    }
  }

  function onPointerDownBoard(e: React.PointerEvent) {
    if (draggingRef.current) return;
    // Si estamos editando y hay panel abierto, tocar el fondo cierra el panel.
    if (planoUnlocked && sheetOpen) {
      setSheetOpen(false);
      setManageOpen(false);
      setSelMesaId(null);
      setMergeMode(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setIsInteracting(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panningRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPanX: pan.x, startPanY: pan.y };
  }

  function onPointerDownMesa(e: React.PointerEvent, mesa: Mesa) {
    if (!canDrag) return;
    if (!planoUnlocked) return;
    if (isDecorativo(mesa)) {
      // Decorativos se pueden mover igual, sin bloqueos extra
    }
    e.preventDefault();
    e.stopPropagation();
    setIsInteracting(true);
    haptic(20);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    // Track pointers para pinch-to-zoom
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, mesaId: mesa.id });
    const activeForMesa = Array.from(pointersRef.current.entries())
      .filter(([, v]) => v.mesaId === mesa.id)
      .map(([id]) => id);

    // Pinch solo si la mesa está seleccionada y hay 2 punteros
    if (selMesaId === mesa.id && activeForMesa.length >= 2) {
      const [a, b] = activeForMesa.slice(-2);
      const pa = pointersRef.current.get(a)!;
      const pb = pointersRef.current.get(b)!;
      const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const defaultW = boardSize.w > 0 ? 60 / boardSize.w : 0.18;
      const defaultH = boardSize.h > 0 ? 60 / boardSize.h : 0.18;
      const startW = clampRange(Number(mesa.width ?? defaultW) || defaultW, SIZE_MIN, SIZE_MAX);
      const startH = clampRange(Number(mesa.height ?? defaultH) || defaultH, SIZE_MIN, SIZE_MAX);
      pinchRef.current = { mesaId: mesa.id, a, b, startDist: Math.max(10, dist), startW, startH };
      draggingRef.current = null;
      panningRef.current = null;
      return;
    }

    // Drag normal con 1 dedo
    if (!pinchRef.current) {
      draggingRef.current = { mesaId: mesa.id, startClientX: e.clientX, startClientY: e.clientY, startX: mesa.x, startY: mesa.y };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // Actualizar puntero
    const existing = pointersRef.current.get(e.pointerId);
    if (existing) pointersRef.current.set(e.pointerId, { ...existing, x: e.clientX, y: e.clientY });

    // Pinch-to-zoom activo
    const pinch = pinchRef.current;
    if (pinch && pinch.mesaId) {
      const pa = pointersRef.current.get(pinch.a) ?? null;
      const pb = pointersRef.current.get(pinch.b) ?? null;
      if (pa && pb) {
        e.preventDefault();
        e.stopPropagation();
        const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        const factor = dist / Math.max(10, pinch.startDist);
        const nextW = clampRange(pinch.startW * factor, SIZE_MIN, SIZE_MAX);
        const nextH = clampRange(pinch.startH * factor, SIZE_MIN, SIZE_MAX);
        setMesas((prev) => prev.map((m) => (m.id === pinch.mesaId ? { ...m, width: nextW, height: nextH } : m)));
        return;
      }
    }

    const drag = draggingRef.current;
    if (drag && boardRef.current) {
      e.preventDefault();
      e.stopPropagation();
      const rect = boardRef.current.getBoundingClientRect();
      const dx = (e.clientX - drag.startClientX) / rect.width;
      const dy = (e.clientY - drag.startClientY) / rect.height;
      const nx = clamp01(drag.startX + dx);
      const ny = clamp01(drag.startY + dy);
      setMesas((prev) => prev.map((m) => (m.id === drag.mesaId ? { ...m, x: nx, y: ny } : m)));

      return;
    }
    const p = panningRef.current;
    if (p) {
      e.preventDefault();
      e.stopPropagation();
      setPan({ x: p.startPanX + (e.clientX - p.startClientX), y: p.startPanY + (e.clientY - p.startClientY) });
    }
  }

  async function onPointerUp(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId);
    const drag = draggingRef.current;
    draggingRef.current = null;
    panningRef.current = null;
    setIsInteracting(false);

    // Finalizar pinch si estaba activo (cuando ya no quedan 2 punteros)
    const pinch = pinchRef.current;
    if (pinch) {
      const stillA = pointersRef.current.has(pinch.a);
      const stillB = pointersRef.current.has(pinch.b);
      if (stillA && stillB) return;
      pinchRef.current = null;
      const m = mesas.find((x) => x.id === pinch.mesaId) ?? null;
      if (m && activeEstablishmentId) {
        try {
          const patch = {
            width: m.width != null ? clampRange(Number(m.width) || 0, SIZE_MIN, SIZE_MAX) : null,
            height: m.height != null ? clampRange(Number(m.height) || 0, SIZE_MIN, SIZE_MAX) : null
          } as const;
          const res = await supabase().from("sala_mesas").update(patch).eq("id", m.id).eq("establecimiento_id", activeEstablishmentId);
          if (res.error) throw res.error;
        } catch (err) {
          setErrMsg(supabaseErrToString(err));
          void load();
        }
      }
    }

    if (!drag) return;
    const mesa = mesas.find((m) => m.id === drag.mesaId) ?? null;
    if (!mesa) return;

    // Fusión por colisión al soltar (solo mesas no decorativas).
    const canTryMerge = !!activeEstablishmentId && canDrag && planoUnlocked && !isDecorativo(mesa);
    if (canTryMerge && boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      const defaultW = 60 / Math.max(1, rect.width);
      const defaultH = 60 / Math.max(1, rect.height);
      const wA = clampRange(Number(mesa.width ?? defaultW) || defaultW, SIZE_MIN, SIZE_MAX);
      const hA = clampRange(Number(mesa.height ?? defaultH) || defaultH, SIZE_MIN, SIZE_MAX);
      const ax1 = mesa.x - wA / 2;
      const ay1 = mesa.y - hA / 2;
      const ax2 = mesa.x + wA / 2;
      const ay2 = mesa.y + hA / 2;
      const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);

      const candidates = mesasZona
        .filter((m) => m.id !== mesa.id)
        .filter((m) => !isDecorativo(m))
        .map((m) => {
          const wB = clampRange(Number(m.width ?? defaultW) || defaultW, SIZE_MIN, SIZE_MAX);
          const hB = clampRange(Number(m.height ?? defaultH) || defaultH, SIZE_MIN, SIZE_MAX);
          const bx1 = m.x - wB / 2;
          const by1 = m.y - hB / 2;
          const bx2 = m.x + wB / 2;
          const by2 = m.y + hB / 2;
          const ix1 = Math.max(ax1, bx1);
          const iy1 = Math.max(ay1, by1);
          const ix2 = Math.min(ax2, bx2);
          const iy2 = Math.min(ay2, by2);
          const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
          const score = areaA > 0 ? inter / areaA : 0;
          return { m, score };
        })
        .filter((x) => x.score >= 0.35)
        .sort((a, b) => b.score - a.score);

      const hit = candidates[0]?.m ?? null;
      if (hit) {
        const ok = typeof window !== "undefined" ? window.confirm("¿Quieres fusionar estas mesas?") : false;
        if (ok) {
          try {
            const newPax = Math.max(0, (mesa.pax_max ?? 0) + (hit.pax_max ?? 0));
            const cx = clamp01((mesa.x + hit.x) / 2);
            const cy = clamp01((mesa.y + hit.y) / 2);
            const up = await supabase()
              .from("sala_mesas")
              .update({ pax_max: newPax, x: cx, y: cy })
              .eq("id", mesa.id)
              .eq("establecimiento_id", activeEstablishmentId ?? "");
            if (up.error) throw up.error;
            const del = await supabase()
              .from("sala_mesas")
              .delete()
              .eq("id", hit.id)
              .eq("establecimiento_id", activeEstablishmentId ?? "");
            if (del.error) throw del.error;
            haptic(50);
            void load();
            return;
          } catch (e) {
            setErrMsg(supabaseErrToString(e));
            void load();
          }
        }
      }
    }

    try {
      const res = await supabase()
        .from("sala_mesas")
        .update({ x: mesa.x, y: mesa.y })
        .eq("id", mesa.id)
        .eq("establecimiento_id", activeEstablishmentId ?? "");
      if (res.error) throw res.error;
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
      void load();
    }
  }

  async function setEstado(estado: MesaEstado) {
    if (!selMesa || !activeEstablishmentId) return;
    setMesas((prev) => prev.map((m) => (m.id === selMesa.id ? { ...m, estado } : m)));
    try {
      const res = await supabase()
        .from("sala_mesas")
        .update({ estado })
        .eq("id", selMesa.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (res.error) throw res.error;
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
      void load();
    }
  }

  function mesaAgendaColor(mesa: Mesa): { dot: string; bg: string; border: string } {
    const now = mesaReservaNowById.get(mesa.id) ?? null;
    if (now) return { dot: "bg-rose-600", bg: "bg-rose-50", border: "border-rose-300" }; // rojo: ocupada ahora
    const later = mesaHasLaterById.get(mesa.id) ?? false;
    if (later) return { dot: "bg-amber-500", bg: "bg-amber-50", border: "border-amber-300" }; // amarillo: reserva más tarde
    return { dot: "bg-emerald-600", bg: "bg-emerald-50", border: "border-emerald-300" }; // verde: libre
  }

  async function saveReservaManual() {
    if (!activeEstablishmentId || !selMesa) return;
    if (isDecorativo(selMesa)) return;
    setSavingReserva(true);
    setErrMsg(null);
    try {
      const nombre = String(reservaDraft.nombre ?? "").trim();
      const telefono = String(reservaDraft.telefono ?? "").trim();
      const notas = String(reservaDraft.notas ?? "").trim();
      const pax = Math.max(1, Math.trunc(Number(reservaDraft.pax) || 1));
      const hora = String(reservaDraft.hora ?? "").trim() || (turno === "comida" ? "14:00" : "21:00");
      if (!nombre) throw new Error("Indica el nombre del cliente.");
      if (!telefono) throw new Error("Indica el teléfono.");
      if (parseHoraToMinutes(hora) == null) throw new Error("Hora inválida. Usa formato HH:MM (ej: 14:30).");

      if (editingReservaId) {
        const up = await supabase()
          .from("sala_reservas")
          .update({ nombre, telefono, pax, hora, notas, estado: "confirmada" })
          .eq("id", editingReservaId)
          .eq("establecimiento_id", activeEstablishmentId);
        if (up.error) throw up.error;
      } else {
        const ins = await supabase()
          .from("sala_reservas")
          .insert({
            establecimiento_id: activeEstablishmentId,
            mesa_id: selMesa.id,
            fecha: selectedDate,
            nombre,
            telefono,
            pax,
            hora,
            notas,
            estado: "confirmada"
          });
        if (ins.error) throw ins.error;
      }

      await loadReservasForDate();
      setSheetOpen(false);
      setSelMesaId(null);
      setManageOpen(false);
      setEditingReservaId(null);
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    } finally {
      setSavingReserva(false);
    }
  }

  async function liberarMesa() {
    if (!activeEstablishmentId || !selMesa) return;
    const r = mesaReservaNowById.get(selMesa.id) ?? null;
    if (!r) return;
    const ok = typeof window !== "undefined" ? window.confirm("¿Liberar mesa (cancelar reserva) ?") : false;
    if (!ok) return;
    setSavingReserva(true);
    setErrMsg(null);
    try {
      const up = await supabase()
        .from("sala_reservas")
        .update({ estado: "cancelada" })
        .eq("id", r.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (up.error) throw up.error;
      await loadReservasForDate();
      setSheetOpen(false);
      setSelMesaId(null);
      setManageOpen(false);
      setEditingReservaId(null);
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    } finally {
      setSavingReserva(false);
    }
  }

  function startEditarReserva(r: ReservaRow) {
    setEditingReservaId(r.id);
    setReservaDraft({
      nombre: String(r.nombre ?? "").trim(),
      telefono: String(r.telefono ?? "").trim(),
      pax: Math.max(1, Math.trunc(Number(r.pax) || 1)),
      hora: String(r.hora ?? "").trim() || (turno === "comida" ? "14:00" : "21:00"),
      notas: String(r.notas ?? "").trim()
    });
  }

  async function deleteMesa() {
    if (!selMesa || !activeEstablishmentId) return;
    // Permitir borrar desde "Gestionar" aunque el plano esté bloqueado.
    if (!canDrag) return;
    if (deletingMesa) return;
    const decor = isDecorativo(selMesa);
    const label = decor
      ? String(selMesa.nombre ?? "").trim() || "este elemento estructural"
      : `la mesa ${selMesa.numero}`;
    const ok = typeof window !== "undefined" ? window.confirm(`¿Eliminar ${label}?`) : false;
    if (!ok) return;
    setDeletingMesa(true);
    setErrMsg(null);
    try {
      const res = await supabase()
        .from("sala_mesas")
        .delete()
        .eq("id", selMesa.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (res.error) throw res.error;
      setSheetOpen(false);
      setManageOpen(false);
      setMergeMode(false);
      setSelMesaId(null);
      void load();
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    } finally {
      setDeletingMesa(false);
    }
  }

  async function updateMesaFields(patch: Partial<Pick<Mesa, "numero" | "pax_max" | "rotacion_deg" | "width" | "height" | "nombre">>) {
    if (!selMesa || !activeEstablishmentId) return;
    if (!canDrag) return;
    setErrMsg(null);
    setMesas((prev) => prev.map((m) => (m.id === selMesa.id ? { ...m, ...patch } : m)));
    const selectCols = ["id", ...Object.keys(patch)].join(",");
    try {
      let last = await supabase()
        .from("sala_mesas")
        .update(patch)
        .eq("id", selMesa.id)
        .eq("establecimiento_id", activeEstablishmentId)
        .select(selectCols)
        .single();
      if (last.error && (patch.rotacion_deg !== undefined || patch.width !== undefined || patch.height !== undefined || patch.nombre !== undefined)) {
        const rotacionErr = last.error;
        const rest = { ...patch };
        delete (rest as Record<string, unknown>).rotacion_deg;
        delete (rest as Record<string, unknown>).width;
        delete (rest as Record<string, unknown>).height;
        delete (rest as Record<string, unknown>).nombre;
        if (Object.keys(rest).length > 0) {
          const sel2 = ["id", ...Object.keys(rest)].join(",");
          last = await supabase()
            .from("sala_mesas")
            .update(rest)
            .eq("id", selMesa.id)
            .eq("establecimiento_id", activeEstablishmentId)
            .select(sel2)
            .single();
        } else {
          throw rotacionErr;
        }
      }
      if (last.error) throw last.error;
      const updated = last.data as Partial<Mesa> | null;
      if (updated && typeof updated === "object") {
        setMesas((prev) => prev.map((m) => (m.id === selMesa.id ? { ...m, ...updated } : m)));
      }
    } catch (e) {
      const msg = supabaseErrToString(e);
      const missingRot =
        patch.rotacion_deg !== undefined &&
        (/rotacion|column|schema|42703|does not exist/i.test(msg) || msg.toLowerCase().includes("rotacion"));
      const missingSize =
        (patch.width !== undefined || patch.height !== undefined) &&
        (/width|height|column|schema|42703|does not exist/i.test(msg) || msg.toLowerCase().includes("width") || msg.toLowerCase().includes("height"));
      setErrMsg(
        missingRot
          ? `${msg} Añade la columna ejecutando en Supabase: supabase/patches/sala-mesas-rotacion-pared.sql`
          : missingSize
            ? `${msg} Añade las columnas ejecutando en Supabase: supabase/patches/sala-mesas-size.sql`
            : msg
      );
      void load();
    }
  }

  // Nota: merge por "hover 1s" retirado en esta versión simplificada.

  async function mergeMesaInto(targetMesaId: string) {
    if (!activeEstablishmentId) return;
    if (!canDrag) return;
    if (!selMesa) return;
    const target = mesas.find((m) => m.id === targetMesaId) ?? null;
    if (!target) return;
    if (target.id === selMesa.id) return;
    if (isDecorativo(target) || isDecorativo(selMesa)) return;
    const ok = typeof window !== "undefined" ? window.confirm(`¿Fusionar Mesa ${selMesa.numero} con Mesa ${target.numero}?`) : false;
    if (!ok) return;
    setErrMsg(null);
    try {
      const newPax = Math.max(0, (selMesa.pax_max ?? 0) + (target.pax_max ?? 0));
      const up = await supabase()
        .from("sala_mesas")
        .update({ pax_max: newPax })
        .eq("id", selMesa.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (up.error) throw up.error;
      const del = await supabase()
        .from("sala_mesas")
        .delete()
        .eq("id", target.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (del.error) throw del.error;
      setMergeMode(false);
      haptic(50);
      void load();
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
      void load();
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (error) return <main className="p-4 text-sm text-red-700">{supabaseErrToString(error)}</main>;
  if (!activeEstablishmentId) return <main className="p-4 text-sm text-slate-600">Selecciona un establecimiento.</main>;
  if (!canView) return <main className="p-4 text-sm text-slate-600">Acceso denegado.</main>;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      {isDesktop ? (
        <div className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6">
          <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
            <p className="text-sm font-extrabold uppercase tracking-wide text-white/60">Reservas</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-white">Esta sección está optimizada para dispositivos móviles</p>
            <p className="mt-2 text-sm text-white/70">Abre esta pantalla desde el móvil para gestionar el plano de sala con fluidez.</p>
          </div>
        </div>
      ) : (
        <main className="relative h-dvh w-full overflow-hidden bg-slate-50">
          {/* Fondo puntos */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundColor: "#F8FAFC",
              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.35) 1px, transparent 0)",
              backgroundSize: "22px 22px"
            }}
          />

          {/* Top bar */}
          <div className="absolute left-0 right-0 top-0 z-30 px-4 pt-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                aria-label="Volver"
                onClick={() => {
                  try {
                    if (typeof window !== "undefined" && window.history.length > 1) {
                      window.history.back();
                      return;
                    }
                  } catch {
                    // ignore
                  }
                  window.location.href = "/admin";
                }}
              >
                <ArrowLeft className="h-5 w-5 text-slate-700" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black tracking-tight text-slate-900">{(activeEstablishmentName ?? "").trim() || "Mi local"}</p>
                <div className="mt-1 flex gap-2">
                  <input
                    type="date"
                    className="min-h-9 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate((e.target as HTMLInputElement).value)}
                    aria-label="Fecha"
                  />
                  <select
                    className="min-h-9 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm"
                    value={turno}
                    onChange={(e) => {
                      const next = (e.target as HTMLSelectElement).value as TurnoKey;
                      setTurno(next === "comida" ? "comida" : "cena");
                      setHoraFocus(next === "comida" ? "14:00" : "21:00");
                    }}
                    aria-label="Turno"
                  >
                    <option value="comida">Comida</option>
                    <option value="cena">Cena</option>
                  </select>
                  <input
                    type="time"
                    className="min-h-9 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm"
                    value={horaFocus}
                    onChange={(e) => setHoraFocus((e.target as HTMLInputElement).value)}
                    aria-label="Hora"
                  />
                  {canDrag && planoUnlocked ? (
                    <input
                      className="min-h-9 max-w-[220px] rounded-2xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={zonaNameDraft}
                      onChange={(e) => {
                        const newValue = (e.target as HTMLInputElement).value;
                        setZonaNameDraft(newValue);
                      }}
                      onBlur={() => void saveZonaName(zonaNameDraft)}
                      placeholder="Nombre del plano"
                      aria-label="Nombre del plano"
                    />
                  ) : (
                    <select
                      className="min-h-9 max-w-[220px] rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm"
                      value={zonaId ?? ""}
                      onChange={(e) => {
                        const newValue = (e.target as HTMLSelectElement).value;
                        setZonaId(newValue || null);
                      }}
                    >
                    {zonas.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.nombre}
                      </option>
                    ))}
                    </select>
                  )}
                  {canDrag && planoUnlocked ? (
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm hover:bg-slate-50"
                      onClick={() => void createNuevaZona()}
                      title="Crear una nueva sala (zona) en el plano"
                    >
                      <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                      Nueva sala
                    </button>
                  ) : null}
                  {canDrag && planoUnlocked ? (
                    <button
                      type="button"
                      className="inline-flex min-h-9 items-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 text-xs font-extrabold text-rose-700 shadow-sm hover:bg-rose-100"
                      onClick={() => void deleteZonaActual()}
                      title="Eliminar sala actual"
                      disabled={!zonaId}
                    >
                      Eliminar sala
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="min-h-9 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm hover:bg-slate-50"
                    onClick={() => {
                      setPan({ x: 0, y: 0 });
                      setScale(1);
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="w-10" />
            </div>
          </div>

          {errMsg ? (
            <div className="absolute left-0 right-0 top-14 z-30 px-4">
              <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm font-semibold text-rose-100">{errMsg}</p>
            </div>
          ) : null}

          {/* Regla de oro: si hay mesa seleccionada, ocultar controles flotantes */}
          {/* Controles (solo cuando está BLOQUEADO) */}
          {!planoUnlocked && !selMesaId ? (
            <>
              <button
                type="button"
                className="absolute bottom-32 right-6 z-[999] grid h-14 w-14 place-items-center rounded-full border border-slate-200 bg-white shadow-lg"
                aria-label="Desbloquear plano"
                disabled={!canDrag}
                onClick={() => {
                  if (!canDrag) return;
                  setPlanoUnlocked(true);
                }}
                title="Desbloquear"
              >
                <Lock className="h-6 w-6 text-slate-800" />
              </button>

              <button
                type="button"
                className="absolute bottom-32 left-6 z-[999] min-h-10 rounded-full border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-800 shadow-lg hover:bg-slate-50"
                onClick={() => {
                  setPan({ x: 0, y: 0 });
                  setScale(1);
                }}
              >
                Centrar plano
              </button>
            </>
          ) : null}

          {/* Toolbar creación (solo en modo edición) */}
          {canDrag && planoUnlocked && !selMesaId ? (
            <div className="pointer-events-auto absolute bottom-32 left-1/2 z-[999] -translate-x-1/2">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-200 bg-white p-2 shadow-lg">
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => void createMesa("rect")}
                  disabled={!!creatingMesa}
                  aria-label="Añadir mesa cuadrada"
                  title="Mesa cuadrada"
                >
                  <Square className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => void createMesa("round")}
                  disabled={!!creatingMesa}
                  aria-label="Añadir mesa redonda"
                  title="Mesa redonda"
                >
                  <Circle className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => void createMesa("pared")}
                  disabled={!!creatingMesa || !zonaId}
                  aria-label="Añadir pared"
                  title="Pared"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => void createMesa("texto")}
                  disabled={!!creatingMesa || !zonaId}
                  aria-label="Añadir texto"
                  title="Texto"
                >
                  <Type className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="ml-2 min-h-12 rounded-full bg-blue-600 px-4 text-xs font-extrabold text-white shadow-sm hover:bg-blue-700"
                  onClick={() => setPlanoUnlocked(false)}
                >
                  Finalizar edición
                </button>
              </div>
            </div>
          ) : null}

          {/* Botón de bloquear prominente (al tocar fondo se cierra el panel) */}
          {canDrag && planoUnlocked && !selMesaId ? (
            <button
              type="button"
              className="absolute bottom-32 right-6 z-[999] grid h-14 w-14 place-items-center rounded-full border border-slate-200 bg-white shadow-lg hover:bg-slate-50"
              aria-label="Bloquear plano"
              onClick={() => setPlanoUnlocked(false)}
              title="Bloquear"
            >
              <Lock className="h-6 w-6 text-slate-800" />
            </button>
          ) : null}

          {/* Board */}
          <div className="absolute inset-x-0 bottom-0 top-0 pt-14">
            <div
              ref={boardRef}
              className="relative h-[calc(100dvh-56px)] w-full"
              style={{
                touchAction: "none",
                overscrollBehavior: "none"
              }}
              onPointerDown={onPointerDownBoard}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                className="absolute inset-0"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                  transformOrigin: "center",
                  transition: panningRef.current || draggingRef.current ? "none" : "transform 120ms ease"
                }}
              >
                {mesasZona.map((m) => {
                  const selected = sheetOpen && selMesaId === m.id;
                  const decor = isDecorativo(m);
                  const dk = decorKind(m);
                  const ui = !planoUnlocked && !decor ? { ...mesaAgendaColor(m), ring: "" } : mesaUi(m.estado, selected);
                  const isRound = m.forma === "round";
                  const left = `${m.x * 100}%`;
                  const top = `${m.y * 100}%`;
                  const puedeGirar = decor && dk !== "barra";
                  const rotDeg = puedeGirar ? Number(m.rotacion_deg ?? 0) || 0 : 0;
                  const fallback =
                    decor && dk === "pared"
                      ? { w: 100, h: 20 }
                      : decor && dk === "barra"
                        ? { w: 140, h: 60 }
                        : !decor
                          ? { w: 60, h: 60 }
                          : { w: 100, h: 20 };
                  const wPx =
                    m.width != null && Number.isFinite(Number(m.width)) && boardSize.w > 0 ? Math.max(6, Number(m.width) * boardSize.w) : fallback.w;
                  const hPx =
                    m.height != null && Number.isFinite(Number(m.height)) && boardSize.h > 0 ? Math.max(6, Number(m.height) * boardSize.h) : fallback.h;
                  const mesaStyle: React.CSSProperties = {
                    left,
                    top,
                    transform: puedeGirar ? `translate(-50%, -50%) rotate(${rotDeg}deg)` : "translate(-50%, -50%)",
                    width: decor && dk === "texto" ? "auto" : `${Math.round(wPx)}px`,
                    height: decor && dk === "texto" ? "auto" : `${Math.round(hPx)}px`,
                    ...(planoUnlocked && canDrag ? { touchAction: "none" } : {})
                  };
                  return (
                    <div
                      key={m.id}
                      className={[
                        "absolute select-none",
                        "grid place-items-center",
                        decor && dk === "texto" && !planoUnlocked ? "pointer-events-none" : "",
                        pinchSizingMesaId === m.id ? "ring-2 ring-blue-500/40" : "",
                        decor ? (dk === "texto" ? "" : "border border-slate-300") : isRound ? "rounded-full" : "rounded-2xl",
                        decor
                          ? dk === "texto"
                            ? ""
                            : dk === "pared"
                              ? "bg-slate-700 shadow-sm"
                              : dk === "barra"
                                ? "bg-slate-300 shadow-sm"
                                : "bg-slate-500/30 shadow-sm"
                          : ["border-2", ui.border, ui.ring, ui.bg, "shadow-sm"].join(" "),
                        "transition-transform duration-150 ease-out",
                        dk === "texto" ? "" : "active:scale-105",
                        planoUnlocked ? "cursor-grab active:cursor-grabbing border-dashed animate-pulse" : "cursor-pointer"
                      ].join(" ")}
                      style={mesaStyle}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (mergeMode && selMesaId && selMesaId !== m.id) {
                          void mergeMesaInto(m.id);
                          return;
                        }
                        // En modo edición: priorizamos layout (sin abrir Drawer).
                        if (planoUnlocked) {
                          setSelMesaId(m.id);
                          haptic(20);
                          // Decorativos: en edición el tap no abría el drawer; abrimos Gestionar para poder eliminar.
                          if (isDecorativo(m)) {
                            setSheetOpen(true);
                            setManageOpen(true);
                            setMergeMode(false);
                          }
                          return;
                        }
                        openMesa(m.id);
                        haptic(20);
                      }}
                      onPointerDown={planoUnlocked ? (e) => onPointerDownMesa(e, m) : undefined}
                      aria-label={`Mesa ${m.numero}`}
                    >
                      {decor && dk === "texto" ? (
                        <span className="pointer-events-none whitespace-nowrap text-[14px] font-medium tracking-wide text-slate-500">
                          {String(m.nombre ?? "").replace(/^texto:\s*/i, "").trim() || "Texto"}
                        </span>
                      ) : null}
                      {!decor ? <span className={["absolute left-2 top-2 h-2 w-2 rounded-full", ui.dot].join(" ")} aria-hidden /> : null}
                      {!decor ? (
                        <div className="text-center">
                          <p className="text-base font-extrabold text-slate-900">
                            {String(m.nombre ?? "").trim() || `Mesa ${m.numero}`}
                          </p>
                          <p className="mt-1 text-sm font-extrabold tabular-nums text-slate-700">{`${m.pax_max} pax`}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BottomSheet */}
          <Drawer
            open={sheetOpen}
            title={
              selMesa
                ? isDecorativo(selMesa)
                  ? String(selMesa.nombre ?? "").trim() || "Elemento"
                  : !planoUnlocked
                    ? "Reserva"
                    : `Mesa ${selMesa.numero}`
                : "Mesa"
            }
            onClose={() => {
              setSheetOpen(false);
              setManageOpen(false);
              setSelMesaId(null);
              setMergeMode(false);
              setEditingReservaId(null);
            }}
            variant="light"
          >
            {!selMesa ? null : (
              <div className="space-y-4 pb-6">
                {!manageOpen && planoUnlocked ? (
                  <button
                    type="button"
                    className="min-h-12 w-full rounded-2xl bg-blue-600 text-sm font-extrabold text-white hover:bg-blue-700"
                    onClick={() => setManageOpen(true)}
                  >
                    Gestionar
                  </button>
                ) : null}

                {/* Modo agenda (plano bloqueado): crear/editar/liberar reservas */}
                {!planoUnlocked && !selIsDecor ? (
                  <div className="space-y-3">
                    {(() => {
                      const now = selMesa ? (mesaReservaNowById.get(selMesa.id) ?? null) : null;
                      const later = selMesa ? (mesaHasLaterById.get(selMesa.id) ?? false) : false;
                      const statusLabel = now ? "Ocupada ahora" : later ? "Tiene reserva más tarde" : "Libre";
                      const statusClass = now ? "border-rose-200 bg-rose-50 text-rose-900" : later ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900";
                      return (
                        <div className={["rounded-3xl border p-3 text-sm font-semibold", statusClass].join(" ")}>
                          {statusLabel} · {selectedDate} · {turno} · {horaFocus}
                        </div>
                      );
                    })()}

                    {selMesa ? (
                      (() => {
                        const rNow = mesaReservaNowById.get(selMesa.id) ?? null;
                        if (rNow) {
                          return (
                            <div className="space-y-3">
                              <div className="rounded-3xl border border-slate-200 bg-white p-3">
                                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Reserva</p>
                                <p className="mt-2 text-base font-extrabold text-slate-900">{String(rNow.nombre ?? "").trim() || "Cliente"}</p>
                                <p className="mt-1 text-sm text-slate-700">
                                  {String(rNow.telefono ?? "").trim() || "—"} ·{" "}
                                  <span className="font-semibold tabular-nums">{Math.max(1, Math.trunc(Number(rNow.pax) || 1))} pax</span>
                                </p>
                                <p className="mt-1 text-sm font-semibold text-slate-700">{String(rNow.hora ?? "").trim() || "—"}</p>
                                {String(rNow.notas ?? "").trim() ? (
                                  <p className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                                    {String(rNow.notas ?? "").trim()}
                                  </p>
                                ) : null}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  className="min-h-12 rounded-2xl border border-slate-200 bg-white text-sm font-extrabold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                                  disabled={savingReserva}
                                  onClick={() => startEditarReserva(rNow)}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="min-h-12 rounded-2xl border border-rose-200 bg-rose-50 text-sm font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                                  disabled={savingReserva}
                                  onClick={() => void liberarMesa()}
                                >
                                  Liberar mesa
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-3">
                            <div className="rounded-3xl border border-slate-200 bg-white p-3">
                              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
                                {editingReservaId ? "Editar reserva manual" : "Crear reserva manual"}
                              </p>
                              <div className="mt-3 grid gap-2">
                                <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Nombre</label>
                                <input
                                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                                  value={reservaDraft.nombre}
                                  onChange={(e) => setReservaDraft((d) => ({ ...d, nombre: (e.target as HTMLInputElement).value }))}
                                  placeholder="Nombre del cliente"
                                />
                              </div>
                              <div className="mt-3 grid gap-2">
                                <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Teléfono</label>
                                <input
                                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                                  value={reservaDraft.telefono}
                                  onChange={(e) => setReservaDraft((d) => ({ ...d, telefono: (e.target as HTMLInputElement).value }))}
                                  placeholder="+34 600 000 000"
                                  inputMode="tel"
                                />
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-3">
                                <div className="grid gap-2">
                                  <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Comensales</label>
                                  <input
                                    type="number"
                                    min={1}
                                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                                    value={String(reservaDraft.pax)}
                                    onChange={(e) => setReservaDraft((d) => ({ ...d, pax: Math.max(1, Math.trunc(Number((e.target as HTMLInputElement).value) || 1)) }))}
                                  />
                                </div>
                                <div className="grid gap-2">
                                  <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Hora</label>
                                  <input
                                    type="time"
                                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900"
                                    value={reservaDraft.hora}
                                    onChange={(e) => setReservaDraft((d) => ({ ...d, hora: (e.target as HTMLInputElement).value }))}
                                  />
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2">
                                <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Notas</label>
                                <textarea
                                  className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                                  value={reservaDraft.notas}
                                  onChange={(e) => setReservaDraft((d) => ({ ...d, notas: (e.target as HTMLTextAreaElement).value }))}
                                  placeholder="Ej: Alérgico al gluten"
                                />
                              </div>
                            </div>

                            <button
                              type="button"
                              className="min-h-12 w-full rounded-2xl bg-slate-900 text-sm font-extrabold text-white hover:bg-black disabled:opacity-60"
                              disabled={savingReserva}
                              onClick={() => void saveReservaManual()}
                            >
                              {savingReserva ? "Guardando…" : editingReservaId ? "Guardar cambios" : "Crear reserva"}
                            </button>
                          </div>
                        );
                      })()
                    ) : null}
                  </div>
                ) : null}

                {manageOpen ? (
                  <div className="space-y-3">
                    {mergeMode ? (
                      <div className="rounded-3xl border border-violet-400/20 bg-violet-500/10 p-3">
                        <p className="text-sm font-extrabold text-violet-100">Modo fusión activo</p>
                        <p className="mt-1 text-xs font-semibold text-violet-100/80">Toca otra mesa para fusionar capacidades (la secundaria se elimina).</p>
                        <button
                          type="button"
                          className="mt-3 min-h-12 w-full rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10"
                          onClick={() => setMergeMode(false)}
                        >
                          Cancelar fusión
                        </button>
                      </div>
                    ) : null}

                    {!selIsDecor ? (
                      <>
                        <div className="rounded-3xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Tamaño</p>
                          <p className="mt-2 text-sm text-slate-600">
                            Con el plano desbloqueado, usa <span className="font-semibold">dos dedos</span> sobre la mesa seleccionada para redimensionarla.
                          </p>
                        </div>

                        {/* Identificador */}
                        <div className="rounded-3xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Identificador</p>
                          <p className="mt-1 text-sm text-slate-600">Puede ser número o nombre (ej: “Mesa 1”, “Rincón VIP”).</p>
                          <input
                            className="mt-3 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
                            value={String(selMesa.nombre ?? "").trim()}
                            onChange={(e) => {
                              const val = (e.target as HTMLInputElement).value;
                              setMesas((prev) => prev.map((m) => (m.id === selMesa.id ? { ...m, nombre: val } : m)));
                            }}
                            onBlur={() => void updateMesaFields({ nombre: String(selMesa.nombre ?? "").trim() })}
                            disabled={!canDrag}
                            placeholder={`Mesa ${selMesa.numero}`}
                            aria-label="Identificador de mesa"
                          />
                          {!canDrag ? <p className="mt-2 text-xs font-semibold text-slate-500">Solo Admin puede editar el identificador.</p> : null}
                        </div>

                        {/* Comensales (pax) */}
                        <div className="rounded-3xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Comensales</p>
                          <div className="mt-2 grid grid-cols-6 gap-2">
                            {Array.from({ length: 12 }).map((_, i) => {
                              const n = i + 1;
                              const active = selMesa.pax_max === n;
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  className={[
                                    "h-11 rounded-full border text-sm font-extrabold",
                                    active ? "border-blue-600/30 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
                                    !canDrag ? "opacity-50" : ""
                                  ].join(" ")}
                                  disabled={!canDrag}
                                  onClick={() => {
                                    haptic(20);
                                    void updateMesaFields({ pax_max: n });
                                  }}
                                  aria-label={`Pax ${n}`}
                                >
                                  {n}
                                </button>
                              );
                            })}
                          </div>
                          {!canDrag ? <p className="mt-2 text-xs font-semibold text-slate-500">Solo Admin puede editar comensales.</p> : null}
                        </div>

                        <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Estado</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" className="min-h-12 rounded-2xl border border-slate-200 bg-white text-sm font-extrabold text-slate-900 hover:bg-slate-50" onClick={() => void setEstado("libre")}>
                            Libre
                          </button>
                          <button type="button" className="min-h-12 rounded-2xl border border-slate-200 bg-white text-sm font-extrabold text-slate-900 hover:bg-slate-50" onClick={() => void setEstado("reservada")}>
                            Reservada
                          </button>
                        </div>

                        {/* Reservas del día */}
                        <div className="rounded-3xl border border-slate-200 bg-white p-3">
                          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Reservas ({selectedDate})</p>
                          {(() => {
                            const rows = reservasByMesa.get(selMesa.id) ?? [];
                            if (!rows.length) {
                              return <p className="mt-2 text-sm text-slate-600">Sin reservas confirmadas para esta mesa.</p>;
                            }
                            return (
                              <ul className="mt-2 space-y-2">
                                {rows.map((r) => {
                                  const ini = String(r.hora ?? "").trim() || "—";
                                  const fin = ini && ini !== "—" ? addMinutesToHora(ini, 90) : "";
                                  const rango = fin ? `${ini}–${fin}` : ini;
                                  const nombre = String(r.nombre ?? "").trim() || "Reserva";
                                  const pax = Math.max(1, Math.trunc(Number(r.pax) || 1));
                                  return (
                                    <li key={r.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                      <p className="text-sm font-extrabold text-slate-900">{rango}</p>
                                      <p className="mt-0.5 text-sm text-slate-700">
                                        {nombre} · <span className="font-semibold tabular-nums">{pax} pax</span>
                                      </p>
                                    </li>
                                  );
                                })}
                              </ul>
                            );
                          })()}
                          <p className="mt-2 text-xs text-slate-500">Duración estimada: 90 min (ajustable en una siguiente iteración).</p>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-3xl border border-slate-200 bg-white p-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {decorKind(selMesa) === "pared"
                            ? "Pared"
                            : decorKind(selMesa) === "barra"
                              ? "Barra"
                              : decorKind(selMesa) === "texto"
                                ? "Texto"
                                : "Elemento estructural"}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {selPuedeGirarDecor
                            ? "Puedes moverlo, girarlo o eliminarlo."
                            : "Solo se puede mover o eliminar."}
                        </p>
                        {decorKind(selMesa) === "texto" && canDrag ? (
                          <div className="mt-3 grid gap-2">
                            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Contenido</label>
                            <input
                              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                              value={String(selMesa.nombre ?? "").replace(/^texto:\s*/i, "")}
                              onChange={(e) => {
                                const newValue = (e.target as HTMLInputElement).value;
                                const v = newValue;
                                setMesas((prev) => prev.map((m) => (m.id === selMesa.id ? { ...m, nombre: `Texto: ${v}` } : m)));
                              }}
                              onBlur={() => {
                                const v = String(selMesa.nombre ?? "").replace(/^texto:\s*/i, "");
                                void updateMesaFields({ nombre: `Texto: ${v}` });
                              }}
                              placeholder="Ej: Zona Barra"
                              aria-label="Texto"
                            />
                          </div>
                        ) : null}
                        {selPuedeGirarDecor && canDrag ? (
                          <button
                            type="button"
                            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                            onClick={() => {
                              haptic(25);
                              const cur = Number(selMesa.rotacion_deg ?? 0) || 0;
                              void updateMesaFields({ rotacion_deg: (cur + 90) % 360 });
                            }}
                          >
                            <RotateCw className="h-5 w-5" aria-hidden />
                            Girar 90°
                          </button>
                        ) : null}
                      </div>
                    )}

                    {canDrag ? (
                      <div className="pt-2">
                        <button
                          type="button"
                          className="min-h-12 w-full rounded-2xl border border-rose-300 bg-rose-50 text-sm font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          onClick={() => void deleteMesa()}
                          disabled={deletingMesa}
                        >
                          {deletingMesa ? "Eliminando…" : "Eliminar"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </Drawer>
        </main>
      )}
    </div>
  );
}

