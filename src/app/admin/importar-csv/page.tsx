"use client";

import type { DragEvent, ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { normalizeNombreClave } from "@/lib/csvProductImport";
import type { ProductoTituloCol } from "@/lib/productosTituloColumn";
import {
  resolveProductoTituloColumn,
  tituloColSql,
  tituloUpsertOnConflict,
  tituloWritePayload
} from "@/lib/productosTituloColumn";

const UNIDADES_PERMITIDAS = new Set(["caja", "barril", "botella", "lata", "unidad"]);

type CsvRow = {
  /** Clave de producto (CSV puede traer columna "nombre" o "articulo"; aquí siempre unificado). */
  articulo: string;
  tipo: string;
  unidad: string;
  stock_actual: number;
  stock_minimo: number;
  /** Valor de celda no numérico: se importa como 0 */
  stockActualInvalido?: boolean;
  stockMinimoInvalido?: boolean;
};

type FilaVista = CsvRow & {
  accion: "nuevo" | "actualizar";
  idExistente?: string;
  duplicadaEnCsv?: boolean;
};

type ProductoExistente = { id: string; qr_code_uid: string | null };

const BATCH_SIZE = 50;

function supabaseErrToString(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e) {
    const anyErr = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const msg = typeof anyErr.message === "string" ? anyErr.message : "";
    const details = typeof anyErr.details === "string" ? anyErr.details : "";
    const hint = typeof anyErr.hint === "string" ? anyErr.hint : "";
    const code = typeof anyErr.code === "string" ? anyErr.code : "";
    return [msg, details, hint, code].filter(Boolean).join(" · ") || "Error desconocido";
  }
  return String(e);
}

function parseStockCell(raw: unknown): { n: number; invalido: boolean } {
  const s = String(raw ?? "").trim();
  if (!s) return { n: 0, invalido: false };
  const cleaned = s.replace(/\s/g, "").replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return { n: 0, invalido: true };
  return { n, invalido: false };
}

function coerceUnidad(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return "unidad";
  if (UNIDADES_PERMITIDAS.has(t)) return t;
  return "unidad";
}

function analyzeCsvWithPapa(text: string): CsvRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parsed = Papa.parse<Record<string, string>>(trimmed, {
    header: true,
    delimiter: ";",
    skipEmptyLines: "greedy",
    transformHeader: (h) => String(h).trim().toLowerCase(),
    dynamicTyping: false
  });

  const papaFatal = parsed.errors?.find((e) => e.type === "Quotes" || e.type === "Delimiter");
  if (papaFatal?.message) throw new Error(`CSV inválido: ${papaFatal.message}`);

  const fields = (parsed.meta.fields ?? []).map((f) => String(f).trim().toLowerCase());
  const has = (n: string) => fields.includes(n);
  if (!has("nombre") && !has("articulo")) {
    throw new Error('CSV inválido: falta columna de artículo ("nombre" o "articulo").');
  }
  if (!has("tipo") && !has("categoria")) {
    throw new Error('CSV inválido: falta columna de categoría ("tipo" o "categoria").');
  }
  if (!has("unidad")) throw new Error('CSV inválido: falta la columna "unidad".');
  if (!has("stock_actual")) throw new Error('CSV inválido: falta la columna "stock_actual".');
  if (!has("stock_minimo")) throw new Error('CSV inválido: falta la columna "stock_minimo".');

  const out: CsvRow[] = [];
  for (const rec of parsed.data) {
    if (!rec || typeof rec !== "object") continue;
    const articulo = String(rec["articulo"] ?? rec["nombre"] ?? "").trim();
    if (!articulo) continue;

    const tipoRaw = String(rec["tipo"] ?? rec["categoria"] ?? "").trim();
    const unidadRaw = String(rec["unidad"] ?? "").trim();

    const sa = parseStockCell(rec["stock_actual"]);
    const sm = parseStockCell(rec["stock_minimo"]);

    out.push({
      articulo,
      tipo: tipoRaw,
      unidad: coerceUnidad(unidadRaw),
      stock_actual: Math.trunc(sa.n) || 0,
      stock_minimo: Math.trunc(sm.n) || 0,
      stockActualInvalido: sa.invalido,
      stockMinimoInvalido: sm.invalido
    });
  }
  return out;
}

function dedupeRowsLastWins(rows: CsvRow[]): CsvRow[] {
  const out: CsvRow[] = [];
  const seen = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    const k = normalizeNombreClave(r.articulo);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.reverse();
}

