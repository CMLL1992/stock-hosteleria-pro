"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock, Mail, Phone, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

type EstPublic = { id: string; nombre: string; logo_url: string | null };
type Disp = {
  ok: boolean;
  error?: string;
  capacidad_total?: number;
  capacidad_reservada?: number;
  capacidad_libre?: number;
  mesas_total?: number;
  mesas_libres?: number;
};

type HorarioRow = { dow: number; abierto: boolean; hora_apertura: string; hora_cierre: string };

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function jsDowFromYmd(ymd: string): number {
  // JS: 0=domingo..6=sábado
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.getDay();
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function hhmmOfMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function buildSlots30(openHHMM: string, closeHHMM: string): string[] {
  const a = minutesOf(openHHMM);
  const b = minutesOf(closeHHMM);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return [];
  const out: string[] = [];
  for (let t = a; t <= b; t += 30) out.push(hhmmOfMinutes(t));
  return out;
}

export default function ReservarPublicClient({ slug }: { slug: string }) {
  const [est, setEst] = useState<EstPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [fecha, setFecha] = useState(todayYmd());
  const [hora, setHora] = useState("21:00");
  const [pax, setPax] = useState(2);

  const [disp, setDisp] = useState<Disp | null>(null);
  const [horarios, setHorarios] = useState<HorarioRow[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [ticket, setTicket] = useState<{ fecha: string; hora: string; pax: number } | null>(null);

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");

  useEffect(() => {
    const estId = est?.id;
    if (!estId) return;
    let cancelled = false;

    async function load() {
      try {
        const { data, error } = await supabase()
          .from("sala_horarios")
          .select("dow,abierto,hora_apertura,hora_cierre")
          .eq("establecimiento_id", estId)
          .order("dow", { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        setHorarios((data as unknown as HorarioRow[]) ?? []);
      } catch {
        // si no hay módulo aún, dejamos horarios null y caemos en fallback
        if (cancelled) return;
        setHorarios(null);
      }
    }

    void load();
    const channel = supabase()
      .channel(`public-horarios:${estId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sala_horarios", filter: `establecimiento_id=eq.${estId}` },
        () => void load()
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase().removeChannel(channel);
    };
  }, [est?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setOkMsg(null);
    (async () => {
      try {
        const { data, error } = await supabase().rpc("get_establecimiento_public", { p_slug: slug });
        if (cancelled) return;
        if (error) throw error;
        const row = (data as unknown as EstPublic | null) ?? null;
        if (!row?.id) {
          setEst(null);
          setErr("Establecimiento no encontrado.");
          return;
        }
        setEst({ id: String(row.id), nombre: String(row.nombre ?? ""), logo_url: (row.logo_url ?? null) as string | null });
      } catch (e: unknown) {
        if (cancelled) return;
        setEst(null);
        setErr(supabaseErrToString(e));
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setDisp(null);
    setOkMsg(null);
    setErr(null);
    (async () => {
      try {
        const { data, error } = await supabase().rpc("get_disponibilidad_public", { p_slug: slug, p_fecha: fecha });
        if (cancelled) return;
        if (error) throw error;
        setDisp((data as unknown as Disp) ?? null);
      } catch (e: unknown) {
        if (cancelled) return;
        setDisp(null);
        setErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fecha, slug]);

  const canSubmit = useMemo(() => {
    if (loading) return false;
    if (!est) return false;
    if (!fecha || !hora) return false;
    if (!nombre.trim()) return false;
    if (!telefono.trim()) return false;
    if (!email.trim()) return false;
    if (!disp?.ok) return false;
    const libre = Number(disp.capacidad_libre ?? 0) || 0;
    return pax > 0 && pax <= libre && !submitting;
  }, [disp?.capacidad_libre, disp?.ok, email, est, fecha, hora, loading, nombre, pax, submitting, telefono]);

  const horasVisibles = useMemo(() => {
    if (!disp?.ok) return [];
    const libre = Number(disp.capacidad_libre ?? 0) || 0;
    if (pax <= 0 || libre < pax) return [];
    const dow = jsDowFromYmd(fecha);
    const h = (horarios ?? []).find((x) => Number(x.dow) === dow) ?? null;
    if (h) {
      if (!h.abierto) return [];
      return buildSlots30(String(h.hora_apertura).slice(0, 5), String(h.hora_cierre).slice(0, 5));
    }
    // Fallback si aún no hay módulo configurado: rango generoso
    return buildSlots30("20:00", "23:00");
  }, [disp?.capacidad_libre, disp?.ok, fecha, horarios, pax]);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    setOkMsg(null);
    try {
      const { data, error } = await supabase().rpc("create_reserva_public", {
        p_slug: slug,
        p_fecha: fecha,
        p_hora: hora,
        p_pax: pax,
        p_nombre: nombre.trim(),
        p_email: email.trim(),
        p_telefono: telefono.trim()
      });
      if (error) throw error;
      const res = data as unknown as { ok?: boolean; error?: string; estado?: string };
      if (!res?.ok) throw new Error(res?.error || "No se pudo crear la reserva.");
      setOkMsg(`Reserva ${res.estado ?? "pendiente"}. ¡Te esperamos!`);
      setTicket({ fecha, hora, pax });
      setNombre("");
      setEmail("");
      setTelefono("");
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (ticket && est) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <main className="mx-auto max-w-xl p-4 pb-10">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ring-1 ring-slate-100">
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Reserva confirmada</p>
            <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{est.nombre}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Fecha</p>
                <p className="mt-1 text-sm font-black tabular-nums text-slate-900">{ticket.fecha}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Hora</p>
                <p className="mt-1 text-sm font-black tabular-nums text-slate-900">{ticket.hora}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Personas</p>
                <p className="mt-1 text-sm font-black tabular-nums text-slate-900">{ticket.pax}</p>
              </div>
            </div>

            <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
              Reserva confirmada. ¡Te esperamos!
            </p>

            <button
              type="button"
              className="mt-5 min-h-12 w-full rounded-3xl bg-slate-900 px-4 text-sm font-extrabold text-white shadow-sm hover:brightness-110 active:brightness-95"
              onClick={() => setTicket(null)}
            >
              Hacer otra reserva
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <main className="mx-auto max-w-xl p-4 pb-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Reserva</p>
              <p className="mt-1 truncate text-xl font-black tracking-tight text-slate-900">{est?.nombre || "—"}</p>
            </div>
            {est?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={est.logo_url} alt="" className="h-10 w-10 rounded-2xl border border-slate-200 object-cover" />
            ) : null}
          </div>

          {loading ? <p className="mt-4 text-sm font-medium text-slate-600">Cargando…</p> : null}
          {err ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}
          {okMsg ? (
            <p className="mt-4 inline-flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden />
              <span>{okMsg}</span>
            </p>
          ) : null}

          <div className="mt-5 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-slate-600">Fecha</label>
                <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm ring-1 ring-slate-100 focus-within:ring-2 focus-within:ring-premium-blue/20">
                  <CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />
                  <input type="date" className="h-11 w-full bg-transparent text-sm font-semibold text-slate-900 outline-none" value={fecha} onChange={(e) => setFecha(e.currentTarget.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">Personas</label>
                <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm ring-1 ring-slate-100 focus-within:ring-2 focus-within:ring-premium-blue/20">
                  <Users className="h-4 w-4 text-slate-500" aria-hidden />
                  <input
                    type="number"
                    min={1}
                    className="h-11 w-full bg-transparent text-center text-sm font-extrabold tabular-nums text-slate-900 outline-none"
                    value={String(pax)}
                    onChange={(e) => setPax(Math.max(1, Math.trunc(Number(e.currentTarget.value) || 1)))}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-600">Hora</label>
              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm ring-1 ring-slate-100 focus-within:ring-2 focus-within:ring-premium-blue/20">
                <Clock className="h-4 w-4 text-slate-500" aria-hidden />
                <select className="h-11 w-full bg-transparent text-sm font-extrabold text-slate-900 outline-none" value={hora} onChange={(e) => setHora(e.currentTarget.value)}>
                  {horasVisibles.length ? (
                    horasVisibles.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))
                  ) : (
                    <option value={hora}>Sin disponibilidad</option>
                  )}
                </select>
              </div>
            </div>

            {disp?.ok ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700">
                Capacidad libre hoy: <span className="font-black tabular-nums text-slate-900">{disp.capacidad_libre ?? 0}</span> · Mesas libres:{" "}
                <span className="font-black tabular-nums text-slate-900">{disp.mesas_libres ?? 0}</span>
              </div>
            ) : null}

            <div className="mt-2 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Tus datos</p>
              <div className="mt-3 grid gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Nombre</label>
                  <input className="premium-input mt-1" value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} placeholder="Nombre y apellidos" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Email</label>
                  <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm ring-1 ring-slate-100 focus-within:ring-2 focus-within:ring-premium-blue/20">
                    <Mail className="h-4 w-4 text-slate-500" aria-hidden />
                    <input className="h-11 w-full bg-transparent text-sm font-semibold text-slate-900 outline-none" value={email} onChange={(e) => setEmail(e.currentTarget.value)} placeholder="tu@email.com" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600">Teléfono</label>
                  <div className="mt-1 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm ring-1 ring-slate-100 focus-within:ring-2 focus-within:ring-premium-blue/20">
                    <Phone className="h-4 w-4 text-slate-500" aria-hidden />
                    <input className="h-11 w-full bg-transparent text-sm font-semibold text-slate-900 outline-none" value={telefono} onChange={(e) => setTelefono(e.currentTarget.value)} placeholder="+34 600 000 000" />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              className={[
                "mt-2 min-h-12 w-full rounded-3xl px-4 text-sm font-extrabold transition",
                canSubmit ? "bg-premium-blue text-white shadow-sm hover:brightness-110 active:brightness-95" : "bg-slate-200 text-slate-500"
              ].join(" ")}
              disabled={!canSubmit}
              onClick={submit}
            >
              {submitting ? "Confirmando…" : "Confirmar reserva"}
            </button>

            <p className="text-center text-[11px] font-medium text-slate-500">
              Al confirmar, tu reserva queda registrada y el local podrá validarla. Si tienes cambios, llámanos.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

