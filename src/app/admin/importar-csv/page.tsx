"use client";

import type { DragEvent, ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { normalizeNombreClave } from "@/lib/csvProductImport";

type CsvRow = {
  nombre: string;
  tipo: string;
  unidad: string;
  stock_actual: number;
  stock_minimo: number;
};

type FilaVista = CsvRow & {
  accion: "nuevo" | "actualizar";
  idExistente?: string;
  /** Misma clave en más de una fila: solo cuenta la última al importar */
  duplicadaEnCsv?: boolean;
};

type ProductoExistente = { id: string; qr_code_uid: string | null };

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

function splitSemiCsvLine(line: string): string[] {
  // CSV simple con ; (el archivo adjunto trae muchas columnas vacías al final: ;;;;)
  // Respetamos comillas por si las hubiera.
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ";") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function parseStockNumber(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, "").replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseProductosCsvStock(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  // Cabecera real: nombre;tipo;unidad;stock_actual;stock_minimo (delimitador ;)
  const headerLine = lines[0]!;
  const headers = splitSemiCsvLine(headerLine)
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map((h) => h.toLowerCase());

  const idx = (name: string) => headers.findIndex((h) => h === name);
  const iNombre = idx("nombre");
  const iTipo = idx("tipo");
  const iUnidad = idx("unidad");
  const iStockActual = idx("stock_actual");
  const iStockMin = idx("stock_minimo");

  if (iNombre === -1) throw new Error('CSV inválido: falta la columna "nombre".');
  if (iTipo === -1) throw new Error('CSV inválido: falta la columna "tipo".');
  if (iUnidad === -1) throw new Error('CSV inválido: falta la columna "unidad".');
  if (iStockActual === -1) throw new Error('CSV inválido: falta la columna "stock_actual".');
  if (iStockMin === -1) throw new Error('CSV inválido: falta la columna "stock_minimo".');

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitSemiCsvLine(line);
    const get = (i: number) => (cells[i] ?? "").trim();

    const nombre = get(iNombre).trim();
    if (!nombre) continue;

    const tipo = get(iTipo);
    const unidad = get(iUnidad);
    const stock_actual = parseStockNumber(get(iStockActual));
    const stock_minimo = parseStockNumber(get(iStockMin));

    rows.push({
      nombre,
      tipo: tipo.trim(),
      unidad: unidad.trim(),
      stock_actual: Number.isFinite(stock_actual) ? stock_actual : 0,
      stock_minimo: Number.isFinite(stock_minimo) ? stock_minimo : 0
    });
  }
  return rows;
}

