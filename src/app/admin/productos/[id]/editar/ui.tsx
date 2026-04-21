"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MobileHeader } from "@/components/MobileHeader";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { resolveProductoTituloColumn, tituloColSql, tituloWritePayload } from "@/lib/productosTituloColumn";
import {
  CATEGORIA_OPTIONS,
  FORM_CONTROL_CLASS_GRAY,
  type CategoriaProductoValor,
  type UnidadProductoValor,
  UNIDAD_OPTIONS,
  mapCategoriaDbToValor,
  mapUnidadDbToValor
} from "@/lib/productoFormCatalogo";
import { updateProductoCategoriaCompat } from "@/lib/productoWriteCompat";

type Proveedor = { id: string; nombre: string };

type Producto = {
  id: string;
  articulo: string;
  unidad: string | null;
  categoria: string | null;
  tipo: string | null;
  stock_minimo: number | null;
  proveedor_id: string | null;
};

export function EditarProductoClient({ id }: { id: string }) {
  const router = useRouter();
  const { activeEstablishmentId } = useActiveEstablishment();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [producto, setProducto] = useState<Producto | null>(null);

  const [articulo, setArticulo] = useState("");
  const [categoriaVal, setCategoriaVal] = useState<CategoriaProductoValor>("otros");
  const [unidadVal, setUnidadVal] = useState<UnidadProductoValor>("botella");
  const [stockMinimo, setStockMinimo] = useState<number>(0);
  const [proveedorId, setProveedorId] = useState<string>("");

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
    if (role !== "admin" && role !== "superadmin") return;
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      try {
        setErr(null);

        const col = await resolveProductoTituloColumn(activeEstablishmentId);
        const t = tituloColSql(col);
        const { data: p, error: pErr } = await supabase()
          .from("productos")
          .select(`id,${t},unidad,categoria,tipo,stock_minimo,proveedor_id` as "*")
          .eq("id", id)
          .eq("establecimiento_id", activeEstablishmentId)
          .maybeSingle();
        if (pErr) throw pErr;
        if (cancelled) return;
        if (!p) {
          setErr("Producto no encontrado.");
          return;
        }

        const raw = p as unknown as Record<string, unknown>;
        const prod: Producto = {
          id: String(raw.id ?? ""),
          articulo: String(raw[t] ?? raw.articulo ?? raw.nombre ?? "").trim() || "—",
          unidad: raw.unidad != null ? String(raw.unidad) : null,
          categoria: raw.categoria != null ? String(raw.categoria) : null,
          tipo: raw.tipo != null ? String(raw.tipo) : null,
          stock_minimo: raw.stock_minimo != null ? Number(raw.stock_minimo) : null,
          proveedor_id: raw.proveedor_id != null ? String(raw.proveedor_id) : null
        };
        setProducto(prod);
        setArticulo(prod.articulo ?? "");
        const catRaw = prod.categoria ?? prod.tipo;
        setCategoriaVal(mapCategoriaDbToValor(catRaw));
        setUnidadVal(mapUnidadDbToValor(prod.unidad));
        setStockMinimo(typeof prod.stock_minimo === "number" ? prod.stock_minimo : 0);
        setProveedorId(prod.proveedor_id ?? "");

        const { data: provs, error: provErr } = await supabase()
          .from("proveedores")
          .select("id,nombre")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("nombre", { ascending: true });
        if (provErr) throw provErr;
        if (cancelled) return;
        setProveedores((provs as unknown as Proveedor[]) ?? []);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, id, role]);

  async function guardar() {
    if (!producto) return;
    if (!activeEstablishmentId) {
      setErr("No hay establecimiento activo.");
      return;
    }
    setErr(null);
    setOk(null);

    const col = await resolveProductoTituloColumn(activeEstablishmentId);

    const payload: Record<string, unknown> = {
      ...tituloWritePayload(col, articulo.trim()),
      unidad: unidadVal,
      categoria: categoriaVal,
      stock_minimo: Number.isFinite(stockMinimo) ? stockMinimo : 0,
      proveedor_id: proveedorId || null
    };

    const { error } = await updateProductoCategoriaCompat(
      async (fields) => {
        const r = await supabase()
          .from("productos")
          .update(fields)
          .eq("id", producto.id)
          .eq("establecimiento_id", activeEstablishmentId);
        return { error: r.error };
      },
      payload
    );

    if (error) {
      setErr(error.message);
      return;
    }
    setOk("Guardado correctamente");
    router.push("/mas?toast=guardado");
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Editar" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        {loading ? <p className="text-sm text-gray-600">Cargando…</p> : null}
        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}
        {ok ? (
          <p className="mb-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">{ok}</p>
        ) : null}

        {role !== "admin" && role !== "superadmin" && !loading ? (
          <div className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-gray-900">Acceso denegado.</p>
            <p className="mt-1 text-sm text-gray-600">Esta sección es solo para administradores.</p>
          </div>
        ) : null}

        {role === "admin" || role === "superadmin" ? (
          <div className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
            {!producto ? (
              <p className="text-sm text-gray-600">Cargando producto…</p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-900">Artículo</label>
                  <input
                    className={FORM_CONTROL_CLASS_GRAY}
                    value={articulo}
                    onChange={(e) => setArticulo(e.currentTarget.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-900">Categoría</label>
                  <select
                    className={FORM_CONTROL_CLASS_GRAY}
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
                  <label className="text-sm font-semibold text-gray-900">Unidad</label>
                  <select
                    className={FORM_CONTROL_CLASS_GRAY}
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
                  <label className="text-sm font-semibold text-gray-900">Stock mínimo</label>
                  <input
                    className={FORM_CONTROL_CLASS_GRAY}
                    type="number"
                    min={0}
                    value={stockMinimo}
                    onChange={(e) => setStockMinimo(Number(e.currentTarget.value))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-900">Proveedor</label>
                  <select
                    className={FORM_CONTROL_CLASS_GRAY}
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

                <Button onClick={guardar} disabled={!articulo.trim() || !producto}>
                  Guardar cambios
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
