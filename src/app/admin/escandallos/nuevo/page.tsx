"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MobileHeader } from "@/components/MobileHeader";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";

type PlatoRow = { id: string; nombre: string };

type IngredienteDraft = {
  id: string;
  nombre_ingrediente: string;
  cantidad_gramos_ml: string;
  precio_compra_sin_iva: string; // €/kg o €/L
  porcentaje_merma: string;
  iva_ingrediente: string;
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

function calcCosteRealIngrediente(pCompraKgL: number, qtyGml: number, mermaPct: number): number {
  const base = (clampNonNeg(pCompraKgL) / 1000) * clampNonNeg(qtyGml);
  const m = clampNonNeg(mermaPct);
  return base * (1 + m / 100);
}

function newId(): string {
  return (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function NuevoEscandalloCocinaPage() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canEdit = hasPermission(role, "admin");

  const { activeEstablishmentId } = useActiveEstablishment();

  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [platos, setPlatos] = useState<PlatoRow[]>([]);
  const [qPlato, setQPlato] = useState("");
  const [platoId, setPlatoId] = useState("");

  const [racionesLote, setRacionesLote] = useState("1");
  const [multiplicador, setMultiplicador] = useState("3,5");
  const [ivaFinal, setIvaFinal] = useState("10");

  const [ingredientes, setIngredientes] = useState<IngredienteDraft[]>([
    {
      id: newId(),
      nombre_ingrediente: "",
      cantidad_gramos_ml: "0",
      precio_compra_sin_iva: "0",
      porcentaje_merma: "0",
      iva_ingrediente: "10"
    }
  ]);

  useEffect(() => {
    if (!canEdit) return;
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        const col = await resolveProductoTituloColumn(activeEstablishmentId);
        const t = tituloColSql(col);
        // Plato = producto "comida" (compat: categoria o tipo)
        const { data, error } = await supabase()
          .from("productos")
          .select(`id,${t},categoria,tipo` as "*")
          .eq("establecimiento_id", activeEstablishmentId)
          .order(t, { ascending: true });
        if (error) throw error;
        const list = ((data ?? []) as unknown as Record<string, unknown>[])
          .filter((r) => {
            const c = String(r.categoria ?? "").trim().toLowerCase();
            const tp = String(r.tipo ?? "").trim().toLowerCase();
            return c === "comida" || tp === "comida";
          })
          .map((r) => ({
            id: String(r.id ?? ""),
            nombre: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—"
          }))
          .filter((x) => !!x.id);
        if (cancelled) return;
        setPlatos(list);
      } catch (e) {
        if (!cancelled) setErr(supabaseErrToString(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, canEdit]);

  const platosFiltrados = useMemo(() => {
    const key = qPlato
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}+/gu, "");
    if (!key) return platos;
    return platos.filter((p) =>
      p.nombre
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}+/gu, "")
        .includes(key)
    );
  }, [platos, qPlato]);

  const calc = useMemo(() => {
    const raciones = Math.max(1e-6, clampNonNeg(toNum(racionesLote)));
    const mult = Math.max(0, clampNonNeg(toNum(multiplicador)));
    const iva = clampNonNeg(toNum(ivaFinal));

    const lines = ingredientes
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
  }, [ingredientes, ivaFinal, multiplicador, racionesLote]);

  function formatEUR(n: number): string {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
  }

  async function guardar() {
    if (!activeEstablishmentId) {
      setErr("Selecciona un establecimiento.");
      return;
    }
    if (!platoId) {
      setErr("Selecciona un plato.");
      return;
    }
    setErr(null);
    setOk(null);
    setLoading(true);
    try {
      const payloadEsc = {
        establecimiento_id: activeEstablishmentId,
        producto_id: platoId,
        raciones_lote: clampNonNeg(toNum(racionesLote)) || 1,
        multiplicador: clampNonNeg(toNum(multiplicador)) || 3.5,
        iva_final: Math.trunc(clampNonNeg(toNum(ivaFinal)) || 10)
      };

      const { data: esc, error: escErr } = await supabase()
        .from("escandallos_cocina")
        .upsert(payloadEsc, { onConflict: "establecimiento_id,producto_id" })
        .select("id")
        .maybeSingle();
      if (escErr) throw escErr;
      const escId = String((esc as { id?: unknown } | null)?.id ?? "");
      if (!escId) throw new Error("No se pudo obtener el id del escandallo.");

      // Reescribimos ingredientes (simplifica UX del 'nuevo' y evita estados parciales)
      const { error: delErr } = await supabase()
        .from("escandallo_ingredientes")
        .delete()
        .eq("escandallo_id", escId)
        .eq("establecimiento_id", activeEstablishmentId);
      if (delErr) throw delErr;

      const ingRows = calc.lines
        .filter((x) => x.nombre_ingrediente.trim())
        .map((x) => ({
          escandallo_id: escId,
          establecimiento_id: activeEstablishmentId,
          nombre_ingrediente: x.nombre_ingrediente.trim(),
          cantidad_gramos_ml: clampNonNeg(x.qty),
          precio_compra_sin_iva: clampNonNeg(x.precio),
          porcentaje_merma: clampNonNeg(x.merma),
          iva_ingrediente: Math.trunc(clampNonNeg(toNum(x.iva_ingrediente)) || 10)
        }));

      if (ingRows.length) {
        const { error: insErr } = await supabase().from("escandallo_ingredientes").insert(ingRows);
        if (insErr) throw insErr;
      }

      setOk("Escandallo guardado.");
      setTimeout(() => setOk(null), 2000);
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setLoading(false);
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
      <main className="mx-auto grid max-w-6xl gap-4 p-4 pb-28 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-slate-900">Escandallo de cocina</h1>
                <p className="mt-1 text-sm text-slate-600">Coste teórico por ración (no toca stock).</p>
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
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Buscar
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={qPlato}
                  onChange={(e) => setQPlato(e.currentTarget.value)}
                  placeholder="Escribe para filtrar…"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Selector de plato (comida)
                <select
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={platoId}
                  onChange={(e) => setPlatoId(e.currentTarget.value)}
                  disabled={!activeEstablishmentId || loading}
                >
                  <option value="">{loading ? "Cargando…" : "(Selecciona…)"}</option>
                  {platosFiltrados.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!loading && activeEstablishmentId && platos.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                No hay platos en este establecimiento: solo aparecen productos con{" "}
                <span className="font-semibold">categoría «comida»</span> o <span className="font-semibold">tipo «comida»</span> (sin distinguir mayúsculas).
                Crea o edita un producto desde <Link href="/admin/productos" className="font-semibold underline">Productos</Link> y vuelve aquí.
              </p>
            ) : null}
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
                  onChange={(e) => setRacionesLote(e.currentTarget.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Multiplicador
                <input
                  className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={multiplicador}
                  onChange={(e) => setMultiplicador(e.currentTarget.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                IVA final (%)
                <input
                  className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="numeric"
                  value={ivaFinal}
                  onChange={(e) => setIvaFinal(e.currentTarget.value)}
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
                  setIngredientes((prev) => [
                    ...prev,
                    {
                      id: newId(),
                      nombre_ingrediente: "",
                      cantidad_gramos_ml: "0",
                      precio_compra_sin_iva: "0",
                      porcentaje_merma: "0",
                      iva_ingrediente: "10"
                    }
                  ])
                }
              >
                Añadir ingrediente
              </Button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[820px] border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Ingrediente</th>
                    <th className="px-2 py-2 text-right">Cantidad (g/ml)</th>
                    <th className="px-2 py-2 text-right">Precio (€/kg o €/L)</th>
                    <th className="px-2 py-2 text-right">Merma (%)</th>
                    <th className="px-2 py-2 text-right">IVA ing. (%)</th>
                    <th className="px-2 py-2 text-right">Coste real</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {ingredientes.map((it) => {
                    const qty = clampNonNeg(toNum(it.cantidad_gramos_ml));
                    const precio = clampNonNeg(toNum(it.precio_compra_sin_iva));
                    const merma = clampNonNeg(toNum(it.porcentaje_merma));
                    const coste = calcCosteRealIngrediente(precio, qty, merma);
                    return (
                      <tr key={it.id} className="border-t border-slate-100">
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                            value={it.nombre_ingrediente}
                            onChange={(e) =>
                              setIngredientes((prev) => prev.map((x) => (x.id === it.id ? { ...x, nombre_ingrediente: e.currentTarget.value } : x)))
                            }
                            placeholder="Ej: Tomate"
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-right text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                            inputMode="decimal"
                            value={it.cantidad_gramos_ml}
                            onChange={(e) =>
                              setIngredientes((prev) => prev.map((x) => (x.id === it.id ? { ...x, cantidad_gramos_ml: e.currentTarget.value } : x)))
                            }
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-right text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                            inputMode="decimal"
                            value={it.precio_compra_sin_iva}
                            onChange={(e) =>
                              setIngredientes((prev) => prev.map((x) => (x.id === it.id ? { ...x, precio_compra_sin_iva: e.currentTarget.value } : x)))
                            }
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-right text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                            inputMode="decimal"
                            value={it.porcentaje_merma}
                            onChange={(e) =>
                              setIngredientes((prev) => prev.map((x) => (x.id === it.id ? { ...x, porcentaje_merma: e.currentTarget.value } : x)))
                            }
                          />
                        </td>
                        <td className="px-2 py-2 align-top">
                          <input
                            className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-right text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                            inputMode="numeric"
                            value={it.iva_ingrediente}
                            onChange={(e) =>
                              setIngredientes((prev) => prev.map((x) => (x.id === it.id ? { ...x, iva_ingrediente: e.currentTarget.value } : x)))
                            }
                          />
                        </td>
                        <td className="px-2 py-2 align-top text-right text-sm font-semibold tabular-nums text-slate-900">
                          {formatEUR(coste)}
                        </td>
                        <td className="px-2 py-2 align-top text-right">
                          <button
                            type="button"
                            className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => setIngredientes((prev) => prev.filter((x) => x.id !== it.id))}
                            disabled={ingredientes.length <= 1}
                            title={ingredientes.length <= 1 ? "Debe existir al menos 1 fila" : "Eliminar"}
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
              <Button onClick={() => void guardar()} disabled={loading || !platoId || !activeEstablishmentId} className="min-h-12 w-full sm:w-auto">
                {loading ? "Guardando…" : "Guardar escandallo"}
              </Button>
            </div>
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
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
    </div>
  );
}

