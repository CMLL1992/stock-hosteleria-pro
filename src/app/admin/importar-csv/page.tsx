"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
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
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [csvText, setCsvText] = useState(
    "nombre,tipo,unidad,stock_actual,stock_minimo\n"
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

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

  if (loading) return <main className="p-4 text-sm text-zinc-600 dark:text-zinc-300">Cargando…</main>;
  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Importar CSV (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-2 text-xl font-semibold">Importar CSV</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        Formato esperado (cabecera obligatoria):{" "}
        <span className="font-mono">
          nombre,tipo,unidad,stock_actual,stock_minimo
        </span>
      </p>

      {err ? (
        <p className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </p>
      ) : null}

      {result ? (
        <p className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {result}
        </p>
      ) : null}

      <textarea
        className="h-72 w-full rounded-2xl border border-zinc-200 bg-white p-3 font-mono text-sm dark:border-zinc-800 dark:bg-zinc-950"
        value={csvText}
        onChange={(e) => setCsvText(e.currentTarget.value)}
      />

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button onClick={importar} disabled={busy}>
            {busy ? "Importando…" : "Importar"}
          </Button>
          <Button onClick={downloadTemplate} disabled={busy} className="bg-zinc-700">
            Descargar Plantilla Ejemplo
          </Button>
        </div>
        <div className="text-xs text-zinc-600 dark:text-zinc-300">
          Vista previa: {preview.length ? preview.length : 0} filas
        </div>
      </div>

      <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-300">
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

