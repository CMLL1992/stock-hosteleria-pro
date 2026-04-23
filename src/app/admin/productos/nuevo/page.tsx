"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import {
  CATEGORIA_OPTIONS,
  FORM_CONTROL_CLASS,
  type CategoriaProductoValor,
  type UnidadProductoValor,
  UNIDAD_OPTIONS
} from "@/lib/productoFormCatalogo";
import { insertProductoCategoriaCompat } from "@/lib/productoWriteCompat";
import { resolveProductoTituloColumn, tituloWritePayload } from "@/lib/productosTituloColumn";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

type Proveedor = { id: string; nombre: string; telefono_whatsapp: string | null };
type EnvaseOpt = { id: string; nombre: string; coste: number };

function newUid() {
  return crypto.randomUUID().replaceAll("-", "");
}

function parseStockField(raw: string): number {
  const n = parseFloat(String(raw ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function NuevoProductoPage() {
  const router = useRouter();
  const [role, setRole] = useState<AppRole | null>(null);
  const canManageCatalog = hasPermission(role, "admin");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [envases, setEnvases] = useState<EnvaseOpt[]>([]);
  const { activeEstablishmentId } = useActiveEstablishment();

  const [articulo, setArticulo] = useState("");
  const [categoriaVal, setCategoriaVal] = useState<CategoriaProductoValor>("otros");
  const [unidadVal, setUnidadVal] = useState<UnidadProductoValor>("botella");
  const [stockActual, setStockActual] = useState<string>("0");
  const [stockMinimo, setStockMinimo] = useState<string>("0");
  const [proveedorId, setProveedorId] = useState<string>("");
  const [envaseId, setEnvaseId] = useState<string>("");
  const [unidadesPorCaja, setUnidadesPorCaja] = useState<string>("1");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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

  useEffect(() => {
    if (!canManageCatalog) return;
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase()
          .from("proveedores")
          .select("id,nombre,telefono_whatsapp")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("nombre", { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        setProveedores((data as unknown as Proveedor[]) ?? []);

        const env = await supabase()
          .from("envases_catalogo")
          .select("id,nombre,coste")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("nombre", { ascending: true });
        if (!cancelled && !env.error) {
          setEnvases((env.data as unknown as EnvaseOpt[]) ?? []);
        }
      } catch (e) {
        if (cancelled) return;
        setErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, canManageCatalog]);

  async function crear() {
    setErr(null);
    if (!activeEstablishmentId) {
      setErr("No hay establecimiento activo.");
      return;
    }
    if (!articulo.trim()) {
      setErr("El artículo no puede estar vacío.");
      return;
    }
    const uid = newUid();
    const sa = Math.trunc(parseStockField(stockActual)) || 0;
    const sm = Math.trunc(parseStockField(stockMinimo)) || 0;
    const col = await resolveProductoTituloColumn(activeEstablishmentId);

    const row: Record<string, unknown> = {
      ...tituloWritePayload(col, articulo.trim()),
      unidad: unidadVal,
      categoria: categoriaVal,
      stock_actual: sa,
      stock_minimo: sm,
      proveedor_id: proveedorId || null,
      envase_catalogo_id: envaseId || null,
      unidades_por_caja: Math.max(1, Math.trunc(parseStockField(unidadesPorCaja)) || 1),
      qr_code_uid: uid,
      establecimiento_id: activeEstablishmentId
    };

    const { error } = await insertProductoCategoriaCompat(
      async (fields) => {
        const r = await supabase().from("productos").insert(fields);
        return { error: r.error };
      },
      row
    );

    if (error) {
      setErr(supabaseErrToString(error));
      return;
    }
    // Redirección limpia sin “saltos” de scroll por recarga completa.
    router.replace("/admin/productos?toast=guardado");
  }

  if (loading) return <main className="p-4 text-sm text-zinc-600 dark:text-zinc-300">Cargando…</main>;

  if (!canManageCatalog) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Crear producto (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Crear producto" showBack backHref="/admin" />
      <main className="mx-auto max-w-md bg-slate-50 p-4 pb-28 text-slate-900">
        <h1 className="mb-3 text-xl font-semibold">Crear producto</h1>
        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}

        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-900">Artículo</label>
            <input
              className={FORM_CONTROL_CLASS}
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

          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-900">Unidades por caja</label>
            <input
              className={FORM_CONTROL_CLASS}
              type="number"
              min={1}
              inputMode="numeric"
              value={unidadesPorCaja}
              onChange={(e) => setUnidadesPorCaja(e.currentTarget.value)}
            />
            <p className="text-xs text-slate-600">Ejemplo: si una caja tiene 24, pon 24.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Stock actual</label>
              <input
                className={FORM_CONTROL_CLASS}
                type="number"
                min={0}
                inputMode="numeric"
                value={stockActual}
                onChange={(e) => setStockActual(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Stock mínimo</label>
              <input
                className={FORM_CONTROL_CLASS}
                type="number"
                min={0}
                inputMode="numeric"
                value={stockMinimo}
                onChange={(e) => setStockMinimo(e.currentTarget.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-900">Proveedor</label>
            <select
              className={FORM_CONTROL_CLASS}
              value={proveedorId}
              onChange={(e) => setProveedorId(e.currentTarget.value)}
              aria-label="Proveedor"
            >
              <option value="">(Sin proveedor)</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-900">Envase (coste real)</label>
            <select className={FORM_CONTROL_CLASS} value={envaseId} onChange={(e) => setEnvaseId(e.currentTarget.value)}>
              <option value="">(Sin envase)</option>
              {envases.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre} · {(Number(e.coste ?? 0) || 0).toFixed(2)} €
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-600">
              Si asignas un envase, el Dashboard valorará envases con este coste (en vez de precio global por tipo).
            </p>
          </div>

          <Button onClick={crear} disabled={!articulo.trim()}>
            Crear
          </Button>
        </div>
      </main>
    </div>
  );
}
