"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

type EnvaseTipo = "caja" | "barril" | "gas";

const TIPOS: Array<{ tipo: EnvaseTipo; label: string }> = [
  { tipo: "caja", label: "Cajas" },
  { tipo: "barril", label: "Barriles" },
  { tipo: "gas", label: "Gas" }
];

function toNum(v: string): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function PreciosEnvasesPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const { activeEstablishmentId } = useActiveEstablishment();

  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<EnvaseTipo | null>(null);
  const [draft, setDraft] = useState<Record<EnvaseTipo, string>>({
    caja: "0",
    barril: "0",
    gas: "0"
  });

  useEffect(() => {
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      setErr(null);
      try {
        const { data, error } = await supabase()
          .from("config_precios_envases")
          .select("tipo,precio")
          .eq("establecimiento_id", activeEstablishmentId);
        if (error) throw error;
        if (cancelled) return;
        const rows = ((data ?? []) as unknown as Array<{ tipo: EnvaseTipo; precio: unknown }>) ?? [];
        setDraft((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            if (!r?.tipo) continue;
            next[r.tipo] = String(Number(r.precio ?? 0) || 0);
          }
          return next;
        });
      } catch (e) {
        if (!cancelled) setErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId]);

  const canUse = useMemo(() => !!me?.role, [me?.role]);

  async function save(tipo: EnvaseTipo) {
    if (!activeEstablishmentId) return;
    setErr(null);
    setSaving(tipo);
    try {
      const precio = Math.max(0, toNum(draft[tipo]));
      const payload = { establecimiento_id: activeEstablishmentId, tipo, precio };
      const { error } = await supabase()
        .from("config_precios_envases")
        .upsert(payload, { onConflict: "establecimiento_id,tipo" });
      if (error) throw error;
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(null);
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;

  if (!canUse) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Precios de envases" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <p className="text-sm text-slate-600">Acceso denegado.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Precios de envases" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Precios de envases</h1>
          <p className="mt-1 text-sm text-slate-600">Define el coste/fianza por tipo de envase.</p>
        </div>

        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}

        <div className="space-y-3">
          {TIPOS.map((t) => (
            <section key={t.tipo} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">{t.label}</p>
              <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <div className="relative">
                  <input
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 pr-10 text-base tabular-nums text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-300"
                    inputMode="decimal"
                    value={draft[t.tipo]}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [t.tipo]: e.currentTarget.value }))}
                    aria-label={`Precio ${t.label}`}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">€</span>
                </div>
                <button
                  type="button"
                  className="min-h-12 rounded-2xl bg-black px-4 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                  onClick={() => void save(t.tipo)}
                  disabled={saving === t.tipo || !activeEstablishmentId}
                >
                  {saving === t.tipo ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

