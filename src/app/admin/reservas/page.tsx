"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Minus, Plus, Trash2, Users } from "lucide-react";
import { MobileHeader } from "@/components/MobileHeader";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useCambiosGlobalesRealtime } from "@/lib/useCambiosGlobalesRealtime";

type MesaEstado = "libre" | "reservada" | "ocupada" | "sucia";
type MesaForma = "rect" | "round";

type Reserva = {
  id: string;
  fecha: string; // YYYY-MM-DD
  nombre: string;
  telefono: string;
  pax: number;
  hora: string; // "21:30"
  prepagoEUR: number;
  notas: string;
};

type Mesa = {
  id: string;
  numero: number;
  paxMax: number;
  forma: MesaForma;
  x: number; // 0..1
  y: number; // 0..1
  estado: MesaEstado;
  horaCheckin?: string | null;
  horaCheckout?: string | null;
  reservaHoy?: Reserva | null;
};

type Zona = {
  id: string;
  nombre: string;
  mesas: Mesa[];
};

type PlanoState = { version: 1; establecimientoId: string; zonas: Zona[] };

type Horario = {
  dow: number; // 0..6
  abierto: boolean;
  horaApertura: string; // "20:00"
  horaCierre: string; // "23:00"
};

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function safeInt(n: unknown, fallback = 0) {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? v : fallback;
}

function defaultPlano(estId: string): PlanoState {
  return {
    version: 1,
    establecimientoId: estId,
    zonas: [
      {
        id: "zona_sala",
        nombre: "Sala Principal",
        mesas: [
          { id: newId("mesa"), numero: 1, paxMax: 4, forma: "rect", x: 0.15, y: 0.2, estado: "libre", reservaHoy: null },
          { id: newId("mesa"), numero: 2, paxMax: 2, forma: "round", x: 0.55, y: 0.25, estado: "libre", reservaHoy: null },
          { id: newId("mesa"), numero: 3, paxMax: 6, forma: "rect", x: 0.3, y: 0.55, estado: "libre", reservaHoy: null }
        ]
      },
      { id: "zona_terraza", nombre: "Terraza", mesas: [] },
      { id: "zona_vip", nombre: "VIP", mesas: [] }
    ]
  };
}

function estadoStyle(estado: MesaEstado) {
  switch (estado) {
    case "libre":
      return { bg: "bg-premium-green/10", ring: "ring-premium-green/20", text: "text-premium-green", bar: "bg-premium-green" };
    case "reservada":
      return { bg: "bg-premium-blue/10", ring: "ring-premium-blue/20", text: "text-premium-blue", bar: "bg-premium-blue" };
    case "ocupada":
      return { bg: "bg-premium-orange/10", ring: "ring-premium-orange/20", text: "text-premium-orange", bar: "bg-premium-orange" };
    case "sucia":
      return { bg: "bg-red-50", ring: "ring-red-200", text: "text-red-700", bar: "bg-red-500" };
  }
}

function fmtEstado(estado: MesaEstado) {
  if (estado === "libre") return "Libre";
  if (estado === "reservada") return "Reservada";
  if (estado === "ocupada") return "Ocupada";
  return "Sucia";
}

