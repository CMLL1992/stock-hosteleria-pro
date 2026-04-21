"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { resolveProductoTituloColumn, tituloColSql, tituloWritePayload } from "@/lib/productosTituloColumn";

type ProductoRow = {
  id: string;
  articulo: string;
  categoria: string | null;
  tipo: string | null;
  unidad: string | null;
  precio_tarifa: number | null;
  stock_actual: number;
  stock_minimo: number | null;
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

function toNullableText(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
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

function mapProductoQueryRow(r: Record<string, unknown>): ProductoRow {
  return {
    id: String(r.id ?? ""),
    articulo: String(r.articulo ?? r.nombre ?? "").trim() || "—",
    categoria: r.categoria != null ? String(r.categoria) : null,
    tipo: r.tipo != null ? String(r.tipo) : null,
    unidad: r.unidad != null ? String(r.unidad) : null,
    precio_tarifa: r.precio_tarifa != null && Number.isFinite(Number(r.precio_tarifa)) ? Number(r.precio_tarifa) : null,
    stock_actual: Math.trunc(toNumberOrZero(r.stock_actual)),
    stock_minimo:
      r.stock_minimo === null || r.stock_minimo === undefined ? null : Math.trunc(toNumberOrZero(r.stock_minimo))
  };
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
  onClose,
  onSave,
  hasPrecioTarifa,
  onDelete
}: {
  open: boolean;
  producto: ProductoRow | null;
  onClose: () => void;
  onSave: (patch: Partial<ProductoRow>) => Promise<void>;
  hasPrecioTarifa: boolean;
  onDelete: () => void;
}) {
  const [articulo, setArticulo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [unidad, setUnidad] = useState("");
  const [precioTarifa, setPrecioTarifa] = useState<string>("0");
  const [stockActual, setStockActual] = useState<string>("0");
  const [stockMinimo, setStockMinimo] = useState<string>("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!producto) return;
    setArticulo(producto.articulo ?? "");
    setCategoria(producto.categoria ?? "");
    setUnidad(producto.unidad ?? "");
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
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={categoria}
                onChange={(e) => setCategoria(e.currentTarget.value)}
                placeholder="Ej: cervezas, licores…"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Unidad</label>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={unidad}
                onChange={(e) => setUnidad(e.currentTarget.value)}
                placeholder="caja, barril, botella…"
              />
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
                      categoria: toNullableText(categoria),
                      unidad: toNullableText(unidad)?.toLowerCase() ?? null,
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
        const full = await supabase()
          .from("productos")
          .select(`id,${t},categoria,tipo,unidad,precio_tarifa,stock_actual,stock_minimo` as "*")
          .eq("establecimiento_id", activeEstablishmentId)
          .order(t, { ascending: true });

        if (!full.error) {
          if (cancelled) return;
          setHasPrecioTarifa(true);
          setItems(((full.data ?? []) as unknown as Record<string, unknown>[]).map(mapProductoQueryRow));
          return;
        }

        const msg = (full.error as { message?: string }).message?.toLowerCase?.() ?? "";
        const looksLikeMissingPrecioTarifa = msg.includes("precio_tarifa") && (msg.includes("does not exist") || msg.includes("could not find"));
        if (!looksLikeMissingPrecioTarifa) throw full.error;

        const lite = await supabase()
          .from("productos")
          .select(`id,${t},categoria,tipo,unidad,stock_actual,stock_minimo` as "*")
          .eq("establecimiento_id", activeEstablishmentId)
          .order(t, { ascending: true });
        if (lite.error) throw lite.error;
        if (cancelled) return;
        setHasPrecioTarifa(false);
        setItems(
          ((lite.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
            ...mapProductoQueryRow(r),
            precio_tarifa: null
          }))
        );
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
  }, [activeEstablishmentId, me?.isAdmin, me?.profileReady, me?.role]);

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
    const full = await supabase()
      .from("productos")
      .select(`id,${t},categoria,tipo,unidad,precio_tarifa,stock_actual,stock_minimo` as "*")
      .eq("establecimiento_id", activeEstablishmentId)
      .order(t, { ascending: true });
    if (!full.error) {
      setHasPrecioTarifa(true);
      setItems(((full.data ?? []) as unknown as Record<string, unknown>[]).map(mapProductoQueryRow));
      return;
    }
    const msg = (full.error as { message?: string }).message?.toLowerCase?.() ?? "";
    const looksLikeMissingPrecioTarifa = msg.includes("precio_tarifa") && (msg.includes("does not exist") || msg.includes("could not find"));
    if (!looksLikeMissingPrecioTarifa) throw full.error;

    const lite = await supabase()
      .from("productos")
      .select(`id,${t},categoria,tipo,unidad,stock_actual,stock_minimo` as "*")
      .eq("establecimiento_id", activeEstablishmentId)
      .order(t, { ascending: true });
    if (lite.error) throw lite.error;
    setHasPrecioTarifa(false);
    setItems(
      ((lite.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
        ...mapProductoQueryRow(r),
        precio_tarifa: null
      }))
    );
  }

  async function onSave(patch: Partial<ProductoRow>) {
    if (!editing || !activeEstablishmentId) return;
    try {
      setErr(null);
      const col = await resolveProductoTituloColumn(activeEstablishmentId);
      const updatePayload: Record<string, unknown> = {
        ...tituloWritePayload(col, String(patch.articulo ?? "").trim()),
        categoria: patch.categoria ?? null,
        unidad: patch.unidad ?? null,
        stock_actual: patch.stock_actual ?? 0,
        stock_minimo: patch.stock_minimo ?? 0
      };
      if (hasPrecioTarifa) updatePayload.precio_tarifa = patch.precio_tarifa ?? 0;
      const { error } = await supabase()
        .from("productos")
        .update(updatePayload)
        .eq("id", editing.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      await refetch();
      setToast({ kind: "ok", message: "Producto actualizado correctamente." });
      setEditOpen(false);
      setEditing(null);
    } catch (e) {
      setErr(supabaseErrToString(e));
      setToast({ kind: "error", message: "No se pudo guardar el producto." });
    }
  }

  async function deltaStock(p: ProductoRow, delta: number) {
    if (!activeEstablishmentId) return;
    setBusyDeltaId(p.id);
    setErr(null);
    try {
      const next = Math.max(0, Math.trunc(p.stock_actual + delta));
      const { error } = await supabase()
        .from("productos")
        .update({ stock_actual: next })
        .eq("id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      await refetch();
      setToast({ kind: "ok", message: "Stock actualizado." });
    } catch (e) {
      setErr(supabaseErrToString(e));
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
      const { error } = await supabase().from("productos").delete().eq("id", p.id).eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
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
  const isAdmin = !!me?.isAdmin;
  if (!isAdmin) {
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
            const catLabel = parseCategoriaTipo(p);
            const unidadLabel = tituloUnidad(p.unidad);
            const stockCircleClass = low
              ? "border-[3px] border-orange-500 bg-orange-50 text-orange-900 shadow-[0_0_0_3px_rgba(249,115,22,0.25)] animate-stock-alert"
              : "border-2 border-slate-200 bg-slate-50 text-slate-900";
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
                      <span className="inline-flex max-w-full rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-800">
                        {catLabel}
                      </span>
                      <span className="text-slate-400" aria-hidden>
                        •
                      </span>
                      <span className="font-medium capitalize text-slate-700">{unidadLabel}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Precio{" "}
                      <span className="font-mono font-semibold text-slate-700">
                        {hasPrecioTarifa
                          ? `${precio.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                          : "—"}
                      </span>
                      {" · "}
                      Mín. <span className="font-mono font-semibold tabular-nums">{minimo}</span>
                    </p>
                  </button>

                  <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                    <button
                      type="button"
                      disabled={busy || p.stock_actual <= 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        deltaStock(p, -1);
                      }}
                      className="inline-flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-2xl font-bold leading-none text-slate-800 shadow-sm hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="Reducir una unidad de stock"
                    >
                      −
                    </button>
                    <div
                      className={[
                        "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full text-center tabular-nums transition",
                        stockCircleClass
                      ].join(" ")}
                      title="Stock actual"
                    >
                      <span className="text-[10px] font-bold uppercase leading-none text-current/80">Stock</span>
                      <span className="text-xl font-black leading-tight">{p.stock_actual}</span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        deltaStock(p, 1);
                      }}
                      className="inline-flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-900 text-2xl font-bold leading-none text-white shadow-md hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="Aumentar una unidad de stock"
                    >
                      +
                    </button>
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