/** Si el mismo nombre aparece varias veces, prevalece la última fila del archivo. */
function dedupeRowsLastWins(rows: CsvRow[]): CsvRow[] {
  const out: CsvRow[] = [];
  const seen = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    const k = normalizeNombreClave(r.nombre);
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

  const [csvText, setCsvText] = useState("nombre;tipo;unidad;stock_actual;stock_minimo\n");
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [rowsParsed, setRowsParsed] = useState<CsvRow[]>([]);
  const [productosPorClave, setProductosPorClave] = useState<Map<string, ProductoExistente>>(new Map());
  const [cargandoMapa, setCargandoMapa] = useState(false);
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    try {
      if (!csvText.trim()) {
        setRowsParsed([]);
        setParseErr(null);
        return;
      }
      setRowsParsed(parseProductosCsvStock(csvText));
      setParseErr(null);
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : String(e));
      setRowsParsed([]);
    }
  }, [csvText]);

  const cargarMapaNombres = useCallback(async () => {
    if (!activeEstablishmentId) return;
    setCargandoMapa(true);
    try {
      // Regla estricta: en tu BD la columna clave es ARTICULO (no existe NOMBRE).
      const { data, error } = await supabase()
        .from("productos")
        .select("id,articulo,qr_code_uid")
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;

      const m = new Map<string, ProductoExistente>();
      for (const p of (data as unknown as Array<{ id: string; articulo: string; qr_code_uid: string | null }> | null) ?? []) {
        const key = (p.articulo ?? "").trim();
        if (!key) continue;
        m.set(normalizeNombreClave(key), { id: p.id, qr_code_uid: p.qr_code_uid ?? null });
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
    for (const r of rowsParsed) {
      const k = normalizeNombreClave(r.nombre);
      const ex = productosPorClave.get(k);
      const duplicadaEnCsv =
        rowsParsed.filter((x) => normalizeNombreClave(x.nombre) === k).length > 1;
      vist.push({ ...r, accion: ex ? "actualizar" : "nuevo", idExistente: ex?.id, duplicadaEnCsv });
    }
    const unicas = dedupeRowsLastWins(rowsParsed);
    let nN = 0;
    let nA = 0;
    for (const r of unicas) {
      const k = normalizeNombreClave(r.nombre);
      if (productosPorClave.get(k)) nA++;
      else nN++;
    }
    return { filasVista: vist, nNuevos: nN, nActualizacion: nA, filasUnicasImport: unicas };
  }, [rowsParsed, productosPorClave]);

  const nDuplicadosOmitidos = Math.max(0, rowsParsed.length - filasUnicasImport.length);

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

  function buildPayloadBase(r: CsvRow) {
    return {
      // IMPORTANTÍSIMO: NO enviar nunca "nombre" a la BD. La columna real es "articulo".
      articulo: r.nombre.trim(),
      categoria: r.tipo.trim() ? r.tipo.trim() : null,
      unidad: r.unidad.trim() ? r.unidad.trim() : null,
      // Estúpidamente estricto para evitar: invalid input syntax for type numeric: ""
      stock_actual: r.stock_actual ? Number(r.stock_actual) : 0,
      stock_minimo: r.stock_minimo ? Number(r.stock_minimo) : 0
    };
  }

  async function importar() {
    setErr(null);
    setResult(null);
    setBusy(true);
    try {
      if (parseErr) throw new Error(parseErr);
      if (!rowsParsed.length) throw new Error("No hay filas para importar.");
      if (!activeEstablishmentId) throw new Error("No hay establecimiento activo.");

      const payload = filasUnicasImport.map((r) => {
        const k = normalizeNombreClave(r.nombre);
        const ex = productosPorClave.get(k);
        return {
          ...buildPayloadBase(r),
          proveedor_id: null,
          // Mantener QR estable en updates: si existe, reutilizamos; si no, generamos.
          qr_code_uid: ex?.qr_code_uid ?? crypto.randomUUID().replaceAll("-", ""),
          establecimiento_id: activeEstablishmentId
        };
      });

      const { error } = await supabase()
        .from("productos")
        .upsert(payload, { onConflict: "articulo" });
      if (error) throw error;

      let creados = 0;
      let actualizados = 0;
      for (const r of filasUnicasImport) {
        const k = normalizeNombreClave(r.nombre);
        if (productosPorClave.get(k)) actualizados++;
        else creados++;
      }
      setResult(
        `Importación completada: ${creados} nuevos, ${actualizados} actualizados (clave: artículo).`
      );
      await cargarMapaNombres();
    } catch (e) {
      // Log detallado para depurar errores de Supabase en el navegador
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
        <p className="mb-1 text-sm text-slate-600">
          Cabecera obligatoria:{" "}
          <span className="font-mono font-semibold">nombre;tipo;unidad;stock_actual;stock_minimo</span> (separador{" "}
          <strong>;</strong>).
        </p>
        <p className="mb-4 text-xs text-slate-500">
          Se recortan espacios (<span className="font-mono">trim()</span>) y se convierten stocks a número; si
          vienen vacíos, se usa <strong>0</strong>. Los productos con el <strong>mismo nombre</strong> en este
          establecimiento se <strong>actualizan</strong>; el resto se crean.
        </p>

        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}
        {parseErr ? (
          <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {parseErr}
          </p>
        ) : null}
        {result ? (
          <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {result}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">1) Sube el CSV</p>
            <div
              className={[
                "rounded-3xl border-2 border-dashed p-4 text-center transition",
                drag ? "border-black bg-slate-50" : "border-slate-200 bg-white"
              ].join(" ")}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <p className="text-sm font-semibold text-slate-900">Arrastra el archivo</p>
              <p className="mt-1 text-xs text-slate-600">o elige un archivo</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onPick} />
              <button
                type="button"
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                Elegir archivo
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="green">[{nNuevos}] Productos nuevos</Badge>
                <Badge color="amber">[{nActualizacion}] Productos a actualizar</Badge>
                <Badge color="gray">[{nDuplicadosOmitidos}] Duplicados omitidos en este archivo</Badge>
              </div>
              <Button onClick={importar} disabled={busy || !filasVista.length || !!parseErr}>
                {busy ? "Importando…" : "Confirmar importación"}
              </Button>
              <Button
                onClick={downloadTemplate}
                disabled={busy}
                className="bg-slate-800 hover:bg-slate-900"
              >
                Descargar plantilla
              </Button>
              <button
                type="button"
                className="text-xs font-semibold text-slate-600 underline"
                onClick={() => cargarMapaNombres()}
                disabled={cargandoMapa}
              >
                {cargandoMapa ? "Actualizando productos…" : "Recargar coincidencias"}
              </button>
            </div>
            <p className="text-xs text-slate-600">
              El separador del archivo es <strong>;</strong>. Columnas extra vacías al final (;;;;) se ignoran.
            </p>
          </div>

          <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Leyenda (previsualización)</p>
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-amber-400" aria-hidden />
                <span className="text-slate-800">
                  Fila naranja: <strong>actualización</strong> (se muestra 🔄).
                </span>
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-emerald-400" aria-hidden />
                <span className="text-slate-800">
                  Fila verde: <strong>alta nueva</strong>.
                </span>
              </p>
            </div>
            {filasVista.length > 0 ? (
              <p className="text-xs text-slate-600">
                Resumen: {nNuevos} nuevos, {nActualizacion} actualizaciones, {nDuplicadosOmitidos} duplicados omitidos
                {cargandoMapa ? " (cargando productos actuales…)" : null}.
              </p>
            ) : null}
          </div>
        </div>

        {filasVista.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
            <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
              Previsualización
            </p>
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-white text-[11px] font-bold uppercase tracking-wide text-slate-700">
                  <th className="border-r border-slate-200 px-3 py-2">NOMBRE</th>
                  <th className="border-r border-slate-200 px-3 py-2">TIPO</th>
                  <th className="border-r border-slate-200 px-3 py-2">UNIDAD</th>
                  <th className="border-r border-slate-200 px-3 py-2 text-right">STOCK ACTUAL</th>
                  <th className="px-3 py-2 text-right">STOCK MÍNIMO</th>
                </tr>
              </thead>
              <tbody>
                {filasVista.map((f, i) => (
                  <tr
                    key={i}
                    className={[
                      "border-b border-slate-200",
                      f.accion === "actualizar"
                        ? "bg-amber-50/90 hover:bg-amber-50"
                        : "bg-emerald-50/60 hover:bg-emerald-50/90"
                    ].join(" ")}
                  >
                    <td className="border-r border-slate-200 px-3 py-2 font-semibold text-slate-900">
                      <span className="mr-1 inline-flex items-center gap-1 text-[12px] font-bold">
                        {f.accion === "actualizar" ? (
                          <span className="text-amber-700" title="Se actualizará">
                            🔄
                          </span>
                        ) : (
                          <span className="text-emerald-700" title="Se creará nuevo">
                            ＋
                          </span>
                        )}
                        {f.duplicadaEnCsv ? (
                          <span className="text-slate-500" title="Duplicado en CSV (se importará la última aparición)">
                            ⓘ
                          </span>
                        ) : null}
                      </span>
                      {f.nombre}
                    </td>
                    <td className="border-r border-slate-200 px-3 py-2 text-slate-800">{f.tipo || "—"}</td>
                    <td className="border-r border-slate-200 px-3 py-2 text-slate-800">{f.unidad || "—"}</td>
                    <td className="border-r border-slate-200 px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                      {Number(f.stock_actual || 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                      {Number(f.stock_minimo || 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !parseErr ? (
          <p className="mt-4 text-sm text-slate-600">Añade un CSV o pega abajo el contenido.</p>
        ) : null}

        <details className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">Editar CSV a mano</summary>
          <textarea
            className="mt-3 h-56 w-full rounded-2xl border border-slate-200 bg-white p-3 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={csvText}
            onChange={(e) => setCsvText(e.currentTarget.value)}
            spellCheck={false}
          />
        </details>
      </main>
    </div>
  );
}
