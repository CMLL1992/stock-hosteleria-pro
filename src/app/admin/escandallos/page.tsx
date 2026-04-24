"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { hasPermission, getEffectiveRole } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { costeNeto, formatEUR, margenBeneficioPct, margenBrutoEUR, ventaNetaSinIva } from "@/lib/finance";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useCambiosGlobalesRealtime } from "@/lib/useCambiosGlobalesRealtime";
import { useMyRole } from "@/lib/useMyRole";
import { fetchEscandallosFinanceMapByProductIds } from "@/lib/fetchEscandallosPrecioMap";
import { logActivity } from "@/lib/activityLog";

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

type EscandalloRow = {
  producto_id: string;
  establecimiento_id: string;
  precio_tarifa: number;
  uds_caja: number;
  descuento_valor: number;
  descuento_tipo: "%" | "€";
  rappel_valor: number;
  iva_compra: number;
  pvp: number;
  iva_venta: number;
};

function isMissingEscandallosTable(e: unknown): boolean {
  const anyErr = e as { code?: unknown; message?: unknown };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  return (
    code === "PGRST205" ||
    /could not find the table/i.test(msg) ||
    /public\.escandallos/i.test(msg) ||
    /escandallos/i.test(msg)
  );
}

type ProveedorRow = { id: string; nombre: string };

const IVA_OPTIONS = [4, 10, 21] as const;
const DESC_OPTIONS = ["%", "€"] as const;

function normalizeIva(v: number): (typeof IVA_OPTIONS)[number] {
  const n = Math.trunc(Number(v));
  if (n === 4 || n === 10 || n === 21) return n;
  return 10;
}

function normalizeDescTipo(v: unknown): "%" | "€" {
  return String(v ?? "%") === "€" ? "€" : "%";
}

function supabaseErrorDetail(e: unknown): string {
  if (!e || typeof e !== "object") return "";
  const anyErr = e as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const parts: string[] = [];
  if (typeof anyErr.code === "string" && anyErr.code.trim()) parts.push(`code=${anyErr.code}`);
  if (typeof anyErr.details === "string" && anyErr.details.trim()) parts.push(`details=${anyErr.details}`);
  if (typeof anyErr.hint === "string" && anyErr.hint.trim()) parts.push(`hint=${anyErr.hint}`);
  // Ojo: message ya lo da supabaseErrToString; aquí añadimos el “extra” útil.
  return parts.length ? parts.join(" | ") : "";
}

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

