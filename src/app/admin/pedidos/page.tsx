"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { waUrlPedidoAgrupadoProveedor } from "@/lib/whatsappPedido";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";

type ProveedorRow = {
  id: string;
  nombre: string;
  telefono_whatsapp: string | null;
};

type ProductoPedido = {
  id: string;
  articulo: string;
  proveedor_id: string | null;
};

function parseQty(raw: string): number {
  const n = Math.trunc(Number(String(raw).replace(",", ".")));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function loadData(establecimientoId: string): Promise<{ proveedores: ProveedorRow[]; productos: ProductoPedido[] }> {
  const col = await resolveProductoTituloColumn(establecimientoId);
  const t = tituloColSql(col);
  const prodSelect = `id,${t},proveedor_id,proveedor:proveedores(nombre,telefono_whatsapp)`;

  const provRes = await supabase()
    .from("proveedores")
    .select("id,nombre,telefono_whatsapp")
    .eq("establecimiento_id", establecimientoId)
    .order("nombre", { ascending: true });

  if (provRes.error) throw provRes.error;

  const { data, error } = await supabase()
    .from("productos")
    .select(prodSelect as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });

  if (!error) {
    const productos = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: String(r.id ?? ""),
      articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
      proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null
    }));
    return { proveedores: (provRes.data as ProveedorRow[]) ?? [], productos };
  }

  const msg = (error.message ?? "").toLowerCase();
  const missing =
    msg.includes("proveedor") || msg.includes("relationship") || msg.includes("embed") || msg.includes("column");

  if (!missing) throw error;

  const fb = await supabase()
    .from("productos")
    .select(`id,${t},proveedor_id` as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });
  if (fb.error) throw fb.error;
  const productos = ((fb.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ""),
    articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
    proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null
  }));
  return { proveedores: (provRes.data as ProveedorRow[]) ?? [], productos };
}

export default function PedidosPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const [productos, setProductos] = useState<ProductoPedido[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});

  const { activeEstablishmentId, activeEstablishmentName } = useActiveEstablishment();
  const nombreLocal = activeEstablishmentName?.trim() || "Piqui Blinders";

  const refresh = useCallback(async () => {
    if (!activeEstablishmentId) {
      setProveedores([]);
      setProductos([]);
      return;
    }
    setLoadingData(true);
    setErr(null);
    try {
      const d = await loadData(activeEstablishmentId);
      setProveedores(d.proveedores);
      setProductos(d.productos);
      setQty((prev) => {
        const next = { ...prev };
        for (const p of d.productos) {
          if (next[p.id] === undefined) next[p.id] = "";
        }
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingData(false);
    }
  }, [activeEstablishmentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchMyRole()
      .then((r) => {
        if (!cancelled) setRole(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (role !== "admin" && role !== "superadmin") return;
    refresh();
  }, [role, refresh]);

  const sinProveedor = useMemo(
    () => productos.filter((p) => !p.proveedor_id || !proveedores.some((pr) => pr.id === p.proveedor_id)),
    [productos, proveedores]
  );

  const grupos = useMemo(() => {
    const list: Array<ProveedorRow & { productos: ProductoPedido[] }> = proveedores.map((pr) => ({
      ...pr,
      productos: productos.filter((p) => p.proveedor_id === pr.id)
    }));
    if (sinProveedor.length > 0) {
      list.push({
        id: "__sin__",
        nombre: "Sin proveedor",
        telefono_whatsapp: null,
        productos: sinProveedor
      });
    }
    return list.filter((g) => g.productos.length > 0);
  }, [proveedores, productos, sinProveedor]);

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (role !== "admin" && role !== "superadmin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Pedidos</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Pedidos por proveedor" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Pedidos</h1>
          <p className="mt-1 text-sm text-slate-600">
            Despliega un proveedor, escribe cantidades y envía el pedido por WhatsApp.
          </p>
        </div>

        {err ? (
          <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}
        {loadingData ? <p className="text-sm text-slate-500">Cargando catálogo…</p> : null}

        {!loadingData && productos.length === 0 && !err ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            No hay productos en este establecimiento.
          </p>
        ) : !loadingData && grupos.length === 0 && !err ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            No hay productos agrupables por proveedor. Asigna un proveedor a cada artículo.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {grupos.map((g) => {
              const key = g.id;
              const expanded = !!open[key];
              const lineasWa = g.productos.map((p) => ({
                articulo: p.articulo,
                cantidad: parseQty(qty[p.id] ?? "")
              }));
              const urlWa = waUrlPedidoAgrupadoProveedor({
                nombreProveedor: g.nombre,
                telefonoWhatsapp: g.telefono_whatsapp,
                nombreEstablecimiento: nombreLocal,
                lineas: lineasWa
              });
              const tieneLineas = lineasWa.some((l) => l.cantidad > 0);

              return (
                <li key={key} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100">
                  <button
                    type="button"
                    className="flex w-full min-h-14 items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                    onClick={() => setOpen((o) => ({ ...o, [key]: !expanded }))}
                    aria-expanded={expanded}
                  >
                    <span className="min-w-0 flex-1 font-bold text-slate-900">{g.nombre}</span>
                    <span className="shrink-0 text-slate-500">
                      {expanded ? <ChevronDown className="h-6 w-6" /> : <ChevronRight className="h-6 w-6" />}
                    </span>
                  </button>

                  {expanded ? (
                    <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
                      <ul className="flex flex-col gap-4">
                        {g.productos.map((p) => (
                          <li key={p.id} className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold leading-snug text-slate-900">{p.articulo}</p>
                            </div>
                            <label className="sr-only" htmlFor={`qty-${p.id}`}>
                              Cantidad para {p.articulo}
                            </label>
                            <input
                              id={`qty-${p.id}`}
                              type="number"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="0"
                              className="h-16 w-24 shrink-0 rounded-2xl border-2 border-slate-800 bg-white px-2 text-center text-3xl font-black tabular-nums text-slate-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-slate-300"
                              value={qty[p.id] ?? ""}
                              onChange={(e) => setQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              min={0}
                            />
                          </li>
                        ))}
                      </ul>

                      <a
                        href={urlWa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={[
                          "inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl px-4 py-4 text-base font-bold text-white shadow-md transition",
                          tieneLineas ? "bg-emerald-500 hover:bg-emerald-600" : "pointer-events-none bg-slate-300"
                        ].join(" ")}
                        aria-disabled={!tieneLineas}
                        onClick={(e) => {
                          if (!tieneLineas) e.preventDefault();
                        }}
                      >
                        <IconWhatsApp className="h-8 w-8 shrink-0 text-white" />
                        Enviar pedido a {g.nombre} por WhatsApp
                      </a>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
