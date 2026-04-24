"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobileHeader } from "@/components/MobileHeader";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";

type IngredienteDraft = {
  id: string;
  nombre_ingrediente: string;
  cantidad_gramos_ml: string;
  precio_compra_sin_iva: string; // €/kg o €/L
  porcentaje_merma: string;
  iva_ingrediente: string;
};

type EscandalloGuardado = {
  id: string;
  establecimiento_id: string;
  nombre_plato: string;
  created_at: string; // ISO
  raciones_lote: number;
  multiplicador: number;
  iva_final: number;
  ingredientes: Array<{
    nombre_ingrediente: string;
    cantidad_gramos_ml: number;
    precio_compra_sin_iva: number;
    porcentaje_merma: number;
    iva_ingrediente: number;
    coste_real: number;
  }>;
  resumen: {
    coste_lote: number;
    coste_racion: number;
    pvp_sin_iva: number;
    pvp_con_iva: number;
  };
};

function toNum(v: unknown): number {
  const s = String(v ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function clampNonNeg(n: number): number {
  return n < 0 ? 0 : n;
}

function clampIvaCocina(n: number): number {
  const t = Math.trunc(n);
  if (t === 0 || t === 4 || t === 10 || t === 21) return t;
  return 10;
}

function calcCosteRealIngrediente(pCompraKgL: number, qtyGml: number, mermaPct: number): number {
  const base = (clampNonNeg(pCompraKgL) / 1000) * clampNonNeg(qtyGml);
  const m = clampNonNeg(mermaPct);
  return base * (1 + m / 100);
}

function newId(): string {
  return (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function lsKeyEscandallosCocina(establecimientoId: string): string {
  return `ops:escandallos_cocina:v1:${establecimientoId}`;
}

const ING_DEFAULT: Omit<IngredienteDraft, "id"> = {
  nombre_ingrediente: "",
  cantidad_gramos_ml: "0",
  precio_compra_sin_iva: "0",
  porcentaje_merma: "0",
  iva_ingrediente: "10"
};

function newIngredienteRow(): IngredienteDraft {
  return { ...ING_DEFAULT, id: newId() };
}

/** Evita TypeError si `currentTarget` es null (p. ej. eventos sintéticos / desmontaje). */
function readInputOrSelectValue(ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>): string {
  const el = ev.currentTarget ?? (ev.target as HTMLInputElement | HTMLSelectElement | null);
  if (el && typeof (el as HTMLInputElement).value === "string") return (el as HTMLInputElement).value;
  return "";
}

/** Garantiza un objeto de fila válido para map / cálculos (nunca null ni campos undefined). */
function coerceIngredienteDraft(x: unknown, index: number): IngredienteDraft {
  const fallbackId = `ing-row-${index}`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id.trim() ? o.id : fallbackId;
    return {
      id,
      nombre_ingrediente: String(o.nombre_ingrediente ?? ""),
      cantidad_gramos_ml: String(o.cantidad_gramos_ml ?? "0"),
      precio_compra_sin_iva: String(o.precio_compra_sin_iva ?? "0"),
      porcentaje_merma: String(o.porcentaje_merma ?? "0"),
      iva_ingrediente: String(o.iva_ingrediente ?? "10")
    };
  }
  return { ...ING_DEFAULT, id: fallbackId };
}

function normalizeIngredientesList(arr: unknown): IngredienteDraft[] {
  if (!Array.isArray(arr) || arr.length === 0) return [newIngredienteRow()];
  return arr.map((x, i) => coerceIngredienteDraft(x, i));
}

export default function NuevoEscandalloCocinaPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canEdit = hasPermission(role, "admin");

  const { activeEstablishmentId } = useActiveEstablishment();

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [nombrePlato, setNombrePlato] = useState("");

  const [racionesLote, setRacionesLote] = useState("1");
  const [multiplicador, setMultiplicador] = useState("3,5");
  const [ivaFinal, setIvaFinal] = useState("10");

  const [ingredientes, setIngredientes] = useState<IngredienteDraft[]>(() => [newIngredienteRow()]);

  const [guardados, setGuardados] = useState<EscandalloGuardado[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string>("");

  useEffect(() => {
    if (!activeEstablishmentId) {
      setGuardados([]);
      return;
    }
    try {
      const key = lsKeyEscandallosCocina(activeEstablishmentId);
      const raw = localStorage.getItem(key);
      if (!raw) {
        setGuardados([]);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setGuardados([]);
        return;
      }
      const clean = parsed
        .filter((x) => x && typeof x === "object")
        .map((x) => x as EscandalloGuardado)
        .filter((x) => typeof x?.nombre_plato === "string" && typeof x?.created_at === "string");
      clean.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      setGuardados(clean.slice(0, 50));
    } catch {
      setGuardados([]);
    }
  }, [activeEstablishmentId]);

  const ingredientesRows = useMemo(() => normalizeIngredientesList(ingredientes), [ingredientes]);

  const calc = useMemo(() => {
    const raciones = Math.max(1e-6, clampNonNeg(toNum(racionesLote)));
    const mult = Math.max(0, clampNonNeg(toNum(multiplicador)));
    const iva = clampNonNeg(toNum(ivaFinal));

    const lines = ingredientesRows
      .map((it) => {
        const qty = clampNonNeg(toNum(it.cantidad_gramos_ml));
        const precio = clampNonNeg(toNum(it.precio_compra_sin_iva));
        const merma = clampNonNeg(toNum(it.porcentaje_merma));
        const coste = calcCosteRealIngrediente(precio, qty, merma);
        return { ...it, qty, precio, merma, coste };
      })
      .filter((x) => x.nombre_ingrediente.trim() || x.qty > 0 || x.precio > 0);

    const costeLote = lines.reduce((acc, x) => acc + x.coste, 0);
    const costeRacion = costeLote / raciones;
    const pvpSinIva = costeRacion * mult;
    const pvpConIva = pvpSinIva * (1 + iva / 100);
    const margenContribEur = pvpSinIva - costeRacion;
    const margenContribPct = pvpSinIva > 0 ? (margenContribEur / pvpSinIva) * 100 : 0;

    return {
      raciones,
      mult,
      iva,
      lines,
      costeLote,
      costeRacion,
      pvpSinIva,
      pvpConIva,
      margenContribEur,
      margenContribPct
    };
  }, [ingredientesRows, ivaFinal, multiplicador, racionesLote]);

  function formatEUR(n: number): string {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
  }

  function persistGuardadoLocal(nextItem: EscandalloGuardado) {
    if (!activeEstablishmentId) return;
    try {
      const key = lsKeyEscandallosCocina(activeEstablishmentId);
      const prev = guardados ?? [];
      // Upsert por nombre (misma UX que BD): el mismo plato sobrescribe.
      const withoutSame = prev.filter((x) => x.nombre_plato.trim().toLowerCase() !== nextItem.nombre_plato.trim().toLowerCase());
      const merged = [nextItem, ...withoutSame].slice(0, 50);
      localStorage.setItem(key, JSON.stringify(merged));
      setGuardados(merged);
    } catch {
      // ignore
    }
  }

  function borrarGuardadoLocal(id: string) {
    if (!activeEstablishmentId) return;
    const target = guardados.find((x) => x.id === id) ?? null;
    if (!target) return;
    const ok = window.confirm("¿Estás seguro de que quieres eliminar este escandallo?");
    if (!ok) return;
    try {
      const key = lsKeyEscandallosCocina(activeEstablishmentId);
      const next = (guardados ?? []).filter((x) => x.id !== id);
      localStorage.setItem(key, JSON.stringify(next));
      setGuardados(next);
      setSelectedSavedId((cur) => (cur === id ? "" : cur));
    } catch {
      // ignore
    }
  }

  async function guardar() {
    if (!activeEstablishmentId) {
      setErr("Selecciona un establecimiento.");
      return;
    }
    const nombre = nombrePlato.trim();
    if (!nombre) {
      setErr("Indica el nombre del plato.");
      return;
    }
    setErr(null);
    setOk(null);
    setSaving(true);
    try {
      const ivaF = Math.trunc(clampNonNeg(toNum(ivaFinal)) || 10);
      const ivaOk = [0, 4, 10, 21].includes(ivaF) ? ivaF : 10;

      // Guardado local inmediato (resiliente) para no “perder” el escandallo aunque falle la BD.
      persistGuardadoLocal({
        id: newId(),
        establecimiento_id: activeEstablishmentId,
        nombre_plato: nombre,
        created_at: new Date().toISOString(),
        raciones_lote: clampNonNeg(toNum(racionesLote)) || 1,
        multiplicador: clampNonNeg(toNum(multiplicador)) || 3.5,
        iva_final: ivaOk,
        ingredientes: calc.lines
          .filter((x) => x.nombre_ingrediente.trim())
          .map((x) => ({
            nombre_ingrediente: x.nombre_ingrediente.trim(),
            cantidad_gramos_ml: clampNonNeg(x.qty),
            precio_compra_sin_iva: clampNonNeg(x.precio),
            porcentaje_merma: clampNonNeg(x.merma),
            iva_ingrediente: clampIvaCocina(toNum(x.iva_ingrediente)),
            coste_real: clampNonNeg(x.coste)
          })),
        resumen: {
          coste_lote: calc.costeLote,
          coste_racion: calc.costeRacion,
          pvp_sin_iva: calc.pvpSinIva,
          pvp_con_iva: calc.pvpConIva
        }
      });

      const ingredientesPayload = calc.lines
        .filter((x) => x.nombre_ingrediente.trim())
        .map((x) => ({
          nombre_ingrediente: x.nombre_ingrediente.trim(),
          cantidad_gramos_ml: clampNonNeg(x.qty),
          precio_compra_sin_iva: clampNonNeg(x.precio),
          porcentaje_merma: clampNonNeg(x.merma),
          iva_ingrediente: clampIvaCocina(toNum(x.iva_ingrediente))
        }));

      const { data: escId, error: rpcErr } = await supabase().rpc("save_escandallo_cocina", {
        p_nombre_plato: nombre,
        p_raciones_lote: clampNonNeg(toNum(racionesLote)) || 1,
        p_multiplicador: clampNonNeg(toNum(multiplicador)) || 3.5,
        p_iva_final: ivaOk,
        p_ingredientes: ingredientesPayload
      });
      if (rpcErr) throw rpcErr;
      if (!escId) throw new Error("No se pudo guardar el escandallo (sin id).");

      setOk("Escandallo guardado.");
      setTimeout(() => setOk(null), 2000);
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canEdit) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Escandallos de Cocina</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Nuevo escandallo (Cocina)" showBack backHref="/admin/escandallos" />
      <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 p-4 pb-28 lg:flex-row lg:items-start lg:gap-6">
        <section className="order-1 min-w-0 flex-1 space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-slate-900">Escandallo de cocina</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Ingeniería de menú: coste teórico por ración. Sin vínculo a productos ni inventario.
                </p>
              </div>
              <Link
                href="/admin/escandallos"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Volver
              </Link>
            </div>
          </div>

          {err ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
          ) : null}
          {ok ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{ok}</p>
          ) : null}

          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Plato</h2>
            <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Nombre del plato
              <input
                type="text"
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={nombrePlato}
                onChange={(e) => setNombrePlato(readInputOrSelectValue(e))}
                placeholder="Ej: Tarta de queso"
                autoComplete="off"
                disabled={!activeEstablishmentId}
              />
            </label>
            <p className="mt-2 text-xs text-slate-500">
              El nombre no tiene que existir en el catálogo de productos. Mismo nombre en este local actualiza el escandallo guardado.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Parámetros</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Raciones / lote
                <input
                  className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={racionesLote}
                  onChange={(e) => setRacionesLote(readInputOrSelectValue(e))}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Multiplicador
                <input
                  className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={multiplicador}
                  onChange={(e) => setMultiplicador(readInputOrSelectValue(e))}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                IVA final (%)
                <input
                  className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="numeric"
                  value={ivaFinal}
                  onChange={(e) => setIvaFinal(readInputOrSelectValue(e))}
                />
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Ingredientes</h2>
              <Button
                type="button"
                className="min-h-11"
                onClick={() =>
                  setIngredientes((prev) => [...normalizeIngredientesList(prev), newIngredienteRow()])
                }
              >
                Añadir ingrediente
              </Button>
            </div>

            <div className="-mx-1 mt-3 max-w-full min-w-0 overflow-x-auto rounded-2xl border border-slate-100 px-1 sm:mx-0 sm:border-0 sm:px-0">
              <table className="w-full min-w-[720px] border-separate border-spacing-0 sm:min-w-[820px]">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    <th className="min-w-[10rem] px-2 py-2">Ingrediente</th>
                    <th className="min-w-[6.5rem] px-2 py-2 text-right">Cantidad (g/ml)</th>
                    <th className="min-w-[7rem] px-2 py-2 text-right">Precio (€/kg o €/L)</th>
                    <th className="min-w-[5.5rem] px-2 py-2 text-right">Merma (%)</th>
                    <th className="min-w-[5.5rem] px-2 py-2 text-right">IVA ing. (%)</th>
                    <th className="min-w-[6rem] px-2 py-2 text-right">Coste real</th>
                    <th className="min-w-[4.5rem] px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {ingredientesRows.map((it) => {
                    const qty = clampNonNeg(toNum(it.cantidad_gramos_ml));
                    const precio = clampNonNeg(toNum(it.precio_compra_sin_iva));
                    const merma = clampNonNeg(toNum(it.porcentaje_merma));
                    const coste = calcCosteRealIngrediente(precio, qty, merma);
                    return (
                      <tr key={it.id} className="border-t border-slate-100">
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 min-w-[9.5rem] w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                            value={it.nombre_ingrediente}
                            onChange={(e) => {
                              const v = readInputOrSelectValue(e);
                              setIngredientes((prev) =>
                                normalizeIngredientesList(prev).map((x) => (x.id === it.id ? { ...x, nombre_ingrediente: v } : x))
                              );
                            }}
                            placeholder="Ej: Tomate"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 min-w-[6.25rem] w-full rounded-2xl border border-slate-200 bg-white px-3 text-right text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                            inputMode="decimal"
                            value={it.cantidad_gramos_ml}
                            onChange={(e) => {
                              const v = readInputOrSelectValue(e);
                              setIngredientes((prev) =>
                                normalizeIngredientesList(prev).map((x) => (x.id === it.id ? { ...x, cantidad_gramos_ml: v } : x))
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 min-w-[6.25rem] w-full rounded-2xl border border-slate-200 bg-white px-3 text-right text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                            inputMode="decimal"
                            value={it.precio_compra_sin_iva}
                            onChange={(e) => {
                              const v = readInputOrSelectValue(e);
                              setIngredientes((prev) =>
                                normalizeIngredientesList(prev).map((x) => (x.id === it.id ? { ...x, precio_compra_sin_iva: v } : x))
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 min-w-[5rem] w-full rounded-2xl border border-slate-200 bg-white px-3 text-right text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                            inputMode="decimal"
                            value={it.porcentaje_merma}
                            onChange={(e) => {
                              const v = readInputOrSelectValue(e);
                              setIngredientes((prev) =>
                                normalizeIngredientesList(prev).map((x) => (x.id === it.id ? { ...x, porcentaje_merma: v } : x))
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 min-w-[5rem] w-full rounded-2xl border border-slate-200 bg-white px-3 text-right text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                            inputMode="numeric"
                            value={it.iva_ingrediente}
                            onChange={(e) => {
                              const v = readInputOrSelectValue(e);
                              setIngredientes((prev) =>
                                normalizeIngredientesList(prev).map((x) => (x.id === it.id ? { ...x, iva_ingrediente: v } : x))
                              );
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 align-top text-right text-sm font-semibold tabular-nums text-slate-900">
                          {formatEUR(coste)}
                        </td>
                        <td className="px-2 py-2 align-top text-right">
                          <button
                            type="button"
                            className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() =>
                              setIngredientes((prev) => {
                                const base = normalizeIngredientesList(prev).filter((x) => x.id !== it.id);
                                return base.length ? base : [newIngredienteRow()];
                              })
                            }
                            disabled={ingredientesRows.length <= 1}
                            title={ingredientesRows.length <= 1 ? "Debe existir al menos 1 fila" : "Eliminar"}
                          >
                            Quitar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <Button
                onClick={() => void guardar()}
                disabled={saving || !nombrePlato.trim() || !activeEstablishmentId}
                className="min-h-12 w-full sm:w-auto"
              >
                {saving ? "Guardando…" : "Guardar escandallo"}
              </Button>
            </div>
          </div>
        </section>

        <aside className="order-2 w-full min-w-0 max-w-full space-y-4 lg:sticky lg:top-4 lg:w-[360px] lg:max-w-full lg:shrink-0 lg:self-start">
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Resultados</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Coste total lote</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatEUR(calc.costeLote)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Coste por ración</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatEUR(calc.costeRacion)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">PVP sugerido (sin IVA)</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatEUR(calc.pvpSinIva)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">PVP sugerido (con IVA)</dt>
                <dd className="text-lg font-extrabold tabular-nums text-slate-900">{formatEUR(calc.pvpConIva)}</dd>
              </div>
              <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Margen de contribución</p>
                <p className="mt-1 text-base font-extrabold tabular-nums text-slate-900">{formatEUR(calc.margenContribEur)}</p>
                <p className="text-xs text-slate-600">{calc.margenContribPct.toFixed(2)}% sobre PVP sin IVA</p>
              </div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Fórmulas: coste ingrediente = (precio/1000)*cantidad*(1+merma/100). PVP = (coste/ración*multiplicador)*(1+IVA/100).
            </p>
          </section>
        </aside>
      </main>

      <section className="mx-auto w-full max-w-6xl px-4 pb-28 lg:px-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Escandallos Guardados</h2>
          <p className="mt-1 text-sm text-slate-600">Se guardan en este dispositivo (LocalStorage) para no perder trabajo.</p>

          {guardados.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Aún no hay escandallos guardados.
            </p>
          ) : (
            <>
              <section className="mt-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
                <h3 className="text-base font-bold text-slate-900">Consultar escandallo</h3>
                <p className="mt-1 text-sm text-slate-600">Selecciona un producto para ver su ficha.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                    Producto
                    <select
                      className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                      value={selectedSavedId}
                      onChange={(e) => setSelectedSavedId(e.currentTarget.value)}
                      aria-label="Consultar escandallo"
                    >
                      <option value="">(Selecciona…)</option>
                      {guardados
                        .slice()
                        .sort((a, b) => a.nombre_plato.localeCompare(b.nombre_plato, "es", { sensitivity: "base" }))
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.nombre_plato}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>

                {selectedSavedId ? (
                  (() => {
                    const g = guardados.find((x) => x.id === selectedSavedId) ?? null;
                    if (!g) return null;
                    const costeTotal = Number(g.resumen?.coste_lote ?? 0) || 0;
                    const pvpSin = Number(g.resumen?.pvp_sin_iva ?? 0) || 0;
                    const pvpCon = Number(g.resumen?.pvp_con_iva ?? 0) || 0;
                    const costeRacion = Number(g.resumen?.coste_racion ?? 0) || 0;
                    const margenEur = pvpSin - costeRacion;
                    const margenPct = pvpSin > 0 ? (margenEur / pvpSin) * 100 : 0;

                    return (
                      <article className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="truncate text-base font-bold leading-snug text-slate-900">{g.nombre_plato}</h4>
                            <p className="mt-1 text-xs text-slate-500">{new Date(g.created_at).toLocaleString("es-ES")}</p>
                          </div>
                          <button
                            type="button"
                            className="min-h-11 rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 hover:bg-red-100"
                            onClick={() => borrarGuardadoLocal(g.id)}
                          >
                            Eliminar
                          </button>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-2xl bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Coste total</p>
                            <p className="mt-1 font-semibold tabular-nums text-slate-900">{formatEUR(costeTotal)}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Margen</p>
                            <p className="mt-1 font-semibold tabular-nums text-slate-900">
                              {formatEUR(margenEur)}{" "}
                              <span className="text-xs font-normal text-slate-500">({margenPct.toFixed(2)}%)</span>
                            </p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">PVP sugerido (sin IVA)</p>
                            <p className="mt-1 font-semibold tabular-nums text-slate-900">{formatEUR(pvpSin)}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">PVP sugerido (con IVA)</p>
                            <p className="mt-1 text-lg font-extrabold tabular-nums text-slate-900">{formatEUR(pvpCon)}</p>
                          </div>
                        </div>

                        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100">
                          <table className="w-full min-w-[720px] text-sm">
                            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-3 py-2 text-left">Ingrediente</th>
                                <th className="px-3 py-2 text-right">Cantidad</th>
                                <th className="px-3 py-2 text-right">Unidad</th>
                                <th className="px-3 py-2 text-right">Precio</th>
                                <th className="px-3 py-2 text-right">Merma</th>
                                <th className="px-3 py-2 text-right">Coste real</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.ingredientes.map((it, idx) => (
                                <tr key={`${g.id}-${idx}`} className="border-t border-slate-100">
                                  <td className="px-3 py-2">{it.nombre_ingrediente}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{it.cantidad_gramos_ml}</td>
                                  <td className="px-3 py-2 text-right text-xs font-semibold text-slate-600">g/ml</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{formatEUR(it.precio_compra_sin_iva)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{it.porcentaje_merma}%</td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatEUR(it.coste_real)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </article>
                    );
                  })()
                ) : null}
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

