"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Circle, Crown, Lock, LockOpen, Square, RectangleHorizontal, Minus } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useCambiosGlobalesRealtime } from "@/lib/useCambiosGlobalesRealtime";

type MesaEstado = "libre" | "reservada" | "ocupada" | "sucia";

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
  estado: MesaEstado;
  hora_checkin?: string | null;
  updated_at?: string | null;
};

type Zona = { id: string; nombre: string; sort: number };

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function haptic(ms = 50) {
  try {
    if (typeof window !== "undefined") window.navigator?.vibrate?.(ms);
  } catch {
    // ignore
  }
}

function neonFor(estado: MesaEstado, selected: boolean) {
  if (selected) return { border: "border-violet-400", glow: "shadow-[0_0_18px_rgba(167,139,250,0.55)]", dot: "bg-violet-400" };
  if (estado === "libre") return { border: "border-emerald-400", glow: "shadow-[0_0_16px_rgba(52,211,153,0.45)]", dot: "bg-emerald-400" };
  if (estado === "ocupada") return { border: "border-rose-400", glow: "shadow-[0_0_16px_rgba(251,113,133,0.45)]", dot: "bg-rose-400" };
  if (estado === "reservada") return { border: "border-sky-400", glow: "shadow-[0_0_16px_rgba(56,189,248,0.40)]", dot: "bg-sky-400" };
  return { border: "border-amber-300", glow: "shadow-[0_0_16px_rgba(252,211,77,0.35)]", dot: "bg-amber-300" };
}

function elapsedLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
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

  const [planoUnlocked, setPlanoUnlocked] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isInteracting, setIsInteracting] = useState(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<null | { mesaId: string; startClientX: number; startClientY: number; startX: number; startY: number }>(null);
  const panningRef = useRef<null | { startClientX: number; startClientY: number; startPanX: number; startPanY: number }>(null);
  const mergeHoverRef = useRef<null | { sourceMesaId: string; targetMesaId: string; startedAt: number }>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selMesaId, setSelMesaId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [creatingMesa, setCreatingMesa] = useState<null | "rect" | "round" | "vip">(null);
  const [deletingMesa, setDeletingMesa] = useState(false);
  const [mergePrompt, setMergePrompt] = useState<null | { sourceMesaId: string; targetMesaId: string }>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [zonaNameDraft, setZonaNameDraft] = useState("");

  const selMesa = useMemo(() => mesas.find((m) => m.id === selMesaId) ?? null, [mesas, selMesaId]);
  const mesasZona = useMemo(() => mesas.filter((m) => m.zona_id === (zonaId ?? "")), [mesas, zonaId]);

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
      try {
        const m = await supabase()
          .from("sala_mesas")
          .select("id,zona_id,numero,pax_max,forma,es_decorativo,nombre,x,y,estado,hora_checkin,updated_at")
          .eq("establecimiento_id", activeEstablishmentId);
        if (m.error) throw m.error;
        setMesas(((m.data ?? []) as unknown as Mesa[]) ?? []);
      } catch (e) {
        try {
          // eslint-disable-next-line no-console
          console.error("[reservas] select con es_decorativo/nombre falló; fallback sin columnas", e);
        } catch {
          // ignore
        }
        const m2 = await supabase()
          .from("sala_mesas")
          .select("id,zona_id,numero,pax_max,forma,x,y,estado,hora_checkin,updated_at")
          .eq("establecimiento_id", activeEstablishmentId);
        if (m2.error) throw m2.error;
        setMesas(((m2.data ?? []) as unknown as Mesa[]) ?? []);
      }
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    }
  }, [activeEstablishmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useCambiosGlobalesRealtime({
    establecimientoId: activeEstablishmentId,
    tables: ["sala_zonas", "sala_mesas", "sala_reservas"],
    onChange: () => void load()
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
    const onTouchMove = (ev: TouchEvent) => {
      if (draggingRef.current || panningRef.current) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchmove", onTouchMove as EventListener);
    };
  }, []);

  function openMesa(mesaId: string) {
    setSelMesaId(mesaId);
    setManageOpen(false);
    setSheetOpen(true);
    setMergeMode(false);
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

  function centerOfViewportToWorld01(): { x: number; y: number } {
    const el = boardRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const rect = el.getBoundingClientRect();
    // Inverse de transform: screen = (worldPx + pan) * scale
    const worldPxX = rect.width / 2 / scale - pan.x;
    const worldPxY = rect.height / 2 / scale - pan.y;
    return { x: clamp01(worldPxX / rect.width), y: clamp01(worldPxY / rect.height) };
  }

  async function createMesa(kind: "rect" | "round" | "vip" | "pared" | "barra") {
    if (!activeEstablishmentId || !zonaId) return;
    if (!canDrag || !planoUnlocked) return;
    if (creatingMesa) return;
    setErrMsg(null);
    setCreatingMesa(kind === "pared" ? "rect" : kind === "barra" ? "vip" : kind);
    try {
      const { x, y } = centerOfViewportToWorld01();
      const forma = kind === "round" ? "round" : "rect";
      const isDecor = kind === "pared" || kind === "barra";
      const paxMax = isDecor ? 0 : kind === "vip" ? 6 : 4;

      // Numero: las mesas decorativas no usan "número"; como la columna es NOT NULL,
      // usamos números negativos correlativos para evitar colisiones con mesas reales.
      const maxPos = mesasZona.reduce((acc, m) => Math.max(acc, m.numero || 0), 0);
      const minAny = mesasZona.reduce((acc, m) => Math.min(acc, m.numero || 0), 0);
      const nextNumero = isDecor ? Math.min(-1, minAny - 1) : maxPos + 1;

      const basePayload: Record<string, unknown> = {
        establecimiento_id: activeEstablishmentId,
        zona_id: zonaId,
        numero: nextNumero,
        pax_max: paxMax,
        forma,
        x,
        y,
        estado: "libre",
        nombre: isDecor ? (kind === "pared" ? "Pared" : "Barra/Escenario") : null,
        es_decorativo: isDecor
      };

      // Compatibilidad: si la columna `es_decorativo/nombre` aún no existe, degradamos sin romper.
      let newId: string | null = null;
      try {
        const res = await supabase().from("sala_mesas").insert(basePayload).select("id").single();
        if (res.error) throw res.error;
        newId = (res.data as unknown as { id: string } | null)?.id ?? null;
      } catch (e) {
        try {
          // eslint-disable-next-line no-console
          console.error("[reservas] create mesa payload failed; retry without decor fields", e);
        } catch {
          // ignore
        }
        const fallback: Record<string, unknown> = { ...basePayload };
        delete fallback.es_decorativo;
        delete fallback.nombre;
        const res2 = await supabase().from("sala_mesas").insert(fallback).select("id").single();
        if (res2.error) throw res2.error;
        newId = (res2.data as unknown as { id: string } | null)?.id ?? null;
      }

      haptic(50);
      if (newId) {
        setSelMesaId(newId);
        setSheetOpen(true);
        setManageOpen(true);
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
    e.preventDefault();
    e.stopPropagation();
    setIsInteracting(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panningRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPanX: pan.x, startPanY: pan.y };
  }

  function onPointerDownMesa(e: React.PointerEvent, mesa: Mesa) {
    if (!canDrag) return;
    if (!planoUnlocked) return;
    if (mesa.es_decorativo) {
      // Decorativos se pueden mover igual, sin bloqueos extra
    }
    e.preventDefault();
    e.stopPropagation();
    setIsInteracting(true);
    haptic(20);
    try {
      // eslint-disable-next-line no-console
      console.log("Interacción detectada en mesa:", mesa.id);
    } catch {
      // ignore
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = { mesaId: mesa.id, startClientX: e.clientX, startClientY: e.clientY, startX: mesa.x, startY: mesa.y };
    mergeHoverRef.current = null;
    setMergePrompt(null);
  }

  function onPointerMove(e: React.PointerEvent) {
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

      // Merge detection (hover 1s encima)
      const src = mesas.find((m) => m.id === drag.mesaId) ?? null;
      const others = mesasZona.filter((m) => m.id !== drag.mesaId);
      const thresholdPx = 56;
      const srcPx = { x: (nx * rect.width + pan.x) * scale, y: (ny * rect.height + pan.y) * scale };
      let hoveredTarget: string | null = null;
      for (const t of others) {
        const tx = (t.x * rect.width + pan.x) * scale;
        const ty = (t.y * rect.height + pan.y) * scale;
        const dist = Math.hypot(srcPx.x - tx, srcPx.y - ty);
        if (dist <= thresholdPx) {
          hoveredTarget = t.id;
          break;
        }
      }
      if (!src || !hoveredTarget) {
        mergeHoverRef.current = null;
        return;
      }
      const now = Date.now();
      const prev = mergeHoverRef.current;
      if (!prev || prev.targetMesaId !== hoveredTarget || prev.sourceMesaId !== drag.mesaId) {
        mergeHoverRef.current = { sourceMesaId: drag.mesaId, targetMesaId: hoveredTarget, startedAt: now };
        return;
      }
      if (now - prev.startedAt >= 1000) {
        setMergePrompt({ sourceMesaId: drag.mesaId, targetMesaId: hoveredTarget });
      }
      return;
    }
    const p = panningRef.current;
    if (p) {
      e.preventDefault();
      e.stopPropagation();
      setPan({ x: p.startPanX + (e.clientX - p.startClientX), y: p.startPanY + (e.clientY - p.startClientY) });
    }
  }

  async function onPointerUp() {
    const drag = draggingRef.current;
    draggingRef.current = null;
    panningRef.current = null;
    mergeHoverRef.current = null;
    setIsInteracting(false);
    if (!drag) return;
    const mesa = mesas.find((m) => m.id === drag.mesaId) ?? null;
    if (!mesa) return;
    if (mergePrompt?.sourceMesaId === mesa.id) {
      setSelMesaId(mesa.id);
      setSheetOpen(true);
      setManageOpen(true);
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

  async function deleteMesa() {
    if (!selMesa || !activeEstablishmentId) return;
    if (!canDrag || !planoUnlocked) return;
    if (deletingMesa) return;
    const ok = typeof window !== "undefined" ? window.confirm(`¿Eliminar la mesa ${selMesa.numero}?`) : false;
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
      setSelMesaId(null);
      void load();
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    } finally {
      setDeletingMesa(false);
    }
  }

  async function updateMesaFields(patch: Partial<Pick<Mesa, "numero" | "pax_max">>) {
    if (!selMesa || !activeEstablishmentId) return;
    if (!canDrag) return;
    setErrMsg(null);
    setMesas((prev) => prev.map((m) => (m.id === selMesa.id ? { ...m, ...patch } : m)));
    try {
      const res = await supabase()
        .from("sala_mesas")
        .update(patch)
        .eq("id", selMesa.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (res.error) throw res.error;
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
      void load();
    }
  }

  async function mergeMesas() {
    if (!mergePrompt || !activeEstablishmentId) return;
    if (!canDrag || !planoUnlocked) return;
    const source = mesas.find((m) => m.id === mergePrompt.sourceMesaId) ?? null;
    const target = mesas.find((m) => m.id === mergePrompt.targetMesaId) ?? null;
    if (!source || !target) return;
    const ok = typeof window !== "undefined" ? window.confirm(`¿Fusionar Mesa ${source.numero} con Mesa ${target.numero}?`) : false;
    if (!ok) return;
    setErrMsg(null);
    try {
      const newPax = (source.pax_max ?? 0) + (target.pax_max ?? 0);
      const midX = clamp01((source.x + target.x) / 2);
      const midY = clamp01((source.y + target.y) / 2);
      const up = await supabase()
        .from("sala_mesas")
        .update({ pax_max: newPax, x: midX, y: midY })
        .eq("id", source.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (up.error) throw up.error;
      const del = await supabase()
        .from("sala_mesas")
        .delete()
        .eq("id", target.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (del.error) throw del.error;
      setMergePrompt(null);
      haptic(50);
      void load();
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
      void load();
    }
  }

  async function mergeMesaInto(targetMesaId: string) {
    if (!activeEstablishmentId) return;
    if (!canDrag) return;
    if (!selMesa) return;
    const target = mesas.find((m) => m.id === targetMesaId) ?? null;
    if (!target) return;
    if (target.id === selMesa.id) return;
    if (target.es_decorativo || selMesa.es_decorativo) return;
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
    <div className="min-h-dvh bg-[#0A0A0C] text-white">
      {isDesktop ? (
        <div className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6">
          <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl">
            <p className="text-sm font-extrabold uppercase tracking-wide text-white/60">Reservas</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-white">Esta sección está optimizada para dispositivos móviles</p>
            <p className="mt-2 text-sm text-white/70">Abre esta pantalla desde el móvil para gestionar el plano de sala con fluidez.</p>
          </div>
        </div>
      ) : (
        <main className="relative h-dvh w-full overflow-hidden">
          {/* Fondo puntos */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundColor: "#0A0A0C",
              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)",
              backgroundSize: "20px 20px"
            }}
          />

          {/* Top bar */}
          <div className="absolute left-0 right-0 top-0 z-30 px-4 pt-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur hover:bg-white/10"
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
                <ArrowLeft className="h-5 w-5 text-white/80" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black tracking-tight text-white">{(activeEstablishmentName ?? "").trim() || "Mi local"}</p>
                <div className="mt-1 flex gap-2">
                  {canDrag && planoUnlocked ? (
                    <input
                      className="min-h-9 max-w-[220px] rounded-2xl border border-white/10 bg-white/5 px-3 text-xs font-extrabold text-white placeholder:text-white/40 backdrop-blur focus:outline-none focus:ring-2 focus:ring-[rgba(163,73,242,0.35)]"
                      value={zonaNameDraft}
                      onChange={(e) => {
                        setZonaNameDraft(e.currentTarget.value);
                      }}
                      onBlur={() => void saveZonaName(zonaNameDraft)}
                      placeholder="Nombre del plano"
                      aria-label="Nombre del plano"
                    />
                  ) : (
                    <select
                      className="min-h-9 max-w-[220px] rounded-2xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/80 backdrop-blur"
                      value={zonaId ?? ""}
                      onChange={(e) => setZonaId(e.currentTarget.value || null)}
                    >
                    {zonas.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.nombre}
                      </option>
                    ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="min-h-9 rounded-2xl border border-white/10 bg-white/5 px-3 text-xs font-extrabold text-white/80 backdrop-blur hover:bg-white/10"
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

          {/* FAB lock */}
          <button
            type="button"
            className={[
              "absolute bottom-28 right-6 z-[999] grid h-14 w-14 place-items-center rounded-full border shadow-2xl backdrop-blur",
              planoUnlocked ? "border-violet-400/30 bg-[#A349F2]" : "border-white/10 bg-white/10"
            ].join(" ")}
            aria-label={planoUnlocked ? "Bloquear plano" : "Desbloquear plano"}
            disabled={!canDrag}
            onClick={() => {
              if (!canDrag) return;
              setPlanoUnlocked((v) => !v);
            }}
            title={planoUnlocked ? "Bloquear" : "Desbloquear"}
          >
            {planoUnlocked ? <LockOpen className="h-6 w-6 text-white" /> : <Lock className="h-6 w-6 text-white" />}
          </button>

          {/* FAB reset vista */}
          <button
            type="button"
            className="absolute bottom-28 left-6 z-[999] min-h-10 rounded-full border border-white/10 bg-white/10 px-4 text-xs font-extrabold text-white backdrop-blur hover:bg-white/15"
            onClick={() => {
              setPan({ x: 0, y: 0 });
              setScale(1);
            }}
          >
            Centrar plano
          </button>

          {/* Toolbar creación (solo en modo edición) */}
          {canDrag && planoUnlocked ? (
            <div className="pointer-events-auto absolute bottom-28 left-1/2 z-[999] -translate-x-1/2">
              <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/10 p-2 shadow-2xl backdrop-blur">
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-[#A349F2] text-white hover:brightness-110 disabled:opacity-50"
                  onClick={() => void createMesa("rect")}
                  disabled={!!creatingMesa}
                  aria-label="Añadir mesa cuadrada"
                  title="Mesa cuadrada"
                >
                  <Square className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-[#A349F2] text-white hover:brightness-110 disabled:opacity-50"
                  onClick={() => void createMesa("round")}
                  disabled={!!creatingMesa}
                  aria-label="Añadir mesa redonda"
                  title="Mesa redonda"
                >
                  <Circle className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-[#A349F2] text-white hover:brightness-110 disabled:opacity-50"
                  onClick={() => void createMesa("vip")}
                  disabled={!!creatingMesa}
                  aria-label="Añadir sofá/VIP"
                  title="Sofá/VIP"
                >
                  <Crown className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-[#A349F2] text-white hover:brightness-110 disabled:opacity-50"
                  onClick={() => void createMesa("pared")}
                  disabled={!!creatingMesa}
                  aria-label="Añadir pared"
                  title="Pared"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-[#A349F2] text-white hover:brightness-110 disabled:opacity-50"
                  onClick={() => void createMesa("barra")}
                  disabled={!!creatingMesa}
                  aria-label="Añadir barra o escenario"
                  title="Barra/Escenario"
                >
                  <RectangleHorizontal className="h-5 w-5" />
                </button>
              </div>
            </div>
          ) : null}

          {/* Board */}
          <div className="absolute inset-x-0 bottom-0 top-0 pt-14">
            <div
              ref={boardRef}
              className="relative h-[calc(100dvh-56px)] w-full"
              style={{
                touchAction: isInteracting || (canDrag && planoUnlocked) ? "none" : "manipulation",
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
                  const neon = neonFor(m.estado, selected);
                  const elapsed = m.estado === "ocupada" ? elapsedLabel(m.hora_checkin) : null;
                  const isRound = m.forma === "round";
                  const isVip = (m.forma ?? "rect") === "rect" && (m.pax_max ?? 0) >= 6;
                  const isDecor = !!m.es_decorativo;
                  const left = `${m.x * 100}%`;
                  const top = `${m.y * 100}%`;
                  const mesaStyle: React.CSSProperties = planoUnlocked && canDrag ? { left, top, touchAction: "none" } : { left, top };
                  return (
                    <div
                      key={m.id}
                      className={[
                        "absolute -translate-x-1/2 -translate-y-1/2 select-none",
                        "grid place-items-center",
                        isVip ? "h-20 w-36" : "h-24 w-24",
                        isRound ? "rounded-full" : "rounded-2xl",
                        "border-2",
                        neon.border,
                        neon.glow,
                        "bg-white/5",
                        "backdrop-blur",
                        "transition-transform duration-150 ease-out",
                        "active:scale-105",
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
                          return;
                        }
                        openMesa(m.id);
                        haptic(20);
                      }}
                      onPointerDown={planoUnlocked ? (e) => onPointerDownMesa(e, m) : undefined}
                      aria-label={`Mesa ${m.numero}`}
                    >
                      <span className={["absolute left-2 top-2 h-2 w-2 rounded-full", neon.dot].join(" ")} aria-hidden />
                      <div className="text-center">
                        <p className="text-xl font-black tabular-nums text-white">{isDecor ? "—" : m.numero}</p>
                        <p className="mt-0.5 text-[11px] font-semibold text-white/70">{isDecor ? (m.nombre ?? "Decorativo") : `${m.pax_max} pax`}</p>
                        {elapsed ? <p className="mt-1 text-[11px] font-extrabold text-white/80">{elapsed}</p> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BottomSheet */}
          <Drawer open={sheetOpen} title={selMesa ? `Mesa ${selMesa.numero}` : "Mesa"} onClose={() => setSheetOpen(false)} variant="dark">
            {!selMesa ? null : (
              <div className="space-y-4 pb-6">
                <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                  <div className="flex h-36 items-center justify-center text-sm font-semibold text-white/60">Foto de la vista (placeholder)</div>
                </div>
                <button
                  type="button"
                  className="min-h-12 w-full rounded-2xl bg-white text-sm font-extrabold text-[#0A0A0C]"
                  onClick={() => setManageOpen(true)}
                >
                  Gestionar
                </button>

                {planoUnlocked && canDrag ? (
                  <button
                    type="button"
                    className="min-h-12 w-full rounded-2xl border border-rose-400/30 bg-rose-500/15 text-sm font-extrabold text-rose-100 shadow-[0_0_0_1px_rgba(244,63,94,0.10)] hover:bg-rose-500/20 disabled:opacity-60"
                    onClick={() => void deleteMesa()}
                    disabled={deletingMesa}
                  >
                    {deletingMesa ? "Eliminando…" : "Eliminar mesa"}
                  </button>
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

                    {/* Número */}
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-white/60">Número</p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-lg font-black text-white/90 disabled:opacity-50"
                          onClick={() => void updateMesaFields({ numero: Math.max(1, (selMesa.numero ?? 1) - 1) })}
                          disabled={!canDrag}
                        >
                          −
                        </button>
                        <p className="text-3xl font-black tabular-nums text-white">{selMesa.numero}</p>
                        <button
                          type="button"
                          className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-lg font-black text-white/90 disabled:opacity-50"
                          onClick={() => void updateMesaFields({ numero: (selMesa.numero ?? 1) + 1 })}
                          disabled={!canDrag}
                        >
                          +
                        </button>
                      </div>
                      {!canDrag ? <p className="mt-2 text-xs font-semibold text-white/50">Solo Admin puede editar el número.</p> : null}
                    </div>

                    {/* Comensales (pax) */}
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-white/60">Comensales</p>
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
                                active ? "border-violet-400/40 bg-violet-500/15 text-white" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
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
                      {!canDrag ? <p className="mt-2 text-xs font-semibold text-white/50">Solo Admin puede editar comensales.</p> : null}
                    </div>

                    <p className="text-xs font-extrabold uppercase tracking-wide text-white/60">Estado</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="min-h-12 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10" onClick={() => void setEstado("libre")}>
                        Libre
                      </button>
                      <button type="button" className="min-h-12 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10" onClick={() => void setEstado("reservada")}>
                        Reservada
                      </button>
                      <button type="button" className="min-h-12 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10" onClick={() => void setEstado("ocupada")}>
                        Ocupada
                      </button>
                      <button type="button" className="min-h-12 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10" onClick={() => void setEstado("sucia")}>
                        Sucia
                      </button>
                    </div>

                    {planoUnlocked && canDrag ? (
                      <div className="pt-2">
                        <button
                          type="button"
                          className="mb-2 min-h-12 w-full rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10"
                          onClick={() => {
                            if (selMesa?.es_decorativo) return;
                            setMergeMode(true);
                          }}
                          disabled={!!selMesa?.es_decorativo}
                        >
                          Fusionar
                        </button>
                        {mergePrompt?.sourceMesaId === selMesa.id ? (
                          <button
                            type="button"
                            className="mb-2 min-h-12 w-full rounded-2xl border border-violet-400/20 bg-violet-500/10 text-sm font-extrabold text-violet-100 hover:bg-violet-500/15"
                            onClick={() => void mergeMesas()}
                          >
                            ¿Fusionar con Mesa {(mesas.find((m) => m.id === mergePrompt.targetMesaId)?.numero ?? "…")}?
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="min-h-12 w-full rounded-2xl border border-rose-400/20 bg-rose-500/10 text-sm font-extrabold text-rose-100 hover:bg-rose-500/15 disabled:opacity-60"
                          onClick={() => void deleteMesa()}
                          disabled={deletingMesa}
                        >
                          {deletingMesa ? "Eliminando…" : "Eliminar mesa"}
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