export default function ReservasPlanoPage() {
  const { data: me, isLoading: meLoading, error } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canAdmin = hasPermission(role, "admin");
  const { activeEstablishmentId, activeEstablishmentName } = useActiveEstablishment();

  const [err, setErr] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string>("zona_sala");
  const [state, setState] = useState<PlanoState | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selMesaId, setSelMesaId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [addMesaLoading, setAddMesaLoading] = useState(false);
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [horariosSaving, setHorariosSaving] = useState(false);

  const reservaIdsRef = useRef<Set<string>>(new Set());
  const audioAllowedRef = useRef(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const draggingMesaRef = useRef<{ mesaId: string; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const panningRef = useRef<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null);

  useEffect(() => {
    if (!activeEstablishmentId) return;
    // Estado inicial “skeleton” para evitar parpadeo mientras carga de DB
    const s = defaultPlano(activeEstablishmentId);
    setState(s);
    setZoneId(s.zonas[0]?.id ?? "zona_sala");
  }, [activeEstablishmentId]);

  const zona = useMemo(() => {
    const z = state?.zonas.find((z) => z.id === zoneId) ?? state?.zonas[0] ?? null;
    return z;
  }, [state, zoneId]);

  const mesaSel = useMemo(() => {
    if (!zona || !selMesaId) return null;
    return zona.mesas.find((m) => m.id === selMesaId) ?? null;
  }, [zona, selMesaId]);

  const today = todayYmd();

  const refreshFromDb = useCallback(async () => {
    if (!activeEstablishmentId) return;
    setErr(null);
    try {
      // 0) Horarios (si existe tabla, sino ignora)
      try {
        const hRes = await supabase()
          .from("sala_horarios")
          .select("dow,abierto,hora_apertura,hora_cierre")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("dow", { ascending: true });
        if (!hRes.error) {
          const rows = (hRes.data ?? []) as Array<{ dow: number; abierto: boolean; hora_apertura: string; hora_cierre: string }>;
          if (rows.length) {
            setHorarios(
              rows.map((r) => ({
                dow: Number(r.dow),
                abierto: !!r.abierto,
                horaApertura: String(r.hora_apertura ?? "20:00").slice(0, 5),
                horaCierre: String(r.hora_cierre ?? "23:00").slice(0, 5)
              }))
            );
          } else {
            setHorarios([
              { dow: 1, abierto: true, horaApertura: "20:00", horaCierre: "23:00" },
              { dow: 2, abierto: true, horaApertura: "20:00", horaCierre: "23:00" },
              { dow: 3, abierto: true, horaApertura: "20:00", horaCierre: "23:00" },
              { dow: 4, abierto: true, horaApertura: "20:00", horaCierre: "23:00" },
              { dow: 5, abierto: true, horaApertura: "20:00", horaCierre: "23:00" },
              { dow: 6, abierto: true, horaApertura: "20:00", horaCierre: "23:00" },
              { dow: 0, abierto: true, horaApertura: "20:00", horaCierre: "23:00" }
            ]);
          }
        }
      } catch {
        // ignore (entornos sin la tabla aún)
      }

      // 1) leer zonas
      const zRes = await supabase()
        .from("sala_zonas")
        .select("id,nombre,sort")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("sort", { ascending: true })
        .order("created_at", { ascending: true });

      if (zRes.error) throw zRes.error;
      let zonasRows = (zRes.data ?? []) as Array<{ id: string; nombre: string; sort: number }>;

      // Bootstrap (primera vez): crear zonas + mesas demo si está vacío
      if (!zonasRows.length) {
        const insZ = await supabase()
          .from("sala_zonas")
          .insert([
            { establecimiento_id: activeEstablishmentId, nombre: "Sala Principal", sort: 0 },
            { establecimiento_id: activeEstablishmentId, nombre: "Terraza", sort: 1 },
            { establecimiento_id: activeEstablishmentId, nombre: "VIP", sort: 2 }
          ])
          .select("id,nombre,sort");
        if (insZ.error) throw insZ.error;
        zonasRows = (insZ.data ?? []) as Array<{ id: string; nombre: string; sort: number }>;
        const sala = zonasRows[0];
        if (sala?.id) {
          const insM = await supabase().from("sala_mesas").insert([
            { establecimiento_id: activeEstablishmentId, zona_id: sala.id, numero: 1, pax_max: 4, forma: "rect", x: 0.15, y: 0.2, estado: "libre" },
            { establecimiento_id: activeEstablishmentId, zona_id: sala.id, numero: 2, pax_max: 2, forma: "round", x: 0.55, y: 0.25, estado: "libre" },
            { establecimiento_id: activeEstablishmentId, zona_id: sala.id, numero: 3, pax_max: 6, forma: "rect", x: 0.3, y: 0.55, estado: "libre" }
          ]);
          if (insM.error) throw insM.error;
        }
      }

      // 2) leer mesas
      const mRes = await supabase()
        .from("sala_mesas")
        .select("id,zona_id,numero,pax_max,forma,x,y,estado,hora_checkin,hora_checkout")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("numero", { ascending: true });
      if (mRes.error) throw mRes.error;
      const mesasRows = (mRes.data ?? []) as Array<{
        id: string;
        zona_id: string;
        numero: number;
        pax_max: number;
        forma: MesaForma;
        x: number;
        y: number;
        estado: MesaEstado;
        hora_checkin: string | null;
        hora_checkout: string | null;
      }>;

      // 3) reservas de hoy
      const rRes = await supabase()
        .from("sala_reservas")
        .select("id,mesa_id,fecha,nombre,telefono,pax,hora,prepago_eur,notas")
        .eq("establecimiento_id", activeEstablishmentId)
        .eq("fecha", today);
      if (rRes.error) throw rRes.error;
      const resRows = (rRes.data ?? []) as Array<{
        id: string;
        mesa_id: string;
        fecha: string;
        nombre: string;
        telefono: string;
        pax: number;
        hora: string;
        prepago_eur: number;
        notas: string;
      }>;
      const resByMesa = new Map<string, Reserva>();
      for (const r of resRows) {
        resByMesa.set(String(r.mesa_id), {
          id: String(r.id),
          fecha: String(r.fecha),
          nombre: String(r.nombre ?? ""),
          telefono: String(r.telefono ?? ""),
          pax: Math.max(1, safeInt(r.pax, 2)),
          hora: String(r.hora ?? "21:00"),
          prepagoEUR: Math.max(0, Number(r.prepago_eur ?? 0) || 0),
          notas: String(r.notas ?? "")
        });
      }

      // 4) mapear a UI
      const mesasByZona = new Map<string, Mesa[]>();
      for (const m of mesasRows) {
        const mesa: Mesa = {
          id: m.id,
          numero: Math.max(1, safeInt(m.numero, 1)),
          paxMax: Math.max(1, safeInt(m.pax_max, 4)),
          forma: m.forma ?? "rect",
          x: clamp01(Number(m.x ?? 0.2) || 0.2),
          y: clamp01(Number(m.y ?? 0.2) || 0.2),
          estado: (m.estado as MesaEstado) ?? "libre",
          horaCheckin: m.hora_checkin ?? null,
          horaCheckout: m.hora_checkout ?? null,
          reservaHoy: resByMesa.get(m.id) ?? null
        };
        mesasByZona.set(m.zona_id, [...(mesasByZona.get(m.zona_id) ?? []), mesa]);
      }

      const zonas: Zona[] = zonasRows.map((z) => ({
        id: z.id,
        nombre: z.nombre,
        mesas: (mesasByZona.get(z.id) ?? []).slice().sort((a, b) => a.numero - b.numero)
      }));

      const next: PlanoState = { version: 1, establecimientoId: activeEstablishmentId, zonas };
      setState(next);
      setZoneId((curr) => (zonas.some((z) => z.id === curr) ? curr : zonas[0]?.id ?? curr));

      // Sonido: nuevas reservas (hoy) desde web u otros usuarios
      const nextIds = new Set<string>();
      for (const r of resRows) nextIds.add(String(r.id));
      const prevIds = reservaIdsRef.current;
      let hasNew = false;
      for (const id of nextIds) {
        if (!prevIds.has(id)) {
          hasNew = true;
          break;
        }
      }
      reservaIdsRef.current = nextIds;
      if (hasNew) beep();
    } catch (e) {
      console.error("[reservas] refreshFromDb error", e);
      setErr(supabaseErrToString(e));
      setState(defaultPlano(activeEstablishmentId));
    }
  }, [activeEstablishmentId, today]);

  function updateZona(zonaId: string, patch: Partial<Zona>) {
    if (!state) return;
    setState({
      ...state,
      zonas: state.zonas.map((z) => (z.id === zonaId ? { ...z, ...patch } : z))
    });
  }

  async function updateMesaDb(mesaId: string, patch: Partial<Mesa>) {
    if (!activeEstablishmentId) return;
    const payload: Record<string, unknown> = {};
    if (patch.numero != null) payload.numero = patch.numero;
    if (patch.paxMax != null) payload.pax_max = patch.paxMax;
    if (patch.forma != null) payload.forma = patch.forma;
    if (patch.x != null) payload.x = patch.x;
    if (patch.y != null) payload.y = patch.y;
    if (patch.estado != null) payload.estado = patch.estado;
    if ((patch as { horaCheckin?: string | null }).horaCheckin !== undefined) payload.hora_checkin = (patch as { horaCheckin?: string | null }).horaCheckin;
    if ((patch as { horaCheckout?: string | null }).horaCheckout !== undefined) payload.hora_checkout = (patch as { horaCheckout?: string | null }).horaCheckout;
    // IMPORTANTE: filtramos por establecimiento_id para evitar escribir accidentalmente en otra sede
    const up = await supabase().from("sala_mesas").update(payload).eq("id", mesaId).eq("establecimiento_id", activeEstablishmentId);
    if (up.error) throw up.error;
  }

  function updateMesa(zonaId: string, mesaId: string, patch: Partial<Mesa>) {
    if (!state) return;
    updateZona(zonaId, {
      mesas: (state.zonas.find((z) => z.id === zonaId)?.mesas ?? []).map((m) => (m.id === mesaId ? { ...m, ...patch } : m))
    });
  }

  async function addMesa() {
    if (!zona || !state) return;
    if (!activeEstablishmentId) return;
    if (addMesaLoading) return;
    const nextNum = Math.max(0, ...zona.mesas.map((m) => m.numero)) + 1;
    try {
      setErr(null);
      setAddMesaLoading(true);
      const ins = await supabase()
        .from("sala_mesas")
        .insert({
          establecimiento_id: activeEstablishmentId,
          zona_id: zona.id,
          numero: nextNum,
          pax_max: 4,
          forma: "rect",
          x: 0.2,
          y: 0.2,
          estado: "libre"
        } as unknown as Record<string, unknown>)
        .select("id,numero,pax_max,forma,x,y,estado")
        .maybeSingle();
      if (ins.error) throw ins.error;
      const row = ins.data as unknown as { id: string; numero: number; pax_max: number; forma: MesaForma; x: number; y: number; estado: MesaEstado } | null;
      if (row?.id) {
        updateZona(zona.id, {
          mesas: [
            ...zona.mesas,
            { id: row.id, numero: row.numero, paxMax: row.pax_max, forma: row.forma, x: row.x, y: row.y, estado: row.estado, reservaHoy: null }
          ]
        });
      }
    } catch (e) {
      console.error("[reservas] addMesa error", e);
      setErr(supabaseErrToString(e));
    } finally {
      setAddMesaLoading(false);
    }
  }

  async function removeMesa(zonaId: string, mesaId: string) {
    if (!state) return;
    const z = state.zonas.find((z) => z.id === zonaId);
    if (!z) return;
    try {
      setErr(null);
      const del = await supabase().from("sala_mesas").delete().eq("id", mesaId).eq("establecimiento_id", activeEstablishmentId);
      if (del.error) throw del.error;
      updateZona(zonaId, { mesas: z.mesas.filter((m) => m.id !== mesaId) });
      if (selMesaId === mesaId) setSelMesaId(null);
    } catch (e) {
      console.error("[reservas] removeMesa error", e);
      setErr(supabaseErrToString(e));
    }
  }

  function openMesa(mesaId: string) {
    setSelMesaId(mesaId);
    setDrawerOpen(true);
  }

  function onPointerDownMesa(e: React.PointerEvent, mesa: Mesa) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingMesaRef.current = {
      mesaId: mesa.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: mesa.x,
      startY: mesa.y
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = draggingMesaRef.current;
    if (drag && zona && boardRef.current) {
      e.preventDefault();
      const rect = boardRef.current.getBoundingClientRect();
      const dx = (e.clientX - drag.startClientX) / rect.width;
      const dy = (e.clientY - drag.startClientY) / rect.height;
      const nx = clamp01(drag.startX + dx);
      const ny = clamp01(drag.startY + dy);
      updateMesa(zona.id, drag.mesaId, { x: nx, y: ny });
      return;
    }
    const panRef = panningRef.current;
    if (panRef) {
      e.preventDefault();
      setPan({
        x: panRef.startPanX + (e.clientX - panRef.startClientX),
        y: panRef.startPanY + (e.clientY - panRef.startClientY)
      });
    }
  }

  async function onPointerUp() {
    const drag = draggingMesaRef.current;
    draggingMesaRef.current = null;
    panningRef.current = null;
    if (!drag || !zona) return;
    const mesa = zona.mesas.find((m) => m.id === drag.mesaId);
    if (!mesa) return;
    try {
      await updateMesaDb(mesa.id, { x: mesa.x, y: mesa.y });
    } catch (e) {
      console.error("[reservas] drag-save error", e);
      setErr(supabaseErrToString(e));
      void refreshFromDb();
    }
  }

  function onPointerDownBoard(e: React.PointerEvent) {
    // Pan con un dedo cuando NO estás arrastrando una mesa
    if (draggingMesaRef.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panningRef.current = { startClientX: e.clientX, startClientY: e.clientY, startPanX: pan.x, startPanY: pan.y };
  }

  function resetView() {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  async function setEstado(estado: MesaEstado) {
    if (!mesaSel || !zona) return;
    const prev = mesaSel.estado;
    const patch: Partial<Mesa> = { estado };
    if (estado === "ocupada") patch.horaCheckin = new Date().toISOString();
    if (prev === "ocupada" && (estado === "sucia" || estado === "libre")) patch.horaCheckout = new Date().toISOString();
    updateMesa(zona.id, mesaSel.id, patch);
    try {
      setErr(null);
      await updateMesaDb(mesaSel.id, patch);
    } catch (e) {
      console.error("[reservas] setEstado error", e);
      setErr(supabaseErrToString(e));
      void refreshFromDb();
    }
  }

  async function upsertReservaHoy(patch: Partial<Reserva>) {
    if (!mesaSel || !zona) return;
    const base: Reserva =
      mesaSel.reservaHoy && mesaSel.reservaHoy.fecha === today
        ? mesaSel.reservaHoy
        : { id: newId("res"), fecha: today, nombre: "", telefono: "", pax: 2, hora: "21:00", prepagoEUR: 0, notas: "" };
    updateMesa(zona.id, mesaSel.id, { reservaHoy: { ...base, ...patch } });
    try {
      setErr(null);
      const next = { ...base, ...patch };
      const up = await supabase()
        .from("sala_reservas")
        .upsert(
          {
            establecimiento_id: activeEstablishmentId,
            mesa_id: mesaSel.id,
            fecha: today,
            nombre: next.nombre,
            telefono: next.telefono,
            pax: next.pax,
            hora: next.hora,
            prepago_eur: next.prepagoEUR,
            notas: next.notas
          } as unknown as Record<string, unknown>,
          { onConflict: "mesa_id,fecha" }
        )
        .select("id")
        .maybeSingle();
      if (up.error) throw up.error;
    } catch (e) {
      console.error("[reservas] upsertReservaHoy error", e);
      setErr(supabaseErrToString(e));
      void refreshFromDb();
    }
  }

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !state) return [];
    const out: Array<{ zonaId: string; mesa: Mesa }> = [];
    for (const z of state.zonas) {
      for (const m of z.mesas) {
        const r = m.reservaHoy;
        if (!r) continue;
        const hay =
          (r.nombre ?? "").toLowerCase().includes(q) ||
          (r.telefono ?? "").toLowerCase().includes(q);
        if (hay) out.push({ zonaId: z.id, mesa: m });
      }
    }
    return out.slice(0, 8);
  }, [search, state]);

  const quickCounts = useMemo(() => {
    const mesas = zona?.mesas ?? [];
    const libres = mesas.filter((m) => m.estado === "libre").length;
    const reservadas = mesas.filter((m) => m.estado === "reservada").length;
    const ocupadas = mesas.filter((m) => m.estado === "ocupada").length;
    return { libres, reservadas, ocupadas };
  }, [zona?.mesas]);

  const estanciaMediaMin = useMemo(() => {
    const mesas = zona?.mesas ?? [];
    const deltas: number[] = [];
    for (const m of mesas) {
      if (!m.horaCheckin || !m.horaCheckout) continue;
      const a = new Date(m.horaCheckin).getTime();
      const b = new Date(m.horaCheckout).getTime();
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const mins = Math.round((b - a) / 60000);
      if (mins > 0 && mins < 24 * 60) deltas.push(mins);
    }
    if (!deltas.length) return null;
    return Math.round(deltas.reduce((s, x) => s + x, 0) / deltas.length);
  }, [zona?.mesas]);

  function allowAudio() {
    audioAllowedRef.current = true;
  }

  function beep() {
    if (!audioAllowedRef.current) return;
    try {
      const Ctx =
        (globalThis.AudioContext as unknown as typeof AudioContext | undefined) ??
        ((globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext | undefined);
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.start(t0);
      o.stop(t0 + 0.2);
      o.onended = () => void ctx.close();
    } catch {
      // ignore
    }
  }

  async function clearReservaHoy() {
    if (!activeEstablishmentId || !zona || !mesaSel) return;
    updateMesa(zona.id, mesaSel.id, { reservaHoy: null, estado: "libre" });
    try {
      setErr(null);
      const del = await supabase()
        .from("sala_reservas")
        .delete()
        .eq("establecimiento_id", activeEstablishmentId)
        .eq("mesa_id", mesaSel.id)
        .eq("fecha", today);
      if (del.error) throw del.error;
      await updateMesaDb(mesaSel.id, { estado: "libre" });
    } catch (e) {
      setErr(supabaseErrToString(e));
      void refreshFromDb();
    }
  }

  useEffect(() => {
    if (!activeEstablishmentId || !canAdmin) return;
    void refreshFromDb();
  }, [activeEstablishmentId, canAdmin, refreshFromDb]);

  useCambiosGlobalesRealtime({
    establecimientoId: activeEstablishmentId,
    onChange: () => void refreshFromDb(),
    tables: ["sala_zonas", "sala_mesas", "sala_reservas", "sala_horarios"]
  });

  function fmtDow(dow: number) {
    if (dow === 1) return "Lunes";
    if (dow === 2) return "Martes";
    if (dow === 3) return "Miércoles";
    if (dow === 4) return "Jueves";
    if (dow === 5) return "Viernes";
    if (dow === 6) return "Sábado";
    return "Domingo";
  }

  function patchHorario(dow: number, patch: Partial<Horario>) {
    setHorarios((prev) => {
      const base = prev ?? [];
      const next = base.map((h) => (h.dow === dow ? { ...h, ...patch } : h));
      return next;
    });
  }

  async function saveHorarios() {
    if (!activeEstablishmentId) return;
    if (!horarios?.length) return;
    if (horariosSaving) return;
    setHorariosSaving(true);
    setErr(null);
    try {
      const payload = horarios.map((h) => ({
        establecimiento_id: activeEstablishmentId,
        dow: h.dow,
        abierto: !!h.abierto,
        hora_apertura: `${h.horaApertura}:00`,
        hora_cierre: `${h.horaCierre}:00`
      }));
      const up = await supabase().from("sala_horarios").upsert(payload, { onConflict: "establecimiento_id,dow" });
      if (up.error) throw up.error;
    } catch (e) {
      console.error("[reservas] saveHorarios error", e);
      setErr(supabaseErrToString(e));
    } finally {
      setHorariosSaving(false);
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (error) return <main className="p-4 text-sm text-red-700">{supabaseErrToString(error)}</main>;
  if (!activeEstablishmentId) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Reservas" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <div className="premium-card">
            <p className="text-sm font-semibold text-slate-900">Selecciona un establecimiento</p>
            <p className="mt-1 text-sm text-slate-600">Necesitas un establecimiento activo para gestionar reservas.</p>
          </div>
        </main>
      </div>
    );
  }
  if (!canAdmin) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Reservas" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <div className="premium-card">
            <p className="text-sm font-semibold text-slate-900">Acceso denegado</p>
            <p className="mt-1 text-sm text-slate-600">Solo Admin/Superadmin.</p>
          </div>
        </main>
      </div>
    );
  }
  if (!state || !zona) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Reservas" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <p className="text-sm text-slate-600">Cargando plano…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Reservas" showBack backHref="/admin" />
      <main className="mx-auto w-full max-w-5xl p-4 pb-28" onPointerDown={allowAudio} onClick={allowAudio}>
        {err ? <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}

        <div className="premium-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Plano de sala · {today}</p>
              <div className="mt-1 flex items-center gap-2 text-slate-900">
                <MapPin className="h-4 w-4 text-slate-500" aria-hidden />
                <p className="truncate text-base font-black tracking-tight">{(activeEstablishmentName ?? "").trim() || "Mi local"}</p>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                Libres: <span className="font-black tabular-nums text-slate-900">{quickCounts.libres}</span> · Reservadas:{" "}
                <span className="font-black tabular-nums text-slate-900">{quickCounts.reservadas}</span> · Ocupadas:{" "}
                <span className="font-black tabular-nums text-slate-900">{quickCounts.ocupadas}</span>
                {estanciaMediaMin != null ? (
                  <>
                    {" "}
                    · Estancia media: <span className="font-black tabular-nums text-slate-900">{estanciaMediaMin}</span> min
                  </>
                ) : null}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <input
                  className="premium-input min-h-11 w-[220px] px-3 text-sm"
                  placeholder="Buscar reserva (nombre o teléfono)…"
                  value={search}
                  onChange={(e) => setSearch(e.currentTarget.value)}
                />
                {searchResults.length ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
                    {searchResults.map((r) => (
                      <button
                        key={r.mesa.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => {
                          setZoneId(r.zonaId);
                          openMesa(r.mesa.id);
                          setSearch("");
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-extrabold text-slate-900">Mesa {r.mesa.numero}</span>
                          <span className="block truncate text-xs font-semibold text-slate-600">
                            {(r.mesa.reservaHoy?.nombre ?? "").trim() || "Sin nombre"} · {(r.mesa.reservaHoy?.telefono ?? "").trim() || "—"}
                          </span>
                        </span>
                        <span className="text-xs font-black tabular-nums text-slate-700">{r.mesa.reservaHoy?.hora ?? ""}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <select className="premium-input min-h-11 w-auto px-3 text-sm" value={zoneId} onChange={(e) => setZoneId(e.currentTarget.value)}>
                {state.zonas.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.nombre}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={["min-h-11 rounded-2xl px-4 text-sm font-extrabold transition-colors", editMode ? "bg-premium-blue text-white" : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50"].join(" ")}
                onClick={() => setEditMode((v) => !v)}
              >
                {editMode ? "Editar plano: ON" : "Editar plano"}
              </button>
              <button type="button" className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-900 hover:bg-slate-50" onClick={resetView}>
                Reset vista
              </button>
              <button type="button" className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-900 hover:bg-slate-50" onClick={() => setScale((s) => Math.max(0.6, Math.round((s - 0.1) * 10) / 10))} aria-label="Zoom menos">
                <Minus className="h-4 w-4" />
              </button>
              <button type="button" className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-900 hover:bg-slate-50" onClick={() => setScale((s) => Math.min(2.2, Math.round((s + 0.1) * 10) / 10))} aria-label="Zoom más">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" className="premium-btn-primary min-h-11 rounded-2xl px-4 disabled:opacity-60" onClick={addMesa} disabled={addMesaLoading}>
                {addMesaLoading ? "Añadiendo…" : "+ Mesa"}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Configuración</p>
                <p className="mt-1 text-base font-black tracking-tight text-slate-900">Horarios</p>
                <p className="mt-1 text-sm font-medium text-slate-600">Define apertura/cierre por día. Intervalos de 30 minutos.</p>
              </div>
              <button
                type="button"
                className={["min-h-11 rounded-2xl px-4 text-sm font-extrabold transition", horariosSaving ? "bg-slate-200 text-slate-500" : "bg-premium-blue text-white shadow-sm hover:brightness-110 active:brightness-95"].join(" ")}
                onClick={saveHorarios}
                disabled={horariosSaving}
              >
                {horariosSaving ? "Guardando…" : "Guardar horarios"}
              </button>
            </div>

            {horarios?.length ? (
              <div className="mt-4 grid gap-3">
                {horarios
                  .slice()
                  .sort((a, b) => (a.dow === 1 ? -10 : a.dow) - (b.dow === 1 ? -10 : b.dow)) // lunes primero (estética)
                  .map((h) => (
                    <div key={h.dow} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4 sm:items-center">
                      <div className="sm:col-span-1">
                        <p className="text-sm font-extrabold text-slate-900">{fmtDow(h.dow)}</p>
                        <p className="text-xs font-semibold text-slate-600">{h.abierto ? "Abierto" : "Cerrado (descanso)"}</p>
                      </div>

                      <div className="sm:col-span-1">
                        <label className="text-xs font-semibold text-slate-600">Apertura</label>
                        <input
                          type="time"
                          step={1800}
                          className="premium-input mt-1"
                          value={h.horaApertura}
                          disabled={!h.abierto}
                          onChange={(e) => patchHorario(h.dow, { horaApertura: e.currentTarget.value })}
                        />
                      </div>

                      <div className="sm:col-span-1">
                        <label className="text-xs font-semibold text-slate-600">Cierre</label>
                        <input
                          type="time"
                          step={1800}
                          className="premium-input mt-1"
                          value={h.horaCierre}
                          disabled={!h.abierto}
                          onChange={(e) => patchHorario(h.dow, { horaCierre: e.currentTarget.value })}
                        />
                      </div>

                      <div className="sm:col-span-1">
                        <label className="text-xs font-semibold text-slate-600">Descanso</label>
                        <button
                          type="button"
                          className={[
                            "mt-1 min-h-11 w-full rounded-2xl px-3 text-sm font-extrabold transition",
                            h.abierto ? "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50" : "bg-premium-orange text-white shadow-sm hover:brightness-110"
                          ].join(" ")}
                          onClick={() => patchHorario(h.dow, { abierto: !h.abierto })}
                        >
                          {h.abierto ? "Marcar como cerrado" : "Abrir este día"}
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">Cargando horarios…</p>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {(["libre", "reservada", "ocupada", "sucia"] as MesaEstado[]).map((s) => {
              const st = estadoStyle(s);
              return (
                <div key={s} className={["rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"].join(" ")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={["h-3 w-3 rounded-full", st.bar].join(" ")} aria-hidden />
                    <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{fmtEstado(s)}</p>
                    <span className="text-xs font-black tabular-nums text-slate-900">{zona.mesas.filter((m) => m.estado === s).length}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-sm">
            <div
              ref={boardRef}
              className="relative h-[64vh] min-h-[420px] w-full touch-none"
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
                  transition: panningRef.current || draggingMesaRef.current ? "none" : "transform 120ms ease"
                }}
              >
                {/* Grid visual */}
                <div
                  className="absolute inset-0 opacity-60"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgba(148,163,184,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.22) 1px, transparent 1px)",
                    backgroundSize: "48px 48px"
                  }}
                />

                {zona.mesas.map((m) => {
                  const st = estadoStyle(m.estado);
                  const left = `${m.x * 100}%`;
                  const top = `${m.y * 100}%`;
                  const base = [
                    "absolute -translate-x-1/2 -translate-y-1/2 select-none",
                    "grid place-items-center",
                    "h-20 w-20",
                    m.forma === "round" ? "rounded-full" : "rounded-2xl",
                    "border border-slate-200",
                    "shadow-sm",
                    st.bg,
                    "ring-2",
                    st.ring,
                    editMode ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                  ].join(" ");
                  return (
                    <div
                      key={m.id}
                      className={base}
                      style={{ left, top }}
                      role="button"
                      tabIndex={0}
                      onClick={() => (editMode ? openMesa(m.id) : openMesa(m.id))}
                      onPointerDown={(e) => onPointerDownMesa(e, m)}
                      aria-label={`Mesa ${m.numero}`}
                    >
                      <div className="text-center">
                        <p className={["text-xl font-black tabular-nums", st.text].join(" ")}>{m.numero}</p>
                        <p className="mt-0.5 inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-700">
                          <Users className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                          {m.paxMax} pax
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <Drawer open={drawerOpen} title={mesaSel ? `Mesa ${mesaSel.numero}` : "Mesa"} onClose={() => setDrawerOpen(false)}>
          {!mesaSel || !zona ? null : (
            <div className="space-y-4 pb-4">
              <div className="premium-card-tight">
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Estado</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" className="premium-btn-secondary" onClick={() => setEstado("libre")}>
                    Libre
                  </button>
                  <button type="button" className="premium-btn-secondary" onClick={() => setEstado("reservada")}>
                    Reservada
                  </button>
                  <button type="button" className="premium-btn-secondary" onClick={() => setEstado("ocupada")}>
                    Check-in (Ocupada)
                  </button>
                  <button type="button" className="premium-btn-secondary" onClick={() => setEstado("sucia")}>
                    Sucia
                  </button>
                </div>
              </div>

              <div className="premium-card-tight premium-topline-blue">
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Reserva (hoy)</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Nombre</label>
                    <input className="premium-input mt-1" value={mesaSel.reservaHoy?.nombre ?? ""} onChange={(e) => upsertReservaHoy({ nombre: e.currentTarget.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Teléfono</label>
                    <input className="premium-input mt-1" value={mesaSel.reservaHoy?.telefono ?? ""} onChange={(e) => upsertReservaHoy({ telefono: e.currentTarget.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Pax</label>
                    <input
                      type="number"
                      className="premium-input mt-1 text-center font-bold tabular-nums"
                      value={String(mesaSel.reservaHoy?.pax ?? 2)}
                      min={1}
                      onChange={(e) => upsertReservaHoy({ pax: Math.max(1, safeInt(e.currentTarget.value, 2)) })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Hora</label>
                    <input className="premium-input mt-1" value={mesaSel.reservaHoy?.hora ?? "21:00"} onChange={(e) => upsertReservaHoy({ hora: e.currentTarget.value })} placeholder="21:30" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-600">Prepago / fianza (€)</label>
                    <input
                      type="number"
                      className="premium-input mt-1 text-center font-bold tabular-nums"
                      value={String(mesaSel.reservaHoy?.prepagoEUR ?? 0)}
                      min={0}
                      step={1}
                      onChange={(e) => upsertReservaHoy({ prepagoEUR: Math.max(0, safeInt(e.currentTarget.value, 0)) })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-600">Notas</label>
                    <textarea className="premium-input mt-1 min-h-24 py-3" value={mesaSel.reservaHoy?.notas ?? ""} onChange={(e) => upsertReservaHoy({ notas: e.currentTarget.value })} />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="premium-btn-primary"
                    onClick={() => {
                      // confirmación simple: marca como reservada si hay nombre/pax
                      const has = !!(mesaSel.reservaHoy?.nombre ?? "").trim();
                      if (has) setEstado("reservada");
                    }}
                  >
                    Confirmar reserva
                  </button>
                  <button
                    type="button"
                    className="premium-btn-secondary"
                    onClick={() => {
                      void clearReservaHoy();
                    }}
                  >
                    Limpiar reserva
                  </button>
                </div>
              </div>

              <div className="premium-card-tight">
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Mesa</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Número</label>
                    <input
                      type="number"
                      className="premium-input mt-1 text-center font-bold tabular-nums"
                      value={String(mesaSel.numero)}
                      min={1}
                      onChange={(e) => {
                        const numero = Math.max(1, safeInt(e.currentTarget.value, mesaSel.numero));
                        updateMesa(zona.id, mesaSel.id, { numero });
                        void updateMesaDb(mesaSel.id, { numero }).catch((err) => {
                          setErr(supabaseErrToString(err));
                          void refreshFromDb();
                        });
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600">Capacidad</label>
                    <input
                      type="number"
                      className="premium-input mt-1 text-center font-bold tabular-nums"
                      value={String(mesaSel.paxMax)}
                      min={1}
                      onChange={(e) => {
                        const paxMax = Math.max(1, safeInt(e.currentTarget.value, mesaSel.paxMax));
                        updateMesa(zona.id, mesaSel.id, { paxMax });
                        void updateMesaDb(mesaSel.id, { paxMax }).catch((err) => {
                          setErr(supabaseErrToString(err));
                          void refreshFromDb();
                        });
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-600">Forma</label>
                    <select
                      className="premium-input mt-1"
                      value={mesaSel.forma}
                      onChange={(e) => {
                        const forma = e.currentTarget.value as MesaForma;
                        updateMesa(zona.id, mesaSel.id, { forma });
                        void updateMesaDb(mesaSel.id, { forma }).catch((err) => {
                          setErr(supabaseErrToString(err));
                          void refreshFromDb();
                        });
                      }}
                    >
                      <option value="rect">Cuadrada</option>
                      <option value="round">Redonda</option>
                    </select>
                  </div>
                </div>
                <div className="mt-3">
                  <button type="button" className="min-h-12 w-full rounded-3xl border border-red-200 bg-red-50 px-4 text-sm font-extrabold text-red-800 hover:bg-red-100" onClick={() => removeMesa(zona.id, mesaSel.id)}>
                    <span className="inline-flex items-center justify-center gap-2">
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Eliminar mesa
                    </span>
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Cliente / CRM</p>
                <p className="mt-1 text-sm text-slate-600">
                  Próximo paso: ficha cliente, lista negra y botón “puerta” (check-in) conectado al CRM.
                </p>
              </div>
            </div>
          )}
        </Drawer>
      </main>
    </div>
  );
}

