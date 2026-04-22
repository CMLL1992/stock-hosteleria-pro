"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import {
  CATEGORIA_OPTIONS,
  FORM_CONTROL_CLASS,
  type CategoriaProductoValor,
  type UnidadProductoValor,
  UNIDAD_OPTIONS,
  etiquetaCategoriaMostrada,
  mapCategoriaDbToValor,
  mapUnidadDbToValor
} from "@/lib/productoFormCatalogo";
import { resolveProductoTituloColumn, tituloColSql, tituloWritePayload } from "@/lib/productosTituloColumn";
import { updateProductoCategoriaCompat } from "@/lib/productoWriteCompat";
import { enqueueMovimiento, newClientUuid } from "@/lib/offlineQueue";
import { requireUserId } from "@/lib/session";

type ProveedorOpt = { id: string; nombre: string };

type ProductoRow = {
  id: string;
  articulo: string;
  categoria: string | null;
  tipo: string | null;
  unidad: string | null;
  precio_tarifa: number | null;
  stock_actual: number;
  stock_minimo: number | null;
  proveedor_id: string | null;
};

type Toast = { kind: "ok" | "error"; message: string } | null;

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

function normalizeKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function toNumberOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.trim().replace(/\s/g, "").replace(/[^\d,.-]/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseCategoriaTipo(p: ProductoRow): string {
  const c = normalizeKey(p.categoria);
  if (c) return c;
  const t = normalizeKey(p.tipo);
  return t || "otros";
}

function tituloUnidad(u: string | null | undefined): string {
  const s = (u ?? "—").trim() || "—";
  if (s === "—") return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function mapProductoQueryRow(r: Record<string, unknown>, tituloKey: string): ProductoRow {
  return {
    id: String(r.id ?? ""),
    articulo: String(r[tituloKey] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
    categoria: r.categoria != null ? String(r.categoria) : null,
    tipo: r.tipo != null ? String(r.tipo) : null,
    unidad: r.unidad != null ? String(r.unidad) : null,
    precio_tarifa: null,
    stock_actual: Math.trunc(toNumberOrZero(r.stock_actual)),
    stock_minimo:
      r.stock_minimo === null || r.stock_minimo === undefined ? null : Math.trunc(toNumberOrZero(r.stock_minimo)),
    proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null
  };
}

function isMissingEscandallosTable(e: unknown): boolean {
  const anyErr = e as { code?: unknown; message?: unknown };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  return code === "PGRST205" || /could not find the table/i.test(msg) || /public\.escandallos/i.test(msg);
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  if (!toast) return null;
  const cls =
    toast.kind === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-red-200 bg-red-50 text-red-900";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-3xl justify-center px-4">
      <div className={["pointer-events-auto w-full rounded-2xl border p-3 text-sm shadow-sm", cls].join(" ")}>
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0">{toast.message}</p>
          <button
            className="min-h-12 shrink-0 rounded-2xl px-4 text-sm font-semibold text-slate-700 underline hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function EditProductDrawer({
  open,
  producto,
  proveedores,
  onClose,
  onSave,
  hasPrecioTarifa,
  onDelete
}: {
  open: boolean;
  producto: ProductoRow | null;
  proveedores: ProveedorOpt[];
  onClose: () => void;
  onSave: (patch: Partial<ProductoRow>) => Promise<void>;
  hasPrecioTarifa: boolean;
  onDelete: () => void;
}) {
  const [articulo, setArticulo] = useState("");
  const [categoriaVal, setCategoriaVal] = useState<CategoriaProductoValor>("otros");
  const [unidadVal, setUnidadVal] = useState<UnidadProductoValor>("botella");
  const [proveedorId, setProveedorId] = useState<string>("");
  const [precioTarifa, setPrecioTarifa] = useState<string>("0");
  const [stockActual, setStockActual] = useState<string>("0");
  const [stockMinimo, setStockMinimo] = useState<string>("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!producto) return;
    setArticulo(producto.articulo ?? "");
    const catRaw = producto.categoria ?? producto.tipo;
    setCategoriaVal(mapCategoriaDbToValor(catRaw));
    setUnidadVal(mapUnidadDbToValor(producto.unidad));
    setProveedorId(producto.proveedor_id ?? "");
    setPrecioTarifa(String(producto.precio_tarifa ?? 0));
    setStockActual(String(producto.stock_actual ?? 0));
    setStockMinimo(String(producto.stock_minimo ?? 0));
  }, [producto]);

  return (
    <Drawer open={open && !!producto} title="Editar producto" onClose={onClose}>
      {producto ? (
        <div className="space-y-4 pb-2">
          <p className="text-xs text-slate-500">ID: {producto.id}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-semibold text-slate-900">Artículo</label>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={articulo}
                onChange={(e) => setArticulo(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Categoría</label>
              <select
                className={FORM_CONTROL_CLASS}
                value={categoriaVal}
                onChange={(e) => setCategoriaVal(e.currentTarget.value as CategoriaProductoValor)}
                aria-label="Categoría del producto"
              >
                {CATEGORIA_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Unidad</label>
              <select
                className={FORM_CONTROL_CLASS}
                value={unidadVal}
                onChange={(e) => setUnidadVal(e.currentTarget.value as UnidadProductoValor)}
                aria-label="Unidad de medida"
              >
                {UNIDAD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-semibold text-slate-900">Proveedor</label>
              <select
                className={FORM_CONTROL_CLASS}
                value={proveedorId}
                onChange={(e) => setProveedorId(e.currentTarget.value)}
                aria-label="Proveedor"
              >
                <option value="">(Sin proveedor)</option>
                {proveedores.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Precio tarifa</label>
              {hasPrecioTarifa ? (
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 font-mono text-base text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={precioTarifa}
                  onChange={(e) => setPrecioTarifa(e.currentTarget.value)}
                  inputMode="decimal"
                />
              ) : (
                <p className="min-h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  No disponible (sin columna <span className="font-mono">precio_tarifa</span>).
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Stock actual</label>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 font-mono text-base text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                value={stockActual}
                onChange={(e) => setStockActual(e.currentTarget.value)}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Stock mínimo</label>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 font-mono text-base text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-black/10"
                value={stockMinimo}
                onChange={(e) => setStockMinimo(e.currentTarget.value)}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
                onClick={onClose}
                disabled={saving}
              >
                Cancelar
              </button>
              <Button
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave({
                      articulo: articulo.trim(),
                      categoria: categoriaVal,
                      unidad: unidadVal,
                      proveedor_id: proveedorId || null,
                      precio_tarifa: toNumberOrZero(precioTarifa),
                      stock_actual: Math.max(0, Math.trunc(toNumberOrZero(stockActual))),
                      stock_minimo: Math.max(0, Math.trunc(toNumberOrZero(stockMinimo)))
                    });
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving || !articulo.trim()}
              >
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </div>
            <button
              type="button"
              className="min-h-12 w-full rounded-2xl border border-red-200 bg-red-50 text-sm font-semibold text-red-800 hover:bg-red-100"
              onClick={onDelete}
              disabled={saving}
            >
              Eliminar producto…
            </button>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

export default function AdminProductosPage() {
  const { me, meLoading, activeEstablishmentId } = useActiveEstablishment();
  const role = getEffectiveRole(me);
  const canManageCatalog = hasPermission(role, "admin");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [hasPrecioTarifa, setHasPrecioTarifa] = useState(true);

  const [items, setItems] = useState<ProductoRow[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("todas");

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ProductoRow | null>(null);
  const [busyDeltaId, setBusyDeltaId] = useState<string | null>(null);
  const [proveedoresOpts, setProveedoresOpts] = useState<ProveedorOpt[]>([]);
  const [stockQuickDraft, setStockQuickDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (me?.role === null && !me?.profileReady) return;
    // TEMP: no bloqueamos por permisos para diagnosticar visibilidad.
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        setLoading(true);
        const col = await resolveProductoTituloColumn(activeEstablishmentId);
        const t = tituloColSql(col);
        const lite = await supabase()
          .from("productos")
          .select(`id,${t},categoria,tipo,unidad,stock_actual,stock_minimo,proveedor_id` as "*")
          .eq("establecimiento_id", activeEstablishmentId)
          .order(t, { ascending: true });
        if (lite.error) throw lite.error;
        if (cancelled) return;
        const base = ((lite.data ?? []) as unknown as Record<string, unknown>[]).map((r) => mapProductoQueryRow(r, t));

        const priceById = new Map<string, number>();
        try {
          const esc = await supabase()
            .from("escandallos")
            .select("producto_id,precio_tarifa")
            .eq("establecimiento_id", activeEstablishmentId);
          if (esc.error) throw esc.error;
          for (const r of (esc.data as unknown as Record<string, unknown>[]) ?? []) {
            const pid = String(r.producto_id ?? "").trim();
            if (!pid) continue;
            const n = Number(r.precio_tarifa ?? 0);
            priceById.set(pid, Number.isFinite(n) ? n : 0);
          }
        } catch (e) {
          if (!isMissingEscandallosTable(e)) throw e;
          // Fallback temporal mientras no exista 'escandallos': leemos precio_tarifa desde productos (admin-only page).
          const legacy = await supabase()
            .from("productos")
            .select("id,precio_tarifa")
            .eq("establecimiento_id", activeEstablishmentId);
          if (legacy.error) throw legacy.error;
          for (const r of (legacy.data as unknown as Record<string, unknown>[]) ?? []) {
            const pid = String(r.id ?? "").trim();
            if (!pid) continue;
            const n = Number(r.precio_tarifa ?? 0);
            priceById.set(pid, Number.isFinite(n) ? n : 0);
          }
        }

        setHasPrecioTarifa(true);
        setItems(base.map((p) => ({ ...p, precio_tarifa: priceById.get(p.id) ?? 0 })));
      } catch (e) {
        if (cancelled) return;
        setErr(supabaseErrToString(e));
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, canManageCatalog, me?.profileReady, me?.role]);

  useEffect(() => {
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase()
        .from("proveedores")
        .select("id,nombre")
        .eq("establecimiento_id", activeEstablishmentId)
        .order("nombre", { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setProveedoresOpts((data as ProveedorOpt[]) ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId]);

  useEffect(() => {
    setStockQuickDraft((prev) => {
      const n = { ...prev };
      for (const p of items) {
        if (n[p.id] === undefined) n[p.id] = String(Math.max(0, p.stock_actual));
      }
      return n;
    });
  }, [items]);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("toast") !== "guardado") return;
      setToast({ kind: "ok", message: "Guardado correctamente." });
      u.searchParams.delete("toast");
      const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : "") + u.hash;
      window.history.replaceState({}, "", next || "/admin/productos");
    } catch {
      /* noop */
    }
  }, []);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const p of items) s.add(parseCategoriaTipo(p));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((p) => {
      if (cat !== "todas" && parseCategoriaTipo(p) !== cat) return false;
      if (!qq) return true;
      return normalizeKey(p.articulo).includes(qq);
    });
  }, [cat, items, q]);

  async function refetch() {
    if (!activeEstablishmentId) return;
    const col = await resolveProductoTituloColumn(activeEstablishmentId);
    const t = tituloColSql(col);
    const lite = await supabase()
      .from("productos")
      .select(`id,${t},categoria,tipo,unidad,stock_actual,stock_minimo,proveedor_id` as "*")
      .eq("establecimiento_id", activeEstablishmentId)
      .order(t, { ascending: true });
    if (lite.error) throw lite.error;
    const base = ((lite.data ?? []) as unknown as Record<string, unknown>[]).map((r) => mapProductoQueryRow(r, t));
    const priceById = new Map<string, number>();
    try {
      const esc = await supabase()
        .from("escandallos")
        .select("producto_id,precio_tarifa")
        .eq("establecimiento_id", activeEstablishmentId);
      if (esc.error) throw esc.error;
      for (const r of (esc.data as unknown as Record<string, unknown>[]) ?? []) {
        const pid = String(r.producto_id ?? "").trim();
        if (!pid) continue;
        const n = Number(r.precio_tarifa ?? 0);
        priceById.set(pid, Number.isFinite(n) ? n : 0);
      }
    } catch (e) {
      if (!isMissingEscandallosTable(e)) throw e;
      const legacy = await supabase().from("productos").select("id,precio_tarifa").eq("establecimiento_id", activeEstablishmentId);
      if (legacy.error) throw legacy.error;
      for (const r of (legacy.data as unknown as Record<string, unknown>[]) ?? []) {
        const pid = String(r.id ?? "").trim();
        if (!pid) continue;
        const n = Number(r.precio_tarifa ?? 0);
        priceById.set(pid, Number.isFinite(n) ? n : 0);
      }
    }
    setHasPrecioTarifa(true);
    setItems(base.map((p) => ({ ...p, precio_tarifa: priceById.get(p.id) ?? 0 })));
  }

  async function onSave(patch: Partial<ProductoRow>) {
    if (!editing || !activeEstablishmentId) return;
    try {
      setErr(null);
      const col = await resolveProductoTituloColumn(activeEstablishmentId);
      const updatePayload: Record<string, unknown> = {
        ...tituloWritePayload(col, String(patch.articulo ?? "").trim()),
        categoria: patch.categoria != null ? String(patch.categoria) : null,
        unidad: patch.unidad != null ? String(patch.unidad) : null,
        proveedor_id: patch.proveedor_id ?? null,
        stock_minimo: patch.stock_minimo ?? 0
      };
      const { error } = await updateProductoCategoriaCompat(
        async (fields) => {
          const r = await supabase()
            .from("productos")
            .update(fields)
            .eq("id", editing.id)
            .eq("establecimiento_id", activeEstablishmentId);
          return { error: r.error };
        },
        updatePayload
      );
      if (error) throw error;

      // Precio tarifa: se guarda en escandallos (admin-only)
      if (hasPrecioTarifa && patch.precio_tarifa != null) {
        const { error: escErr } = await supabase()
          .from("escandallos")
          .upsert(
            {
              producto_id: editing.id,
              establecimiento_id: activeEstablishmentId,
              precio_tarifa: Math.max(0, toNumberOrZero(patch.precio_tarifa))
            },
            { onConflict: "producto_id" }
          );
        if (escErr) throw escErr;
      }

      // Stock: nunca se modifica directo; se registra como movimiento.
      if (patch.stock_actual != null) {
        const desired = Math.max(0, Math.trunc(toNumberOrZero(patch.stock_actual)));
        const current = Math.max(0, Math.trunc(toNumberOrZero(editing.stock_actual)));
        const delta = desired - current;
        if (delta !== 0) {
          const usuario_id = await requireUserId();
          const ts = new Date().toISOString();
          const tipo = delta > 0 ? "entrada" : "salida";
          const cantidad = Math.abs(delta);
          if (typeof navigator !== "undefined" && navigator.onLine) {
            const { error: mvErr } = await supabase().from("movimientos").upsert(
              {
                client_uuid: newClientUuid(),
                producto_id: editing.id,
                establecimiento_id: activeEstablishmentId,
                tipo,
                cantidad,
                usuario_id,
                timestamp: ts
              },
              { onConflict: "client_uuid" }
            );
            if (mvErr) throw mvErr;
          } else {
            await enqueueMovimiento({
              client_uuid: newClientUuid(),
              producto_id: editing.id,
              establecimiento_id: activeEstablishmentId,
              tipo,
              cantidad,
              usuario_id,
              timestamp: ts
            });
          }
        }
      }

      await refetch();
      setToast({ kind: "ok", message: "Producto actualizado correctamente." });
      setEditOpen(false);
      setEditing(null);
    } catch (e) {
      setErr(supabaseErrToString(e));
      setToast({ kind: "error", message: "No se pudo guardar el producto." });
    }
  }

  async function commitQuickStock(p: ProductoRow, raw: string) {
    if (!activeEstablishmentId) return;
    const next = Math.max(0, Math.trunc(toNumberOrZero(raw)));
    setBusyDeltaId(p.id);
    setErr(null);
    try {
      const prev = Math.max(0, Math.trunc(toNumberOrZero(p.stock_actual)));
      const delta = next - prev;
      if (delta !== 0) {
        const usuario_id = await requireUserId();
        const ts = new Date().toISOString();
        const tipo = delta > 0 ? "entrada" : "salida";
        const cantidad = Math.abs(delta);
        if (typeof navigator !== "undefined" && navigator.onLine) {
          const { error } = await supabase().from("movimientos").upsert(
            {
              client_uuid: newClientUuid(),
              producto_id: p.id,
              establecimiento_id: activeEstablishmentId,
              tipo,
              cantidad,
              usuario_id,
              timestamp: ts
            },
            { onConflict: "client_uuid" }
          );
          if (error) throw error;
        } else {
          await enqueueMovimiento({
            client_uuid: newClientUuid(),
            producto_id: p.id,
            establecimiento_id: activeEstablishmentId,
            tipo,
            cantidad,
            usuario_id,
            timestamp: ts
          });
        }
      }
      setStockQuickDraft((d) => ({ ...d, [p.id]: String(next) }));
      await refetch();
      setToast({ kind: "ok", message: "Stock actualizado." });
    } catch (e) {
      setErr(supabaseErrToString(e));
      setStockQuickDraft((d) => ({ ...d, [p.id]: String(p.stock_actual) }));
      setToast({ kind: "error", message: "No se pudo actualizar el stock." });
    } finally {
      setBusyDeltaId(null);
    }
  }

  async function onDelete(p: ProductoRow) {
    if (!activeEstablishmentId) return;
    const ok = window.confirm(`¿Eliminar "${p.articulo}"? Esta acción no se puede deshacer.`);
    if (!ok) return;
    try {
      setErr(null);
      const { data, error } = await supabase().rpc("delete_producto_cascade", { p_producto_id: p.id });
      if (error) throw error;
      const okRes = ((data ?? null) as { ok?: boolean; message?: string } | null)?.ok ?? false;
      if (!okRes) {
        const msg = ((data ?? null) as { message?: string } | null)?.message ?? "No se pudo eliminar el producto.";
        throw new Error(msg);
      }
      await refetch();
      setToast({ kind: "ok", message: "Producto eliminado." });
      setEditOpen(false);
      setEditing(null);
    } catch (e) {
      setErr(supabaseErrToString(e));
      setToast({ kind: "error", message: "No se pudo eliminar el producto." });
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (me?.role === null && !me?.profileReady) return <main className="p-4 text-sm text-slate-600">Cargando perfil…</main>;
  if (!canManageCatalog) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Gestionar productos</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Gestionar productos" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl bg-slate-50 p-4 pb-28 text-slate-900">
        {/* Acceso protegido por isAdmin */}
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Gestión de Productos</h1>
            <p className="text-sm text-slate-600">
              {activeEstablishmentId ? (
                <>
                  {filtered.length} / {items.length} productos
                </>
              ) : (
                "No hay establecimiento activo."
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              onClick={async () => {
                try {
                  setLoading(true);
                  await refetch();
                  setToast({ kind: "ok", message: "Listado actualizado." });
                } catch (e) {
                  setErr(supabaseErrToString(e));
                  setToast({ kind: "error", message: "No se pudo actualizar el listado." });
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              {loading ? "Actualizando…" : "Recargar"}
            </button>
            <a
              href="/admin/productos/nuevo"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-black px-4 text-sm font-semibold text-white hover:bg-slate-900 active:bg-slate-950"
            >
              Crear producto
            </a>
          </div>
        </div>

        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}

        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Buscar</label>
            <input
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="Buscar por artículo…"
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Categoría</label>
            <select
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={cat}
              onChange={(e) => setCat(e.currentTarget.value)}
            >
              <option value="todas">Todas</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {filtered.map((p) => {
            const precio = typeof p.precio_tarifa === "number" ? p.precio_tarifa : 0;
            const minimo = typeof p.stock_minimo === "number" && Number.isFinite(p.stock_minimo) ? p.stock_minimo : 0;
            const low = p.stock_actual <= minimo;
            const busy = busyDeltaId === p.id;
            const unidadLabel = tituloUnidad(p.unidad);
            const provNombre =
              proveedoresOpts.find((pr) => pr.id === p.proveedor_id)?.nombre ?? (p.proveedor_id ? "—" : "Sin proveedor");
            const stockRingClass = low
              ? "border-orange-500 bg-orange-50 ring-2 ring-orange-200 animate-stock-alert"
              : "border-slate-200 bg-white ring-1 ring-slate-100";
            return (
              <article
                key={p.id}
                className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm ring-1 ring-slate-100"
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="min-h-[52px] min-w-0 flex-1 rounded-xl py-0.5 text-left transition active:bg-slate-50"
                    onClick={() => {
                      setEditing(p);
                      setEditOpen(true);
                    }}
                  >
                    <p className="text-lg font-bold leading-snug text-slate-900">{p.articulo}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800">
                        <span className="capitalize">{etiquetaCategoriaMostrada(p.categoria ?? p.tipo)}</span>
                      </span>
                      <span className="text-slate-400" aria-hidden>
                        •
                      </span>
                      <span className="font-medium capitalize text-slate-700">{unidadLabel}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Proveedor: {provNombre} · Precio{" "}
                      <span className="font-mono font-semibold text-slate-700">
                        {hasPrecioTarifa
                          ? `${precio.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                          : "—"}
                      </span>
                      {" · "}
                      Mín. <span className="font-mono font-semibold tabular-nums">{minimo}</span>
                    </p>
                  </button>

                  <div className={`flex shrink-0 flex-col items-center gap-1 rounded-2xl border-2 p-2 ${stockRingClass}`}>
                    <span className="text-[10px] font-bold uppercase text-slate-500">Stock</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`Stock de ${p.articulo}`}
                      disabled={busy}
                      className="h-14 w-[5.5rem] rounded-xl border border-slate-300 bg-white px-1 text-center text-2xl font-black tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      value={stockQuickDraft[p.id] ?? String(p.stock_actual)}
                      onChange={(e) => setStockQuickDraft((d) => ({ ...d, [p.id]: e.currentTarget.value }))}
                      onBlur={(e) => {
                        void commitQuickStock(p, e.currentTarget.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="mt-3 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50/80 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                  onClick={() => {
                    setEditing(p);
                    setEditOpen(true);
                  }}
                >
                  Editar detalles
                </button>
              </article>
            );
          })}
          {!filtered.length && !loading ? (
            <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-base text-slate-600">
              No hay productos que coincidan con los filtros.
            </p>
          ) : null}
        </div>
      </main>

      <EditProductDrawer
        open={editOpen}
        producto={editing}
        proveedores={proveedoresOpts}
        hasPrecioTarifa={hasPrecioTarifa}
        onClose={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        onSave={onSave}
        onDelete={() => {
          if (editing) void onDelete(editing);
        }}
      />
      <ToastView toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