function detectCsvDelimiter(text: string): "," | ";" {
  const firstLine = String(text ?? "").split(/\r?\n/, 1)[0] ?? "";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

function parseCsv(text: string): Record<string, string>[] {
  const delim = detectCsvDelimiter(text);
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
    if (ch === delim) {
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
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canSeeFinance = hasPermission(role, "admin");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<ProductoRow[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const { activeEstablishmentId } = useActiveEstablishment();

  // Selector de consulta (evita lista infinita)
  const [verId, setVerId] = useState<string>("");
  // Edición (misma filosofía que "Nuevo": estado string mientras se teclea)
  const [editProveedorId, setEditProveedorId] = useState<string>("");
  const [editPrecioTarifa, setEditPrecioTarifa] = useState<string>("0");
  const [editUdsCaja, setEditUdsCaja] = useState<string>("1");
  const [editDescuentoValor, setEditDescuentoValor] = useState<string>("0");
  const [editDescuentoTipo, setEditDescuentoTipo] = useState<"%" | "€">("%");
  const [editRappel, setEditRappel] = useState<string>("0");
  const [editIvaCompra, setEditIvaCompra] = useState<string>("10");
  const [editPvp, setEditPvp] = useState<string>("0");
  const [editIvaVenta, setEditIvaVenta] = useState<string>("10");

  // "Nuevo escandallo" (form)
  const [nuevoId, setNuevoId] = useState<string>("");
  const [nuevoProveedorId, setNuevoProveedorId] = useState<string>("");
  const [nuevoPrecioTarifa, setNuevoPrecioTarifa] = useState<string>("0");
  const [nuevoUdsCaja, setNuevoUdsCaja] = useState<string>("0");
  const [nuevoDescuentoValor, setNuevoDescuentoValor] = useState<string>("0");
  const [nuevoDescuentoTipo, setNuevoDescuentoTipo] = useState<"%" | "€">("%");
  const [nuevoRappel, setNuevoRappel] = useState<string>("0");
  const [nuevoIvaCompra, setNuevoIvaCompra] = useState<string>("10");
  const [nuevoPvp, setNuevoPvp] = useState<string>("0");
  const [nuevoIvaVenta, setNuevoIvaVenta] = useState<string>("10");

  function readEvtValue(e: { currentTarget?: { value?: unknown } } | null | undefined): string {
    try {
      const v = e?.currentTarget?.value;
      return typeof v === "string" ? v : String(v ?? "");
    } catch {
      return "";
    }
  }

  async function load() {
    setErr(null);
    if (!activeEstablishmentId) return;
    const col = await resolveProductoTituloColumn(activeEstablishmentId);
    const t = tituloColSql(col);
    // Intento preferente: tabla escandallos (admin-only).
    try {
      const baseSel = `id,${t},categoria,proveedor_id`;
      const resProd = await supabase()
        .from("productos")
        .select(baseSel as "*")
        .eq("establecimiento_id", activeEstablishmentId)
        .order(t, { ascending: true });
      if (resProd.error) throw resProd.error;

      const prodRows = ((resProd.data ?? []) as unknown as Record<string, unknown>[]) ?? [];
      const prodIds = prodRows.map((r) => String(r.id ?? "").trim()).filter(Boolean);

      const escFinMap = await fetchEscandallosFinanceMapByProductIds(prodIds);

      const escByProd = new Map<string, EscandalloRow>();
      for (const pid of prodIds) {
        const fin = escFinMap.get(pid) ?? null;
        if (!fin) continue;
        escByProd.set(pid, {
          producto_id: pid,
          establecimiento_id: String(fin.establecimiento_id || activeEstablishmentId),
          precio_tarifa: fin.precio_tarifa,
          uds_caja: fin.uds_caja,
          descuento_valor: fin.descuento_valor,
          descuento_tipo: normalizeDescTipo(fin.descuento_tipo),
          rappel_valor: fin.rappel_valor,
          iva_compra: normalizeIva(fin.iva_compra),
          pvp: fin.pvp,
          iva_venta: normalizeIva(fin.iva_venta)
        });
      }

      setItems(
        ((resProd.data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
          const id = String(r.id ?? "");
          const esc = escByProd.get(id) ?? null;
          return {
            id,
            articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
            categoria: r.categoria != null ? String(r.categoria) : null,
            proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null,
            precio_tarifa: esc?.precio_tarifa ?? 0,
            uds_caja: esc?.uds_caja ?? 1,
            descuento_valor: esc?.descuento_valor ?? 0,
            descuento_tipo: normalizeDescTipo(esc?.descuento_tipo),
            rappel_valor: esc?.rappel_valor ?? 0,
            iva_compra: normalizeIva(esc?.iva_compra ?? 10),
            pvp: esc?.pvp ?? 0,
            iva_venta: normalizeIva(esc?.iva_venta ?? 10)
          };
        })
      );
      return;
    } catch (e) {
      if (!isMissingEscandallosTable(e)) throw e;
      // Fallback temporal: mientras no exista 'escandallos' en la BD, leemos finanzas desde 'productos'.
      const legacySel = `id,${t},categoria,proveedor_id,precio_tarifa,uds_caja,descuento_valor,descuento_tipo,rappel_valor,iva_compra,pvp,iva_venta`;
      const res = await supabase()
        .from("productos")
        .select(legacySel as "*")
        .eq("establecimiento_id", activeEstablishmentId)
        .order(t, { ascending: true });
      if (res.error) throw res.error;
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
      setErr("Aviso: falta la tabla 'escandallos' en Supabase. Ejecuta el patch SQL para activar el hardening de seguridad.");
    }
  }

  useEffect(() => {
    if (!canSeeFinance) return;
    if (!activeEstablishmentId) return;
    load().catch((e) => setErr(supabaseErrToString(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEstablishmentId, canSeeFinance]);

  // Realtime: si otro admin/superadmin toca escandallos en este establecimiento, recarga.
  useCambiosGlobalesRealtime({
    establecimientoId: activeEstablishmentId,
    tables: ["productos", "escandallos"],
    onChange: () => {
      if (!canSeeFinance) return;
      void load();
    }
  });

  useEffect(() => {
    if (!canSeeFinance) return;
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
  }, [activeEstablishmentId, canSeeFinance]);

  async function saveRow(p: ProductoRow) {
    setErr(null);
    setSaved(false);
    setSaving(p.id);
    try {
      if (!activeEstablishmentId) throw new Error("No hay establecimiento activo.");
      const { error: prodErr } = await supabase()
        .from("productos")
        .update({ proveedor_id: p.proveedor_id })
        .eq("id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (prodErr) throw prodErr;

      const esc: EscandalloRow = {
        producto_id: p.id,
        establecimiento_id: activeEstablishmentId,
        precio_tarifa: clampNonNeg(Number(p.precio_tarifa ?? 0)),
        uds_caja: Math.max(1, Math.trunc(clampNonNeg(Number(p.uds_caja ?? 1)))),
        descuento_valor: clampNonNeg(Number(p.descuento_valor ?? 0)),
        descuento_tipo: normalizeDescTipo(p.descuento_tipo),
        rappel_valor: clampNonNeg(Number(p.rappel_valor ?? 0)),
        iva_compra: normalizeIva(Number(p.iva_compra ?? 10)),
        pvp: clampNonNeg(Number(p.pvp ?? 0)),
        iva_venta: normalizeIva(Number(p.iva_venta ?? 10))
      };
      const { error: escErr } = await supabase().from("escandallos").upsert(esc, { onConflict: "producto_id" });
      if (escErr) throw escErr;

      await logActivity({
        establecimientoId: activeEstablishmentId,
        icon: "price",
        message: `Escandallo actualizado: ${p.articulo}.`,
        metadata: { producto_id: p.id }
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch (e) {
      // Log detallado para diagnóstico (column/constraint suele venir en details/hint).
      // eslint-disable-next-line no-console
      console.error("[escandallos.saveRow] error", e, { producto_id: p.id, establecimiento_id: activeEstablishmentId });
      const base = supabaseErrToString(e);
      const extra = supabaseErrorDetail(e);
      setErr(extra ? `${base} | ${extra}` : base);
    } finally {
      setSaving(null);
    }
  }

  async function saveEdit() {
    setErr(null);
    setSaved(false);
    if (!activeEstablishmentId) {
      setErr("No hay establecimiento activo.");
      return;
    }
    if (!verId) return;
    const base = items.find((x) => x.id === verId) ?? null;
    if (!base) return;

    const next: ProductoRow = {
      ...base,
      proveedor_id: editProveedorId || null,
      precio_tarifa: clampNonNeg(toNum(editPrecioTarifa)),
      uds_caja: Math.max(1, Math.trunc(clampNonNeg(toNum(editUdsCaja)))),
      descuento_valor: clampNonNeg(toNum(editDescuentoValor)),
      descuento_tipo: editDescuentoTipo,
      rappel_valor: clampNonNeg(toNum(editRappel)),
      iva_compra: normalizeIva(toNum(editIvaCompra)),
      pvp: clampNonNeg(toNum(editPvp)),
      iva_venta: normalizeIva(toNum(editIvaVenta))
    };

    await saveRow(next);

    // Refleja inmediatamente lo guardado (sin esperar recarga completa)
    setItems((prev) => prev.map((x) => (x.id === verId ? { ...x, ...next } : x)));
  }

  async function guardarNuevo() {
    if (!activeEstablishmentId) return;
    if (!nuevoId) return;
    setErr(null);
    setSaving(nuevoId);
    try {
      const { error: prodErr } = await supabase()
        .from("productos")
        .update({ proveedor_id: nuevoProveedorId || null })
        .eq("id", nuevoId)
        .eq("establecimiento_id", activeEstablishmentId);
      if (prodErr) throw prodErr;

      const esc: EscandalloRow = {
        producto_id: nuevoId,
        establecimiento_id: activeEstablishmentId,
        precio_tarifa: clampNonNeg(toNum(nuevoPrecioTarifa)),
        uds_caja: Math.max(1, Math.trunc(clampNonNeg(toNum(nuevoUdsCaja)))),
        descuento_valor: clampNonNeg(toNum(nuevoDescuentoValor)),
        descuento_tipo: normalizeDescTipo(nuevoDescuentoTipo),
        rappel_valor: clampNonNeg(toNum(nuevoRappel)),
        iva_compra: normalizeIva(Number(nuevoIvaCompra)),
        pvp: clampNonNeg(toNum(nuevoPvp)),
        iva_venta: normalizeIva(Number(nuevoIvaVenta))
      };
      const { error: escErr } = await supabase().from("escandallos").upsert(esc, { onConflict: "producto_id" });
      if (escErr) throw escErr;

      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[escandallos.guardarNuevo] error", e, { producto_id: nuevoId, establecimiento_id: activeEstablishmentId });
      const base = supabaseErrToString(e);
      const extra = supabaseErrorDetail(e);
      setErr(extra ? `${base} | ${extra}` : base);
    } finally {
      setSaving(null);
    }
  }

  async function borrarEscandalloActual() {
    if (!activeEstablishmentId || !verId) return;
    const row = items.find((x) => x.id === verId) ?? null;
    const nombre = row?.articulo?.trim() || "este escandallo";
    const ok = window.confirm(`¿Estás seguro de que quieres eliminar este escandallo?\n\n${nombre}`);
    if (!ok) return;
    setErr(null);
    setSaved(false);
    setSaving(verId);
    try {
      const { error } = await supabase()
        .from("escandallos")
        .delete()
        .eq("producto_id", verId)
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      setOk("Escandallo eliminado.");
      window.setTimeout(() => setOk(null), 1600);
      setVerId("");
      await load();
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

  useEffect(() => {
    if (!verRow) return;
    // Al cambiar de producto, cargamos en el formulario de edición (sin saneamientos durante tecleo).
    setEditProveedorId(verRow.p.proveedor_id ?? "");
    setEditPrecioTarifa(String(verRow.p.precio_tarifa ?? 0));
    setEditUdsCaja(String(verRow.p.uds_caja ?? 1));
    setEditDescuentoValor(String(verRow.p.descuento_valor ?? 0));
    setEditDescuentoTipo((verRow.p.descuento_tipo ?? "%") as "%" | "€");
    setEditRappel(String(verRow.p.rappel_valor ?? 0));
    setEditIvaCompra(String(verRow.p.iva_compra ?? 10));
    setEditPvp(String(verRow.p.pvp ?? 0));
    setEditIvaVenta(String(verRow.p.iva_venta ?? 10));
  }, [verId, verRow?.p.id]);

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canSeeFinance) {
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
      <main className="mx-auto max-w-5xl bg-slate-50 px-4 pb-28 pt-4 text-slate-900 sm:px-5">
      <div className="mb-4 flex flex-col gap-4 sm:mb-3 lg:flex-row lg:items-end lg:justify-between lg:gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Escandallos</h1>
          <p className="text-sm text-slate-600">Edita precios y márgenes por producto (vista tarjetas).</p>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {saved ? (
            <span className="text-center text-sm font-semibold text-emerald-700 sm:text-left">Guardado ✓</span>
          ) : null}
          <Link
            href="/admin/escandallos/nuevo"
            className="order-first inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-2xl bg-black px-4 text-sm font-semibold text-white shadow-md ring-2 ring-black/15 ring-offset-2 ring-offset-slate-50 hover:bg-slate-900 sm:order-none sm:w-auto"
          >
            <span className="sm:hidden">Nuevo · Cocina</span>
            <span className="hidden sm:inline">Nuevo (Cocina)</span>
          </Link>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-1 sm:justify-end sm:gap-2">
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

                  const escUpdates: EscandalloRow[] = [];

                  for (const row of parsed) {
                    const id = (row.Producto_ID ?? "").trim();
                    if (!id) continue;
                    const current = items.find((x) => x.id === id) ?? null;

                    // Nota: Proveedor en CSV se valida pero no se persiste aquí (ver comentario sobre `productos`).
                    const proveedorNombre = (row.Proveedor ?? "").trim();
                    void proveedorNombre;

                    const descRaw = String(row.Descuento ?? "").trim();
                    const descNum = descRaw ? toNum(descRaw.replace("%", "").replace("€", "").trim()) : 0;
                    const descTipo: "%" | "€" =
                      descRaw.includes("€") ? "€" : descRaw.includes("%") ? "%" : ((current?.descuento_tipo ?? "%") as "%" | "€");

                    const precioTarifa = toNum(String(row.Precio_Tarifa_Caja ?? ""));
                    const udsCaja = Math.trunc(toNum(String(row.Uds_Caja ?? "")));
                    const rappel = toNum(String(row.Rappel ?? ""));
                    const iva = normalizeIva(toNum(String(row.IVA ?? "")));
                    const pvp = toNum(String(row.PVP_Botella ?? ""));

                    // Importante: NO tocamos `productos` en importación masiva.
                    // Hacer upsert ahí puede intentar INSERT de nuevos IDs y romper por constraints (nombre/qr_code_uid/etc.).
                    escUpdates.push({
                      producto_id: id,
                      establecimiento_id: activeEstablishmentId,
                      precio_tarifa: clampNonNeg(precioTarifa),
                      uds_caja: Math.max(1, Math.trunc(clampNonNeg(udsCaja))),
                      descuento_valor: clampNonNeg(descNum),
                      descuento_tipo: descTipo,
                      rappel_valor: clampNonNeg(rappel),
                      iva_compra: iva,
                      pvp: clampNonNeg(pvp),
                      iva_venta: Math.trunc(Number(current?.iva_venta ?? 10) || 10)
                    });
                  }

                  if (escUpdates.length === 0) throw new Error("No hay filas válidas (asegúrate de que exista la columna Producto_ID).");

                  const chunkSize = 75;
                  for (let i = 0; i < escUpdates.length; i += chunkSize) {
                    const chunk = escUpdates.slice(i, i + chunkSize);
                    const { error } = await supabase().from("escandallos").upsert(chunk, { onConflict: "producto_id" });
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
            className="!min-h-11 w-full !border !border-slate-300 !bg-white !text-slate-900 hover:!bg-slate-50 active:!bg-slate-100"
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
            <span className="sm:hidden">Plantilla CSV</span>
            <span className="hidden sm:inline">Descargar Plantilla CSV</span>
          </Button>
          <Button
            type="button"
            className="!min-h-11 w-full !border !border-slate-300 !bg-white !text-slate-900 hover:!bg-slate-50 active:!bg-slate-100"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            <span className="sm:hidden">{importing ? "…" : "Importar CSV"}</span>
            <span className="hidden sm:inline">{importing ? "Importando…" : "Importar Escandallos CSV"}</span>
          </Button>
          </div>
        </div>
      </div>

      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      ) : null}
      {ok ? (
        <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{ok}</p>
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
                const id = readEvtValue(e);
                setNuevoId(id);
                const p = items.find((x) => x.id === id);
                if (p) {
                  setNuevoProveedorId(p.proveedor_id ?? "");
                  setNuevoPrecioTarifa(String(p.precio_tarifa ?? 0));
                  setNuevoUdsCaja(String(p.uds_caja ?? 0));
                  setNuevoDescuentoValor(String(p.descuento_valor ?? 0));
                  setNuevoDescuentoTipo((p.descuento_tipo ?? "%") as "%" | "€");
                  setNuevoRappel(String(p.rappel_valor ?? 0));
                  setNuevoIvaCompra(String(normalizeIva(Number(p.iva_compra ?? 10))));
                  setNuevoPvp(String(p.pvp ?? 0));
                  setNuevoIvaVenta(String(normalizeIva(Number(p.iva_venta ?? 10))));
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
              onChange={(e) => setNuevoProveedorId(readEvtValue(e))}
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
                onChange={(e) => setNuevoPrecioTarifa(readEvtValue(e))}
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
              onChange={(e) => setNuevoUdsCaja(readEvtValue(e))}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Descuento
            <div className="relative">
              <input
                className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 pr-9 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                inputMode="decimal"
                value={nuevoDescuentoValor}
                onChange={(e) => setNuevoDescuentoValor(readEvtValue(e))}
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
              onChange={(e) => setNuevoDescuentoTipo(readEvtValue(e) as "%" | "€")}
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
                onChange={(e) => setNuevoRappel(readEvtValue(e))}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">€</span>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            IVA (compra)
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoIvaCompra}
              onChange={(e) => setNuevoIvaCompra(readEvtValue(e))}
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
                onChange={(e) => setNuevoPvp(readEvtValue(e))}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">€</span>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            IVA (venta)
            <select
              className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={nuevoIvaVenta}
              onChange={(e) => setNuevoIvaVenta(readEvtValue(e))}
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
              onChange={(e) => setVerId(readEvtValue(e))}
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
                Proveedor
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={editProveedorId}
                  onChange={(e) => setEditProveedorId(e.currentTarget.value)}
                >
                  <option value="">(Sin proveedor)</option>
                  {proveedores.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Tarifa
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  type="text"
                  inputMode="decimal"
                  value={editPrecioTarifa}
                  onChange={(e) => setEditPrecioTarifa(e.currentTarget.value)}
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Uds / caja
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  type="text"
                  inputMode="numeric"
                  value={editUdsCaja}
                  onChange={(e) => setEditUdsCaja(e.currentTarget.value)}
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Descuento
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  type="text"
                  inputMode="decimal"
                  value={editDescuentoValor}
                  onChange={(e) => setEditDescuentoValor(e.currentTarget.value)}
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Rappel
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  type="text"
                  inputMode="decimal"
                  value={editRappel}
                  onChange={(e) => setEditRappel(e.currentTarget.value)}
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Tipo desc.
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={editDescuentoTipo}
                  onChange={(e) => setEditDescuentoTipo(e.currentTarget.value as "%" | "€")}
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
                  value={editIvaCompra}
                  onChange={(e) => setEditIvaCompra(e.currentTarget.value)}
                >
                  {IVA_OPTIONS.map((v) => (
                    <option key={v} value={String(v)}>
                      {v}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                PVP
                <input
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  type="text"
                  inputMode="decimal"
                  value={editPvp}
                  onChange={(e) => setEditPvp(e.currentTarget.value)}
                />
              </label>
              <label className="col-span-1 flex flex-col gap-1 text-xs font-semibold text-slate-600">
                IVA venta
                <select
                  className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={editIvaVenta}
                  onChange={(e) => setEditIvaVenta(e.currentTarget.value)}
                >
                  {IVA_OPTIONS.map((v) => (
                    <option key={v} value={String(v)}>
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
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
                <Button onClick={() => void saveEdit()} disabled={saving === verRow.p.id} className="min-h-11 w-full sm:w-auto">
                  {saving === verRow.p.id ? "Guardando…" : "Guardar"}
                </Button>
                <button
                  type="button"
                  onClick={() => void borrarEscandalloActual()}
                  disabled={saving === verRow.p.id}
                  className="min-h-11 w-full rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50 sm:w-auto"
                >
                  Eliminar
                </button>
              </div>
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

