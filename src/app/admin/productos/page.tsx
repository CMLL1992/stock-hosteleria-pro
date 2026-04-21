"use client";

import { useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";

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
          <button className="shrink-0 text-sm font-semibold underline" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function EditModal({
  open,
  producto,
  onClose,
  onSave,
  hasPrecioTarifa
}: {
  open: boolean;
  producto: ProductoRow | null;
  onClose: () => void;
  onSave: (patch: Partial<ProductoRow>) => Promise<void>;
  hasPrecioTarifa: boolean;
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

  if (!open || !producto) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Editar producto</p>
            <p className="mt-0.5 text-xs text-slate-600">ID: {producto.id}</p>
          </div>
          <button type="button" className="text-sm font-semibold text-slate-600 underline" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                No disponible (la BD no tiene la columna <span className="font-mono">precio_tarifa</span>).
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

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
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
      </div>
    </div>
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

  useEffect(() => {
    if (me?.role === null && !me?.profileReady) return;
    // TEMP: no bloqueamos por permisos para diagnosticar visibilidad.
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        setLoading(true);
        const full = await supabase()
          .from("productos")
          .select("id,articulo,categoria,tipo,unidad,precio_tarifa,stock_actual,stock_minimo")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("articulo", { ascending: true });

        if (!full.error) {
          if (cancelled) return;
          setHasPrecioTarifa(true);
          setItems((full.data as unknown as ProductoRow[]) ?? []);
          return;
        }

        const msg = (full.error as { message?: string }).message?.toLowerCase?.() ?? "";
        const looksLikeMissingPrecioTarifa = msg.includes("precio_tarifa") && (msg.includes("does not exist") || msg.includes("could not find"));
        if (!looksLikeMissingPrecioTarifa) throw full.error;

        const lite = await supabase()
          .from("productos")
          .select("id,articulo,categoria,tipo,unidad,stock_actual,stock_minimo")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("articulo", { ascending: true });
        if (lite.error) throw lite.error;
        if (cancelled) return;
        setHasPrecioTarifa(false);
        setItems(
          ((lite.data ?? []) as unknown as Array<Omit<ProductoRow, "precio_tarifa">>).map((p) => ({
            ...(p as unknown as Omit<ProductoRow, "precio_tarifa">),
            precio_tarifa: null
          })) as ProductoRow[]
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
    const full = await supabase()
      .from("productos")
      .select("id,articulo,categoria,tipo,unidad,precio_tarifa,stock_actual,stock_minimo")
      .eq("establecimiento_id", activeEstablishmentId)
      .order("articulo", { ascending: true });
    if (!full.error) {
      setHasPrecioTarifa(true);
      setItems((full.data as unknown as ProductoRow[]) ?? []);
      return;
    }
    const msg = (full.error as { message?: string }).message?.toLowerCase?.() ?? "";
    const looksLikeMissingPrecioTarifa = msg.includes("precio_tarifa") && (msg.includes("does not exist") || msg.includes("could not find"));
    if (!looksLikeMissingPrecioTarifa) throw full.error;

    const lite = await supabase()
      .from("productos")
      .select("id,articulo,categoria,tipo,unidad,stock_actual,stock_minimo")
      .eq("establecimiento_id", activeEstablishmentId)
      .order("articulo", { ascending: true });
    if (lite.error) throw lite.error;
    setHasPrecioTarifa(false);
    setItems(
      ((lite.data ?? []) as unknown as Array<Omit<ProductoRow, "precio_tarifa">>).map((p) => ({
        ...(p as unknown as Omit<ProductoRow, "precio_tarifa">),
        precio_tarifa: null
      })) as ProductoRow[]
    );
  }

  async function onSave(patch: Partial<ProductoRow>) {
    if (!editing || !activeEstablishmentId) return;
    try {
      setErr(null);
      const updatePayload: Record<string, unknown> = {
        articulo: patch.articulo,
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
      <main className="mx-auto max-w-6xl bg-slate-50 p-4 pb-28 text-slate-900">
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

        <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-white text-[11px] font-bold uppercase tracking-wide text-slate-700">
                <th className="border-r border-slate-200 px-3 py-2">Nombre</th>
                <th className="border-r border-slate-200 px-3 py-2">Categoría/Tipo</th>
                <th className="border-r border-slate-200 px-3 py-2">Unidad</th>
                <th className="border-r border-slate-200 px-3 py-2 text-right">Precio</th>
                <th className="border-r border-slate-200 px-3 py-2 text-right">Stock</th>
                <th className="border-r border-slate-200 px-3 py-2 text-right">Mín</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const precio = typeof p.precio_tarifa === "number" ? p.precio_tarifa : 0;
                const minimo = typeof p.stock_minimo === "number" && Number.isFinite(p.stock_minimo) ? p.stock_minimo : 0;
                const low = p.stock_actual < minimo;
                return (
                  <tr key={p.id} className={["border-b border-slate-200", low ? "bg-red-50/40" : "hover:bg-slate-50"].join(" ")}>
                    <td className="border-r border-slate-200 px-3 py-2 font-semibold text-slate-900">{p.articulo}</td>
                    <td className="border-r border-slate-200 px-3 py-2 text-slate-800">{parseCategoriaTipo(p)}</td>
                    <td className="border-r border-slate-200 px-3 py-2 text-slate-800">{p.unidad ?? "—"}</td>
                    <td className="border-r border-slate-200 px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                      {hasPrecioTarifa
                        ? `${precio.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                        : "—"}
                    </td>
                    <td className="border-r border-slate-200 px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                      {p.stock_actual}
                    </td>
                    <td className="border-r border-slate-200 px-3 py-2 text-right font-mono tabular-nums text-slate-900">
                      {minimo}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="min-h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                          onClick={() => {
                            setEditing(p);
                            setEditOpen(true);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="min-h-10 rounded-2xl border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50"
                          onClick={() => onDelete(p)}
                          title="Eliminar"
                          aria-label="Eliminar"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && !loading ? (
                <tr>
                  <td className="px-3 py-6 text-sm text-slate-600" colSpan={7}>
                    No hay productos que coincidan con los filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </main>

      <EditModal
        open={editOpen}
        producto={editing}
        hasPrecioTarifa={hasPrecioTarifa}
        onClose={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        onSave={onSave}
      />
      <ToastView toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

