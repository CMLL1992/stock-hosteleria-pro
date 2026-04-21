"use client";

import type { DragEvent, ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";

type CsvRow = {
  nombre: string;
  tipo: string;
  unidad: string;
  proveedor_nombre?: string;
  proveedor_whatsapp?: string;
  stock_actual: string;
  stock_minimo: string;
};

const TIPOS = new Set(["barril", "refresco", "cerveza", "vino", "licor", "agua", "otros"]);
const UNIDADES = new Set(["caja", "barril", "botella", "lata", "unidad"]);

function parseCsv(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  // Producción: columnas mínimas requeridas.
  const required = ["nombre", "tipo", "unidad", "stock_actual", "stock_minimo"];
  for (const k of required) {
    if (idx(k) === -1) throw new Error(`CSV inválido: falta la columna "${k}"`);
  }

  const hasProveedorNombre = idx("proveedor_nombre") !== -1;
  const hasProveedorWhatsapp = idx("proveedor_whatsapp") !== -1;

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.trim());
    const get = (k: string) => cols[idx(k)] ?? "";
    rows.push({
      nombre: get("nombre"),
      tipo: get("tipo").toLowerCase(),
      unidad: get("unidad").toLowerCase(),
      ...(hasProveedorNombre ? { proveedor_nombre: get("proveedor_nombre") } : null),
      ...(hasProveedorWhatsapp ? { proveedor_whatsapp: get("proveedor_whatsapp") } : null),
      stock_actual: get("stock_actual"),
      stock_minimo: get("stock_minimo")
    });
  }
  return rows.filter((r) => r.nombre);
}

function toInt(value: string, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`Valor inválido en ${field}: "${value}"`);
  return n;
}

export default function ImportarCsvPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [csvText, setCsvText] = useState(
    "nombre,tipo,unidad,stock_actual,stock_minimo\n"
  );
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

  const preview = useMemo(() => {
    try {
      return parseCsv(csvText).slice(0, 5);
    } catch {
      return [];
    }
  }, [csvText]);

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

  function normalizeWhatsapp(input: string): string {
    const trimmed = input.trim();
    const hasPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/[^\d]/g, "");
    return (hasPlus ? "+" : "") + digits;
  }

  async function ensureProveedor(nombre: string, whatsapp: string): Promise<string> {
    const trimmed = nombre.trim();
    if (!trimmed) throw new Error("Proveedor vacío en CSV.");
    const tel = whatsapp.trim() ? normalizeWhatsapp(whatsapp) : null;

    const { data: existing, error: selErr } = await supabase()
      .from("proveedores")
      .select("id,nombre,telefono_whatsapp")
      .ilike("nombre", trimmed) /* best-effort */
      .limit(1);
    if (selErr) throw selErr;
    if (existing && existing.length > 0) {
      const row = existing[0] as { id: string; telefono_whatsapp: string | null };
      // Si el proveedor existe pero no tiene WhatsApp y el CSV sí, lo actualizamos.
      if (tel && !row.telefono_whatsapp) {
        await supabase().from("proveedores").update({ telefono_whatsapp: tel }).eq("id", row.id);
      }
      return row.id;
    }

    const { data: inserted, error: insErr } = await supabase()
      .from("proveedores")
      .insert({ nombre: trimmed, telefono_whatsapp: tel })
      .select("id")
      .single();
    if (insErr) throw insErr;
    return (inserted as { id: string }).id;
  }

  function downloadTemplate() {
    const content =
      "nombre,tipo,unidad,stock_actual,stock_minimo\n" +
      "Cerveza Lager,cerveza,barril,5,2\n";
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-productos.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importar() {
    setErr(null);
    setResult(null);
    setBusy(true);
    try {
      const rows = parseCsv(csvText);
      if (!rows.length) throw new Error("CSV vacío.");

      // Cache para no buscar/crear proveedores repetidamente
      const provCache = new Map<string, string>();

      let createdProductos = 0;
      for (const r of rows) {
        if (!TIPOS.has(r.tipo)) throw new Error(`Tipo inválido "${r.tipo}" en producto "${r.nombre}"`);
        if (!UNIDADES.has(r.unidad)) throw new Error(`Unidad inválida "${r.unidad}" en producto "${r.nombre}"`);

        const stock_actual = toInt(r.stock_actual, "stock_actual");
        const stock_minimo = toInt(r.stock_minimo, "stock_minimo");

        // Proveedor opcional (si el CSV trae columnas proveedor_*)
        let proveedor_id: string | null = null;
        const provNombre = (r.proveedor_nombre ?? "").trim();
        if (provNombre) {
          const key = provNombre.toLowerCase();
          proveedor_id = provCache.get(key) ?? null;
          if (!proveedor_id) {
            proveedor_id = await ensureProveedor(provNombre, (r.proveedor_whatsapp ?? "").trim());
            provCache.set(key, proveedor_id);
          }
        }

        const { error } = await supabase().from("productos").insert({
          nombre: r.nombre.trim(),
          tipo: r.tipo,
          unidad: r.unidad,
          proveedor_id,
          stock_actual,
          stock_minimo,
          qr_code_uid: crypto.randomUUID().replaceAll("-", "")
        });
        if (error) throw error;
        createdProductos++;
      }

      setResult(`Importación completada: ${createdProductos} productos creados.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
    <main className="mx-auto max-w-3xl bg-slate-50 p-4 pb-28 text-slate-900">
      <h1 className="mb-2 text-xl font-semibold">Importar CSV</h1>
      <p className="mb-4 text-sm text-slate-600">
        Formato esperado (cabecera obligatoria):{" "}
        <span className="font-mono">
          nombre,tipo,unidad,stock_actual,stock_minimo
        </span>
      </p>

      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      {result ? (
        <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {result}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">1) Sube tu CSV</p>
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
            <p className="text-sm font-semibold text-slate-900">Arrastra aquí el archivo</p>
            <p className="mt-1 text-xs text-slate-600">o pulsa para seleccionarlo</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onPick}
            />
            <button
              type="button"
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              Elegir archivo
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button onClick={importar} disabled={busy}>
              {busy ? "Importando…" : "Importar"}
            </Button>
            <Button onClick={downloadTemplate} disabled={busy} className="bg-slate-800 hover:bg-slate-900">
              Descargar Plantilla Ejemplo
            </Button>
          </div>

          <p className="text-xs text-slate-600">
            Consejo: si tu Excel exporta con “;”, exporta como CSV con comas.
          </p>
        </div>

        <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">2) Vista previa</p>
          {preview.length ? (
            <div className="space-y-2">
              {preview.map((r, i) => (
                <div key={i} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-slate-900">{r.nombre}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {r.tipo} · {r.unidad} · stock {r.stock_actual} · mín {r.stock_minimo}
                  </p>
                </div>
              ))}
              <p className="text-xs text-slate-500">Mostrando {preview.length} filas (máx 5).</p>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Aún no hay filas válidas para previsualizar.</p>
          )}
        </div>
      </div>

      <details className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Editar CSV manualmente</summary>
        <textarea
          className="mt-3 h-64 w-full rounded-2xl border border-slate-200 bg-white p-3 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
          value={csvText}
          onChange={(e) => setCsvText(e.currentTarget.value)}
        />
      </details>

      <p className="mt-4 text-xs text-slate-600">
        Valores permitidos:
        <br />
        tipo ={" "}
        <span className="font-mono">barril, refresco, cerveza, vino, licor, agua, otros</span>
        <br />
        unidad = <span className="font-mono">caja, barril, botella, lata, unidad</span>
      </p>
    </main>
  );
}