function downloadTemplate() {
  const content =
    "nombre;tipo;unidad;stock_actual;stock_minimo;\n" + "BARRIL ESTRELLA 30L;cerveza;barril;0;0;\n";
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-productos-ops.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ImportarCsvPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const { activeEstablishmentId } = useActiveEstablishment();

  /** Texto crudo del CSV (área avanzada o tras cargar archivo) */
  const [csvText, setCsvText] = useState("");
  /** Filas ya analizadas (paso 2 / validación visual) */
  const [rowsAnalizadas, setRowsAnalizadas] = useState<CsvRow[]>([]);
  const [analisisErr, setAnalisisErr] = useState<string | null>(null);
  const [analizado, setAnalizado] = useState(false);

  const [productosPorClave, setProductosPorClave] = useState<Map<string, ProductoExistente>>(new Map());
  const [cargandoMapa, setCargandoMapa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchMyRole()
      .then((r) => {
        if (cancelled) return;
        setRole(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cargarMapaNombres = useCallback(async () => {
    if (!activeEstablishmentId) return;
    setCargandoMapa(true);
    try {
      const col = await resolveProductoTituloColumn(activeEstablishmentId);
      const t = tituloColSql(col);
      const { data, error } = await supabase()
        .from("productos")
        .select(`id,${t},qr_code_uid` as "*")
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;

      const m = new Map<string, ProductoExistente>();
      for (const p of (data as unknown as Array<Record<string, unknown>> | null) ?? []) {
        const label = String(p.articulo ?? p.nombre ?? "").trim();
        if (!label) continue;
        m.set(normalizeNombreClave(label), {
          id: String(p.id ?? ""),
          qr_code_uid: p.qr_code_uid != null ? String(p.qr_code_uid) : null
        });
      }
      setProductosPorClave(m);
    } catch (e) {
      setProductosPorClave(new Map());
      setErr(supabaseErrToString(e));
    } finally {
      setCargandoMapa(false);
    }
  }, [activeEstablishmentId]);

  useEffect(() => {
    if (!activeEstablishmentId) return;
    cargarMapaNombres().catch(() => undefined);
  }, [activeEstablishmentId, cargarMapaNombres]);

  const { filasVista, nNuevos, nActualizacion, filasUnicasImport } = useMemo(() => {
    const vist: FilaVista[] = [];
    for (const r of rowsAnalizadas) {
      const k = normalizeNombreClave(r.articulo);
      const ex = productosPorClave.get(k);
      const duplicadaEnCsv =
        rowsAnalizadas.filter((x) => normalizeNombreClave(x.articulo) === k).length > 1;
      vist.push({ ...r, accion: ex ? "actualizar" : "nuevo", idExistente: ex?.id, duplicadaEnCsv });
    }
    const unicas = dedupeRowsLastWins(rowsAnalizadas);
    let nN = 0;
    let nA = 0;
    for (const r of unicas) {
      const k = normalizeNombreClave(r.articulo);
      if (productosPorClave.get(k)) nA++;
      else nN++;
    }
    return { filasVista: vist, nNuevos: nN, nActualizacion: nA, filasUnicasImport: unicas };
  }, [rowsAnalizadas, productosPorClave]);

  const nDuplicadosOmitidos = Math.max(0, rowsAnalizadas.length - filasUnicasImport.length);

  function Badge({
    color,
    children
  }: {
    color: "green" | "amber" | "gray";
    children: ReactNode;
  }) {
    const cls =
      color === "green"
        ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
        : color === "amber"
          ? "bg-amber-50 text-amber-900 ring-1 ring-amber-100"
          : "bg-slate-50 text-slate-700 ring-1 ring-slate-200";
    return (
      <span className={["inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tabular-nums", cls].join(" ")}>
        {children}
      </span>
    );
  }

  async function loadFile(file: File) {
    const text = await file.text();
    setCsvText(text);
    setAnalizado(false);
    setRowsAnalizadas([]);
    setAnalisisErr(null);
    setResult(null);
    setImportProgress(0);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f).catch(() => undefined);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.currentTarget.files?.[0];
    if (f) loadFile(f).catch(() => undefined);
  }

  function ejecutarAnalisis() {
    setAnalisisErr(null);
    setResult(null);
    setErr(null);
    setImportProgress(0);
    try {
      if (!csvText.trim()) {
        setRowsAnalizadas([]);
        setAnalizado(false);
        throw new Error("No hay contenido CSV. Sube un archivo o pega el texto.");
      }
      const rows = analyzeCsvWithPapa(csvText);
      setRowsAnalizadas(rows);
      setAnalizado(true);
    } catch (e) {
      setAnalisisErr(e instanceof Error ? e.message : String(e));
      setRowsAnalizadas([]);
      setAnalizado(false);
    }
  }

  /**
   * Mapeo blindado CSV → fila `productos` (solo columnas reales; nunca `nombre` en BD).
   */
  function buildPayloadFromCsvRow(
    r: CsvRow,
    ex: ProductoExistente | undefined,
    activeId: string,
    col: ProductoTituloCol
  ): Record<string, unknown> {
    const articuloVal = (r.articulo || "").trim();
    const categoria = (r.tipo || "General").trim() || "General";
    const unidad = coerceUnidad((r.unidad || "uds").trim());
    return {
      ...tituloWritePayload(col, articuloVal),
      categoria,
      unidad,
      stock_actual: parseFloat(String(r.stock_actual)) || 0,
      stock_minimo: parseFloat(String(r.stock_minimo)) || 0,
      establecimiento_id: activeId,
      proveedor_id: null,
      qr_code_uid: ex?.qr_code_uid ?? crypto.randomUUID().replaceAll("-", "")
    };
  }

  async function importar() {
    setErr(null);
    setResult(null);
    setBusy(true);
    setImportProgress(0);
    try {
      if (analisisErr) throw new Error(analisisErr);
      if (!analizado || !filasUnicasImport.length) throw new Error("Primero analiza el archivo con datos válidos.");
      if (!activeEstablishmentId) throw new Error("No hay establecimiento activo.");

      const tituloCol = await resolveProductoTituloColumn(activeEstablishmentId);

      const total = filasUnicasImport.length;
      let okCount = 0;
      setImportProgress(1);

      for (let i = 0; i < total; i += BATCH_SIZE) {
        const slice = filasUnicasImport.slice(i, i + BATCH_SIZE);
        const payload = slice.map((r) => {
          const k = normalizeNombreClave(r.articulo);
          const ex = productosPorClave.get(k);
          return buildPayloadFromCsvRow(r, ex, activeEstablishmentId, tituloCol);
        });

        const { error } = await supabase().from("productos").upsert(payload, {
          onConflict: tituloUpsertOnConflict(tituloCol)
        });

        if (error) throw new Error(supabaseErrToString(error));

        okCount += slice.length;
        setImportProgress(Math.min(100, Math.round((okCount / total) * 100)));
      }

      setImportProgress(100);
      setResult(`✅ ${okCount} productos importados correctamente (bloques de ${BATCH_SIZE}, upsert por artículo).`);
      await cargarMapaNombres();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error importando CSV:", e);
      if (typeof e === "object" && e && ("message" in e || "details" in e || "hint" in e)) {
        const anyErr = e as { message?: unknown; details?: unknown; hint?: unknown };
        // eslint-disable-next-line no-console
        console.error("Supabase error.message:", anyErr.message);
        // eslint-disable-next-line no-console
        console.error("Supabase error.details:", anyErr.details);
        // eslint-disable-next-line no-console
        console.error("Supabase error.hint:", anyErr.hint);
      }
      setErr(supabaseErrToString(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (role !== "admin" && role !== "superadmin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Importar CSV (Admin)</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Importar CSV" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl bg-slate-50 p-4 pb-28 text-slate-900">
        <h1 className="mb-2 text-xl font-semibold">Importar CSV</h1>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            <strong className="text-slate-900">Paso 1 — Limpieza y mapeo:</strong> cabecera{" "}
            <span className="font-mono font-semibold">nombre;tipo;unidad;stock_actual;stock_minimo</span> (o{" "}
            <span className="font-mono font-semibold">articulo;…</span>) — delimitador <strong>;</strong>, PapaParse.
          </li>
          <li>
            <strong className="text-slate-900">Paso 2 — Validación visual:</strong> previsualización; stocks no numéricos se
            marcan en rojo y se envían como 0.
          </li>
          <li>
            <strong className="text-slate-900">Paso 3 — Carga:</strong> lotes de {BATCH_SIZE} filas con barra de progreso;
            upsert por <span className="font-mono">articulo</span> (incluye <span className="font-mono">establecimiento_id</span> en cada fila).
          </li>
        </ol>

        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}
        {analisisErr ? (
          <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{analisisErr}</p>
        ) : null}
        {result ? (
          <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{result}</p>
        ) : null}

        {busy ? (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600">
              <span>Importando…</span>
              <span>{importProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-900 transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(2, importProgress))}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6">
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-base font-bold text-slate-900">Archivo</p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onPick} />
            <button
              type="button"
              className="flex min-h-14 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:border-slate-400 hover:bg-white disabled:opacity-50"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <span className="text-3xl" aria-hidden>
                📁
              </span>
              <span className="text-base font-bold text-slate-900">Seleccionar archivo desde el móvil</span>
              <span className="text-sm text-slate-600">CSV con delimitador ; (nombre o artículo)</span>
            </button>

            <div
              className={[
                "rounded-3xl border border-dashed p-4 text-center text-sm text-slate-500 transition",
                drag ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-white"
              ].join(" ")}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              También puedes soltar el archivo aquí
            </div>

            <div className="flex flex-col gap-3">
              <Button
                className="min-h-12 w-full text-base"
                onClick={ejecutarAnalisis}
                disabled={busy || !csvText.trim()}
              >
                Analizar archivo
              </Button>
              <Button
                onClick={importar}
                disabled={busy || !filasVista.length || !!analisisErr || !analizado}
                className="min-h-14 w-full bg-slate-900 text-lg font-bold text-white hover:bg-slate-800"
              >
                {busy ? "Importando…" : "Subir e importar"}
              </Button>
              <Button onClick={downloadTemplate} disabled={busy} className="min-h-12 w-full bg-slate-800 text-base hover:bg-slate-900">
                Descargar plantilla
              </Button>
              <button
                type="button"
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white text-base font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                onClick={() => cargarMapaNombres()}
                disabled={cargandoMapa}
              >
                {cargandoMapa ? "Actualizando coincidencias…" : "Recargar coincidencias"}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge color="green">[{nNuevos}] Productos nuevos</Badge>
              <Badge color="amber">[{nActualizacion}] Productos a actualizar</Badge>
              <Badge color="gray">[{nDuplicadosOmitidos}] Duplicados omitidos en este archivo</Badge>
            </div>
            <p className="text-xs text-slate-600">
              Categoría vacía → <span className="font-mono">General</span>. Unidad vacía o no reconocida →{" "}
              <span className="font-mono">unidad</span>.
            </p>
          </div>

          <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Leyenda</p>
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-amber-400" aria-hidden />
                <span className="text-slate-800">
                  Fila naranja: <strong>actualización</strong> (🔄).
                </span>
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-emerald-400" aria-hidden />
                <span className="text-slate-800">
                  Fila verde: <strong>alta nueva</strong> (＋).
                </span>
              </p>
              <p className="text-xs text-slate-600">
                Celda de stock con fondo rojo: valor no numérico; se importará como <strong>0</strong>.
              </p>
            </div>
            {filasVista.length > 0 ? (
              <p className="text-xs text-slate-600">
                Tras analizar: {nNuevos} nuevos, {nActualizacion} actualizaciones, {nDuplicadosOmitidos} duplicados
                omitidos.
                {cargandoMapa ? " (cargando productos actuales…)" : ""}
              </p>
            ) : null}
          </div>
        </div>

        {filasVista.length > 0 ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white shadow-sm">
            <p className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-base font-bold text-slate-900">
              Previsualización ({filasVista.length} líneas)
            </p>
            <ul className="max-h-[min(70vh,520px)] divide-y divide-slate-100 overflow-y-auto">
              {filasVista.map((f, i) => (
                <li
                  key={i}
                  className={[
                    "flex gap-4 px-4 py-4",
                    f.accion === "actualizar" ? "bg-amber-50/80" : "bg-emerald-50/50"
                  ].join(" ")}
                >
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-lg font-bold text-white shadow-sm"
                    aria-hidden
                  >
                    ✓
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-slate-900">{f.articulo}</p>
                      {f.accion === "actualizar" ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 ring-1 ring-amber-200">
                          Actualización
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-900 ring-1 ring-emerald-200">
                          Nuevo
                        </span>
                      )}
                      {f.duplicadaEnCsv ? (
                        <span className="text-xs font-medium text-slate-500" title="Duplicado en CSV">
                          Duplicado en archivo
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {f.tipo || "—"} · {f.unidad || "—"}
                    </p>
                    <p className="mt-2 font-mono text-sm tabular-nums text-slate-800">
                      Stock{" "}
                      <span className={f.stockActualInvalido ? "rounded bg-red-100 px-1 font-bold text-red-900" : "font-semibold"}>
                        {Number(f.stock_actual || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 })}
                      </span>
                      {" · "}
                      Mín.{" "}
                      <span className={f.stockMinimoInvalido ? "rounded bg-red-100 px-1 font-bold text-red-900" : "font-semibold"}>
                        {Number(f.stock_minimo || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 })}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : analizado && !analisisErr ? (
          <p className="mt-4 text-sm text-slate-600">El archivo no contiene filas válidas con artículo.</p>
        ) : !analisisErr ? (
          <p className="mt-4 text-sm text-slate-600">Sube un CSV y pulsa &quot;Analizar archivo&quot; para la previsualización.</p>
        ) : null}

        <details className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Pegar o editar CSV manualmente</summary>
          <textarea
            className="mt-3 h-56 w-full rounded-2xl border border-slate-200 bg-white p-3 font-mono text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={csvText}
            onChange={(e) => {
              setCsvText(e.currentTarget.value);
              setAnalizado(false);
              setRowsAnalizadas([]);
              setResult(null);
            }}
            spellCheck={false}
            placeholder={"nombre;tipo;unidad;stock_actual;stock_minimo\n"}
          />
        </details>
      </main>
    </div>
  );
}
