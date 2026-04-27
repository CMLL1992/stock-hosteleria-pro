"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Lock, LockOpen } from "lucide-react";
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
  x: number; // 0..1
  y: number; // 0..1
  estado: MesaEstado;
  updated_at?: string | null;
};

type Zona = { id: string; nombre: string; sort: number };

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function neonFor(estado: MesaEstado, selected: boolean) {
  if (selected) return { border: "border-violet-400", glow: "shadow-[0_0_18px_rgba(167,139,250,0.55)]", dot: "bg-violet-400" };
  if (estado === "libre") return { border: "border-emerald-400", glow: "shadow-[0_0_16px_rgba(52,211,153,0.45)]", dot: "bg-emerald-400" };
  if (estado === "ocupada") return { border: "border-rose-400", glow: "shadow-[0_0_16px_rgba(251,113,133,0.45)]", dot: "bg-rose-400" };
  if (estado === "reservada") return { border: "border-sky-400", glow: "shadow-[0_0_16px_rgba(56,189,248,0.40)]", dot: "bg-sky-400" };
  return { border: "border-amber-300", glow: "shadow-[0_0_16px_rgba(252,211,77,0.35)]", dot: "bg-amber-300" };
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
  const canAdmin = hasPermission(role, "admin");
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

  const boardRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<null | { mesaId: string; startClientX: number; startClientY: number; startX: number; startY: number }>(null);
  const panningRef = useRef<null | { startClientX: number; startClientY: number; startPanX: number; startPanY: number }>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selMesaId, setSelMesaId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

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

      const m = await supabase()
        .from("sala_mesas")
        .select("id,zona_id,numero,pax_max,x,y,estado,updated_at")
        .eq("establecimiento_id", activeEstablishmentId);
      if (m.error) throw m.error;
      setMesas(((m.data ?? []) as unknown as Mesa[]) ?? []);
    } catch (e) {
      setErrMsg(supabaseErrToString(e));
    }
  }, [activeEstablishmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useCambiosGlobalesRealtime({
    establecimientoId: activeEstablishmentId,
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

  function openMesa(mesaId: string) {
    setSelMesaId(mesaId);
    setManageOpen(false);
    setSheetOpen(true);
  }

  function onPointerDownBoard(e: React.PointerEvent) {
    if (draggingRef.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panningRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPanX: pan.x, startPanY: pan.y };
  }

  function onPointerDownMesa(e: React.PointerEvent, mesa: Mesa) {
    if (!planoUnlocked) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = { mesaId: mesa.id, startClientX: e.clientX, startClientY: e.clientY, startX: mesa.x, startY: mesa.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = draggingRef.current;
    if (drag && boardRef.current) {
      e.preventDefault();
      const rect = boardRef.current.getBoundingClientRect();
      const dx = (e.clientX - drag.startClientX) / rect.width;
      const dy = (e.clientY - drag.startClientY) / rect.height;
      setMesas((prev) =>
        prev.map((m) => (m.id === drag.mesaId ? { ...m, x: clamp01(drag.startX + dx), y: clamp01(drag.startY + dy) } : m))
      );
      return;
    }
    const p = panningRef.current;
    if (p) {
      e.preventDefault();
      setPan({ x: p.startPanX + (e.clientX - p.startClientX), y: p.startPanY + (e.clientY - p.startClientY) });
    }
  }

  async function onPointerUp() {
    const drag = draggingRef.current;
    draggingRef.current = null;
    panningRef.current = null;
    if (!drag) return;
    const mesa = mesas.find((m) => m.id === drag.mesaId) ?? null;
    if (!mesa) return;
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

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (error) return <main className="p-4 text-sm text-red-700">{supabaseErrToString(error)}</main>;
  if (!activeEstablishmentId) return <main className="p-4 text-sm text-slate-600">Selecciona un establecimiento.</main>;
  if (!canAdmin) return <main className="p-4 text-sm text-slate-600">Acceso denegado.</main>;

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
            className="absolute inset-0"
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
              "absolute bottom-6 right-6 z-30 grid h-14 w-14 place-items-center rounded-full border shadow-2xl backdrop-blur",
              planoUnlocked ? "border-violet-400/30 bg-violet-500/15" : "border-white/10 bg-white/5"
            ].join(" ")}
            aria-label={planoUnlocked ? "Bloquear plano" : "Desbloquear plano"}
            onClick={() => setPlanoUnlocked((v) => !v)}
            title={planoUnlocked ? "Bloquear" : "Desbloquear"}
          >
            {planoUnlocked ? <LockOpen className="h-6 w-6 text-violet-200" /> : <Lock className="h-6 w-6 text-white/80" />}
          </button>

          {/* Board */}
          <div className="absolute inset-x-0 bottom-0 top-0 pt-14">
            <div
              ref={boardRef}
              className="relative h-[calc(100dvh-56px)] w-full touch-none"
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
                  const left = `${m.x * 100}%`;
                  const top = `${m.y * 100}%`;
                  return (
                    <div
                      key={m.id}
                      className={[
                        "absolute -translate-x-1/2 -translate-y-1/2 select-none",
                        "grid place-items-center",
                        "h-24 w-24 rounded-2xl",
                        "border-2",
                        neon.border,
                        neon.glow,
                        "bg-white/5",
                        "backdrop-blur",
                        "transition-transform duration-150 ease-out",
                        "active:scale-105",
                        planoUnlocked ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                      ].join(" ")}
                      style={{ left, top }}
                      role="button"
                      tabIndex={0}
                      onClick={() => openMesa(m.id)}
                      onPointerDown={planoUnlocked ? (e) => onPointerDownMesa(e, m) : undefined}
                      aria-label={`Mesa ${m.numero}`}
                    >
                      <span className={["absolute left-2 top-2 h-2 w-2 rounded-full", neon.dot].join(" ")} aria-hidden />
                      <div className="text-center">
                        <p className="text-xl font-black tabular-nums text-white">{m.numero}</p>
                        <p className="mt-0.5 text-[11px] font-semibold text-white/70">{m.pax_max} pax</p>
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

                {manageOpen ? (
                  <div className="space-y-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-white/60">Estado</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" className="min-h-11 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10" onClick={() => void setEstado("libre")}>
                        Libre
                      </button>
                      <button type="button" className="min-h-11 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10" onClick={() => void setEstado("reservada")}>
                        Reservada
                      </button>
                      <button type="button" className="min-h-11 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10" onClick={() => void setEstado("ocupada")}>
                        Ocupada
                      </button>
                      <button type="button" className="min-h-11 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white hover:bg-white/10" onClick={() => void setEstado("sucia")}>
                        Sucia
                      </button>
                    </div>
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

