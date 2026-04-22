"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { costeNeto, formatEUR, margenBeneficioPct, margenBrutoEUR, ventaNetaSinIva } from "@/lib/finance";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

type ProductoRow = {
  id: string;
  articulo: string;
  categoria?: string | null;
  proveedor_id: string | null;
  precio_tarifa: number | null;
  uds_caja?: number | null;
  descuento_valor: number | null;
  descuento_tipo: "%" | "€" | null;
  rappel_valor?: number | null;
  iva_compra: number | null;
  pvp: number | null;
  iva_venta: number | null;
};

type ProveedorRow = { id: string; nombre: string };

const IVA_OPTIONS = [4, 10, 21] as const;
const DESC_OPTIONS = ["%", "€"] as const;

function normCat(c: string | null | undefined): string {
  const s = String(c ?? "").trim();
  return s || "Otros";
}

const CSV_COLUMNS = [
  "Producto_ID",
  "Nombre",
  "Proveedor",
  "Precio_Tarifa_Caja",
  "Uds_Caja",
  "Descuento",
  "Rappel",
  "IVA",
  "PVP_Botella"
] as const;

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[], columns: readonly string[]): string {
  const head = columns.map(csvEscape).join(",");
  const lines = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(","));
  return [head, ...lines].join("\n");
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    const next = text[i + 1] ?? "";
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      cur.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  cur.push(field);
  rows.push(cur);

  const header = (rows.shift() ?? []).map((h) => h.trim());
  const cleanHeader = header.map((h) => h.replace(/^\uFEFF/, "")); // BOM
  const idx = new Map<string, number>();
  for (let i = 0; i < cleanHeader.length; i++) idx.set(cleanHeader[i] ?? "", i);

  const out: Record<string, string>[] = [];
  for (const r of rows) {
    if (!r.some((x) => String(x ?? "").trim())) continue;
    const obj: Record<string, string> = {};
    for (const h of cleanHeader) {
      if (!h) continue;
      const j = idx.get(h);
      obj[h] = j == null ? "" : String(r[j] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

function sortCats(a: string, b: string): number {
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

function toNum(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function clampNonNeg(x: number): number {
  return x < 0 ? 0 : x;
}

export default function EscandallosPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<ProductoRow[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const { activeEstablishmentId } = useActiveEstablishment();

  // Selector de consulta (evita lista infinita)
  const [verId, setVerId] = useState<string>("");

  // "Nuevo escandallo" (form)
  const [nuevoId, setNuevoId] = useState<string>("");
  const [nuevoProveedorId, setNuevoProveedorId] = useState<string>("");
  const [nuevoPrecioTarifa, setNuevoPrecioTarifa] = useState<string>("0");
  const [nuevoUdsCaja, setNuevoUdsCaja] = useState<string>("0");
  const [nuevoDescuentoValor, setNuevoDescuentoValor] = useState<string>("0");
  const [nuevoDescuentoTipo, setNuevoDescuentoTipo] = useState<"%" | "€">("%");
  const [nuevoRappel, setNuevoRappel] = useState<string>("0");
  const [nuevoIvaCompra, setNuevoIvaCompra] = useState<number>(10);
  const [nuevoPvp, setNuevoPvp] = useState<string>("0");
  const [nuevoIvaVenta, setNuevoIvaVenta] = useState<number>(10);

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
        setErr(supabaseErrToString(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function load() {
    setErr(null);
    if (!activeEstablishmentId) return;
    const col = await resolveProductoTituloColumn(activeEstablishmentId);
    const t = tituloColSql(col);
    const fullSel = `id,${t},categoria,proveedor_id,precio_tarifa,uds_caja,descuento_valor,descuento_tipo,rappel_valor,iva_compra,pvp,iva_venta`;
    const res = await supabase()
      .from("productos")
      .select(fullSel as "*")
      .eq("establecimiento_id", activeEstablishmentId)
      .order(t, { ascending: true });

    if (res.error) {
      const msg = (res.error.message ?? "").toLowerCase();
      const missing =
        msg.includes("precio_tarifa") ||
        msg.includes("descuento_valor") ||
        msg.includes("descuento_tipo") ||
        msg.includes("iva_compra") ||
        msg.includes("pvp") ||
        msg.includes("iva_venta") ||
        msg.includes("uds_caja") ||
        msg.includes("rappel_valor") ||
        msg.includes("could not find") ||
        msg.includes("column");
      if (!missing) throw res.error;
      // Fallback mínimo: SOLO catálogo para que el selector nunca quede vacío
      const fb = await supabase()
        .from("productos")
        .select(`id,${t},categoria,proveedor_id` as "*")
        .eq("establecimiento_id", activeEstablishmentId)
        .order(t, { ascending: true });
      if (fb.error) throw fb.error;
      setItems(
        ((fb.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
          id: String(r.id ?? ""),
          articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
          categoria: r.categoria != null ? String(r.categoria) : null,
          proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null,
          precio_tarifa: 0,
          uds_caja: 0,
          descuento_valor: 0,
          descuento_tipo: "%",
          rappel_valor: 0,
          iva_compra: 10,
          pvp: 0,
          iva_venta: 10
        }))
      );
      return;
    }

    setItems(
      ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
        id: String(r.id ?? ""),
        articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
        categoria: r.categoria != null ? String(r.categoria) : null,
        proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null,
        precio_tarifa: r.precio_tarifa != null ? Number(r.precio_tarifa) : null,
        uds_caja: r.uds_caja != null ? Number(r.uds_caja) : null,
        descuento_valor: r.descuento_valor != null ? Number(r.descuento_valor) : null,
        descuento_tipo: (r.descuento_tipo as ProductoRow["descuento_tipo"]) ?? null,
        rappel_valor: r.rappel_valor != null ? Number(r.rappel_valor) : null,
        iva_compra: r.iva_compra != null ? Number(r.iva_compra) : null,
        pvp: r.pvp != null ? Number(r.pvp) : null,
        iva_venta: r.iva_venta != null ? Number(r.iva_venta) : null
      }))
    );
  }

  useEffect(() => {
    if (role !== "admin" && role !== "superadmin") return;
    if (!activeEstablishmentId) return;
    load().catch((e) => setErr(supabaseErrToString(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEstablishmentId, role]);

  useEffect(() => {
    if (role !== "admin" && role !== "superadmin") return;
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await supabase()
          .from("proveedores")
          .select("id,nombre")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("nombre", { ascending: true });
        if (res.error) throw res.error;
        if (!cancelled) setProveedores((res.data as ProveedorRow[]) ?? []);
      } catch (e) {
        if (!cancelled) setErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, role]);

  async function saveRow(p: ProductoRow) {
    setErr(null);
    setSaved(false);
    setSaving(p.id);
    try {
      if (!activeEstablishmentId) throw new Error("No hay establecimiento activo.");
      const payload = {
        proveedor_id: p.proveedor_id,
        precio_tarifa: clampNonNeg(Number(p.precio_tarifa ?? 0)),
        uds_caja: clampNonNeg(Number(p.uds_caja ?? 0)),
        descuento_valor: clampNonNeg(Number(p.descuento_valor ?? 0)),
        descuento_tipo: (p.descuento_tipo ?? "%") as "%" | "€",
        rappel_valor: clampNonNeg(Number(p.rappel_valor ?? 0)),
        iva_compra: Number(p.iva_compra ?? 10),
        pvp: clampNonNeg(Number(p.pvp ?? 0)),
        iva_venta: Number(p.iva_venta ?? 10)
      };
      const res = await supabase()
        .from("productos")
        .update(payload)
        .eq("id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (!res.error) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
        return;
      }
      // Compat: si faltan columnas nuevas en BD, reintentamos sin ellas.
      const msg = (res.error.message ?? "").toLowerCase();
      const missing = msg.includes("uds_caja") || msg.includes("rappel_valor");
      if (!missing) throw res.error;
      const { error: fbErr } = await supabase()
        .from("productos")
        .update({
          proveedor_id: p.proveedor_id,
          precio_tarifa: clampNonNeg(Number(p.precio_tarifa ?? 0)),
          descuento_valor: clampNonNeg(Number(p.descuento_valor ?? 0)),
          descuento_tipo: (p.descuento_tipo ?? "%") as "%" | "€",
          iva_compra: Number(p.iva_compra ?? 10),
          pvp: clampNonNeg(Number(p.pvp ?? 0)),
          iva_venta: Number(p.iva_venta ?? 10)
        })
        .eq("id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (fbErr) throw fbErr;
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } finally {
      setSaving(null);
    }
  }

  async function guardarNuevo() {
    if (!activeEstablishmentId) return;
    if (!nuevoId) return;
    setErr(null);
    setSaving(nuevoId);
    try {
      const payload = {
        proveedor_id: nuevoProveedorId || null,
        precio_tarifa: clampNonNeg(toNum(nuevoPrecioTarifa)),
        uds_caja: clampNonNeg(Math.trunc(toNum(nuevoUdsCaja))),
        descuento_valor: clampNonNeg(toNum(nuevoDescuentoValor)),
        descuento_tipo: nuevoDescuentoTipo,
        rappel_valor: clampNonNeg(toNum(nuevoRappel)),
        iva_compra: Number(nuevoIvaCompra),
        pvp: clampNonNeg(toNum(nuevoPvp)),
        iva_venta: Number(nuevoIvaVenta)
      };
      const res = await supabase().from("productos").update(payload).eq("id", nuevoId).eq("establecimiento_id", activeEstablishmentId);
      if (!res.error) {
        await load();
        setSaved(true);
        setTimeout(() => setSaved(false), 1200);
        return;
      }
      const msg = (res.error.message ?? "").toLowerCase();
      const missing = msg.includes("uds_caja") || msg.includes("rappel_valor");
      if (!missing) throw res.error;
      const { error: fbErr } = await supabase()
        .from("productos")
        .update({
          proveedor_id: nuevoProveedorId || null,
          precio_tarifa: clampNonNeg(toNum(nuevoPrecioTarifa)),
          descuento_valor: clampNonNeg(toNum(nuevoDescuentoValor)),
          descuento_tipo: nuevoDescuentoTipo,
          iva_compra: Number(nuevoIvaCompra),
          pvp: clampNonNeg(toNum(nuevoPvp)),
          iva_venta: Number(nuevoIvaVenta)
        })
        .eq("id", nuevoId)
        .eq("establecimiento_id", activeEstablishmentId);
      if (fbErr) throw fbErr;
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(null);
    }
  }

  const rows = useMemo(() => {
    return items.map((p) => {
      const cn = costeNeto(p);
      const vn = ventaNetaSinIva(p);
      const mb = margenBrutoEUR(p);
      const mp = margenBeneficioPct(p);
      const healthy = mp >= 60;
      return { p, cn, vn, mb, mp, healthy };
    });
  }, [items]);

  const verRow = useMemo(() => {
    if (!verId) return null;
    return rows.find((r) => r.p.id === verId) ?? null;
  }, [rows, verId]);

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (role !== "admin" && role !== "superadmin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Escandallos (Admin)</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Escandallos" showBack backHref="/admin" />
      <main className="mx-auto max-w-5xl bg-slate-50 p-4 pb-28 text-slate-900">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Escandallos</h1>
          <p className="text-sm text-slate-600">Edita precios y márgenes por producto (vista tarjetas).</p>
        </div>
        <div className="flex items-center gap-2">
          {saved ? <span className="text-sm font-semibold text-emerald-700">Guardado ✓</span> : null}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              if (!activeEstablishmentId) {
                setErr("No hay establecimiento activo.");
                return;
              }
              setErr(null);
              setImporting(true);
              const reader = new FileReader();
              reader.onload = async () => {
                try {
                  const text = String(reader.result ?? "");
                  const parsed = parseCsv(text);
                  if (parsed.length === 0) throw new Error("El CSV está vacío.");

                  const provByName = new Map<string, string>();
                  for (const pr of proveedores) provByName.set(pr.nombre.trim().toLowerCase(), pr.id);

                  const updates: {
                    id: string;
                    establecimiento_id: string;
                    proveedor_id?: string | null;
                    precio_tarifa?: number;
                    uds_caja?: number;
                    descuento_valor?: number;
                    descuento_tipo?: "%" | "€";
                    rappel_valor?: number;
                    iva_compra?: number;
                    pvp?: number;
                  }[] = [];

                  for (const row of parsed) {
                    const id = (row.Producto_ID ?? "").trim();
                    if (!id) continue;
                    const current = items.find((x) => x.id === id) ?? null;

                    const proveedorNombre = (row.Proveedor ?? "").trim();
                    const provId =
                      !proveedorNombre
                        ? null
                        : provByName.get(proveedorNombre.toLowerCase()) ?? current?.proveedor_id ?? null;

                    const descRaw = String(row.Descuento ?? "").trim();
                    const descNum = descRaw ? toNum(descRaw.replace("%", "").replace("€", "").trim()) : 0;
                    const descTipo: "%" | "€" =
                      descRaw.includes("€") ? "€" : descRaw.includes("%") ? "%" : ((current?.descuento_tipo ?? "%") as "%" | "€");

                    const precioTarifa = toNum(String(row.Precio_Tarifa_Caja ?? ""));
                    const udsCaja = Math.trunc(toNum(String(row.Uds_Caja ?? "")));
                    const rappel = toNum(String(row.Rappel ?? ""));
                    const iva = Math.trunc(toNum(String(row.IVA ?? ""))) || 10;
                    const pvp = toNum(String(row.PVP_Botella ?? ""));

                    updates.push({
                      id,
                      establecimiento_id: activeEstablishmentId,
                      proveedor_id: provId,
                      precio_tarifa: clampNonNeg(precioTarifa),
                      uds_caja: clampNonNeg(udsCaja),
                      descuento_valor: clampNonNeg(descNum),
                      descuento_tipo: descTipo,
                      rappel_valor: clampNonNeg(rappel),
                      iva_compra: iva,
                      pvp: clampNonNeg(pvp)
                    });
                  }

                  if (updates.length === 0) throw new Error("No hay filas válidas (asegúrate de que exista la columna Producto_ID).");

                  const chunkSize = 75;
                  for (let i = 0; i < updates.length; i += chunkSize) {
                    const chunk = updates.slice(i, i + chunkSize);
                    const { error } = await supabase().from("productos").upsert(chunk, { onConflict: "id" });
                    if (error) throw error;
                  }

                  await load();
                  setSaved(true);
                  setTimeout(() => setSaved(false), 1200);
                } catch (e) {
                  setErr(supabaseErrToString(e));
                } finally {
                  setImporting(false);
                }
              };
              reader.onerror = () => {
                setErr("No se pudo leer el archivo CSV.");
                setImporting(false);
              };
              reader.readAsText(file);
            }}
            aria-label="Importar escandallos CSV"
          />
          <Button
            type="button"
            className="min-h-11"
            onClick={() => {
              if (!items.length) return;
              const rowsOut = items.map((p) => ({
                Producto_ID: p.id,
                Nombre: p.articulo,
                Proveedor:
                  (p.proveedor_id ? proveedores.find((x) => x.id === p.proveedor_id)?.nombre : "") ?? "",
                Precio_Tarifa_Caja: String(p.precio_tarifa ?? 0),
                Uds_Caja: String(p.uds_caja ?? 0),
                Descuento: String(p.descuento_valor ?? 0),
                Rappel: String(p.rappel_valor ?? 0),
                IVA: String(p.iva_compra ?? 10),
                PVP_Botella: String(p.pvp ?? 0)
              }));
              const csv = toCsv(rowsOut, CSV_COLUMNS);
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "plantilla-escandallos.csv";
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }}
            disabled={!items.length || importing}
          >
            Descargar Plantilla CSV
          </Button>
          <Button
            type="button"
            className="min-h-11"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? "Importando…" : "Importar Escandallos CSV"}
          </Button>
        </div>
      </div>

      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      ) : null}

      {/* Nuevo Escandallo (UX guiada) */}
      <section className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-base font-bold text-slate-900">Nuevo escandallo</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Producto
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoId}
              onChange={(e) => {
                const id = e.currentTarget.value;
                setNuevoId(id);
                const p = items.find((x) => x.id === id);
                if (p) {
                  setNuevoProveedorId(p.proveedor_id ?? "");
                  setNuevoPrecioTarifa(String(p.precio_tarifa ?? 0));
                  setNuevoUdsCaja(String(p.uds_caja ?? 0));
                  setNuevoDescuentoValor(String(p.descuento_valor ?? 0));
                  setNuevoDescuentoTipo((p.descuento_tipo ?? "%") as "%" | "€");
                  setNuevoRappel(String(p.rappel_valor ?? 0));
                  setNuevoIvaCompra(Number(p.iva_compra ?? 10));
                  setNuevoPvp(String(p.pvp ?? 0));
                  setNuevoIvaVenta(Number(p.iva_venta ?? 10));
                }
              }}
              aria-label="Producto"
            >
              <option value="">(Selecciona…)</option>
              {Array.from(
                items.reduce((m, p) => {
                  const c = normCat(p.categoria);
                  m.set(c, [...(m.get(c) ?? []), p]);
                  return m;
                }, new Map<string, ProductoRow[]>())
              )
                .sort(([a], [b]) => sortCats(a, b))
                .map(([cat, prods]) => (
                  <optgroup key={cat} label={cat}>
                    {prods
                      .slice()
                      .sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.articulo}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Proveedor
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoProveedorId}
              onChange={(e) => setNuevoProveedorId(e.currentTarget.value)}
              aria-label="Proveedor"
            >
              <option value="">(Sin proveedor)</option>
              {proveedores.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Precio tarifa / caja
            <div className="relative">
              <input
                className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                inputMode="decimal"
                value={nuevoPrecioTarifa}
                onChange={(e) => setNuevoPrecioTarifa(e.currentTarget.value)}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">€</span>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Uds / caja
            <input
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              inputMode="numeric"
              value={nuevoUdsCaja}
              onChange={(e) => setNuevoUdsCaja(e.currentTarget.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Descuento
            <div className="relative">
              <input
                className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                inputMode="decimal"
                value={nuevoDescuentoValor}
                onChange={(e) => setNuevoDescuentoValor(e.currentTarget.value)}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                {nuevoDescuentoTipo}
              </span>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Tipo descuento
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoDescuentoTipo}
              onChange={(e) => setNuevoDescuentoTipo(e.currentTarget.value as "%" | "€")}
            >
              {DESC_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Rappel
            <div className="relative">
              <input
                className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                inputMode="decimal"
                value={nuevoRappel}
                onChange={(e) => setNuevoRappel(e.currentTarget.value)}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">€</span>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            IVA (compra)
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoIvaCompra}
              onChange={(e) => setNuevoIvaCompra(Number(e.currentTarget.value))}
            >
              {IVA_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}%
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            PVP por botella
            <div className="relative">
              <input
                className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                inputMode="decimal"
                value={nuevoPvp}
                onChange={(e) => setNuevoPvp(e.currentTarget.value)}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">€</span>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            IVA (venta)
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoIvaVenta}
              onChange={(e) => setNuevoIvaVenta(Number(e.currentTarget.value))}
            >
              {IVA_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}%
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <Button onClick={() => void guardarNuevo()} disabled={!nuevoId || saving === nuevoId} className="min-h-11 w-full sm:w-auto">
            {saving === nuevoId ? "Guardando…" : "Guardar escandallo"}
          </Button>
        </div>
      </section>

      {/* Consulta (desplegable por familias) */}
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <h2 className="text-base font-bold text-slate-900">Consultar escandallo</h2>
        <p className="mt-1 text-sm text-slate-600">Selecciona un producto para ver su ficha.</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Producto
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={verId}
              onChange={(e) => setVerId(e.currentTarget.value)}
              aria-label="Consultar producto"
            >
              <option value="">(Selecciona…)</option>
              {Array.from(
                items.reduce((m, p) => {
                  const c = normCat(p.categoria);
                  m.set(c, [...(m.get(c) ?? []), p]);
                  return m;
                }, new Map<string, ProductoRow[]>())
              )
                .sort(([a], [b]) => sortCats(a, b))
                .map(([cat, prods]) => (
                  <optgroup key={cat} label={cat}>
                    {prods
                      .slice()
                      .sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.articulo}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </select>
          </label>
        </div>

        {verRow ? (
          <article className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <h3 className="text-base font-bold leading-snug text-slate-900">{verRow.p.articulo}</h3>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Tarifa
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={String(verRow.p.precio_tarifa ?? 0)}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) => (x.id === verRow.p.id ? { ...x, precio_tarifa: toNum(e.currentTarget.value) } : x))
                    )
                  }
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Descuento
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={String(verRow.p.descuento_valor ?? 0)}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) => (x.id === verRow.p.id ? { ...x, descuento_valor: toNum(e.currentTarget.value) } : x))
                    )
                  }
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Tipo desc.
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={(verRow.p.descuento_tipo ?? "%") as "%" | "€"}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) =>
                        x.id === verRow.p.id ? { ...x, descuento_tipo: e.currentTarget.value as "%" | "€" } : x
                      )
                    )
                  }
                >
                  {DESC_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                IVA compra
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={Number(verRow.p.iva_compra ?? 10)}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) => (x.id === verRow.p.id ? { ...x, iva_compra: Number(e.currentTarget.value) } : x))
                    )
                  }
                >
                  {IVA_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                PVP
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  inputMode="decimal"
                  value={String(verRow.p.pvp ?? 0)}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x) => (x.id === verRow.p.id ? { ...x, pvp: toNum(e.currentTarget.value) } : x)))
                  }
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                IVA venta
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={Number(verRow.p.iva_venta ?? 10)}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x) => (x.id === verRow.p.id ? { ...x, iva_venta: Number(e.currentTarget.value) } : x))
                    )
                  }
                >
                  {IVA_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold text-slate-500">Coste neto</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatEUR(verRow.cn)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold text-slate-500">Venta neta</dt>
                <dd className="tabular-nums text-slate-800">{formatEUR(verRow.vn)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold text-slate-500">Margen €</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatEUR(verRow.mb)}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-xs font-semibold text-slate-500">Margen %</dt>
                <dd>
                  <span
                    className={[
                      "inline-flex min-h-8 items-center rounded-full px-2.5 text-xs font-semibold tabular-nums ring-1",
                      verRow.healthy ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-red-50 text-red-800 ring-red-100"
                    ].join(" ")}
                  >
                    {verRow.mp.toFixed(2)}%
                  </span>
                </dd>
              </div>
            </dl>

            <div className="mt-4">
              <Button onClick={() => saveRow(verRow.p)} disabled={saving === verRow.p.id} className="min-h-11 w-full sm:w-auto">
                {saving === verRow.p.id ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </article>
        ) : (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Selecciona un producto para ver sus importes y márgenes.
          </p>
        )}
      </section>
      </main>
    </div>
  );
}

