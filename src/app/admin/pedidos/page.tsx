"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { IconWhatsApp } from "@/components/IconWhatsApp";
import { waUrlPedidoAgrupadoProveedor } from "@/lib/whatsappPedido";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { requireUserId } from "@/lib/session";
import { enqueueMovimiento, newClientUuid } from "@/lib/offlineQueue";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { Search } from "lucide-react";
import Link from "next/link";

type ProveedorRow = {
  id: string;
  nombre: string;
  telefono_whatsapp: string | null;
};

type ProductoPedido = {
  id: string;
  articulo: string;
  unidad: string | null;
  proveedor_id: string | null;
  categoria: string | null;
};

function parseQty(raw: string): number {
  // En móvil (iOS/Android) `type="number"` puede dar problemas con coma/teclado.
  // Parseamos de forma tolerante y nos quedamos con entero >= 0.
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const n = Math.trunc(Number(s));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function loadData(establecimientoId: string): Promise<{ proveedores: ProveedorRow[]; productos: ProductoPedido[] }> {
  const col = await resolveProductoTituloColumn(establecimientoId);
  const t = tituloColSql(col);
  const prodSelect = `id,${t},proveedor_id,unidad,categoria,proveedor:proveedores(nombre,telefono_whatsapp)`;

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
      unidad: r.unidad != null ? String(r.unidad) : null,
      proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null,
      categoria: r.categoria != null ? String(r.categoria) : null
    }));
    return { proveedores: (provRes.data as ProveedorRow[]) ?? [], productos };
  }

  const msg = (error.message ?? "").toLowerCase();
  const missing =
    msg.includes("proveedor") || msg.includes("relationship") || msg.includes("embed") || msg.includes("column");

  if (!missing) throw error;

  const fb = await supabase()
    .from("productos")
    .select(`id,${t},proveedor_id,unidad,categoria` as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });
  if (fb.error) throw fb.error;
  const productos = ((fb.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ""),
    articulo: String(r[t] ?? r.articulo ?? r.nombre ?? "").trim() || "—",
    unidad: r.unidad != null ? String(r.unidad) : null,
    proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null,
    categoria: r.categoria != null ? String(r.categoria) : null
  }));
  return { proveedores: (provRes.data as ProveedorRow[]) ?? [], productos };
}

function normCat(c: string | null | undefined): string {
  const s = String(c ?? "").trim();
  return s || "Otros";
}

function sortCats(a: string, b: string): number {
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

function normSearch(s: unknown): string {
  // Normaliza para búsquedas robustas: minúsculas + sin tildes (á->a) + trim.
  try {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}+/gu, "");
  } catch {
    return "";
  }
}

function readEvtValue(
  e: { currentTarget?: { value?: unknown }; target?: { value?: unknown } } | null | undefined
): string {
  try {
    const v = e?.currentTarget?.value ?? e?.target?.value;
    return typeof v === "string" ? v : String(v ?? "");
  } catch {
    return "";
  }
}

export default function PedidosPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const canAccessRecepcion = hasPermission(role, "staff");
  const canAccessPedidosAdmin = hasPermission(role, "admin");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const [productos, setProductos] = useState<ProductoPedido[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [search, setSearch] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);

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
      setErr(supabaseErrToString(e));
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
        if (!cancelled) setErr(supabaseErrToString(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canAccessRecepcion && !canAccessPedidosAdmin) return;
    refresh();
  }, [canAccessPedidosAdmin, canAccessRecepcion, refresh]);

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

  async function registrarComoPedido(
    proveedor: ProveedorRow,
    lineas: Array<{ producto_id: string; articulo: string; unidad: string | null; cantidad: number }>
  ) {
    if (!activeEstablishmentId) return;
    const ts = new Date().toISOString();
    const usuario_id = await requireUserId();

    // Seguimiento de pedido (cabecera + líneas) - aditivo.
    // Si la tabla no existe aún en Supabase, no interrumpimos el flujo actual.
    try {
      const { data: pedido, error: pErr } = await supabase()
        .from("pedidos")
        .insert({
          establecimiento_id: activeEstablishmentId,
          proveedor_id: proveedor.id,
          creado_por: usuario_id,
          estado: "pendiente"
        })
        .select("id")
        .maybeSingle();
      if (pErr) throw pErr;
      const pedidoId = String((pedido as { id?: unknown } | null)?.id ?? "");
      if (!pedidoId) return;
      const itemsPayload = lineas
        .filter((l) => l.cantidad > 0)
        .map((l) => ({
          pedido_id: pedidoId,
          establecimiento_id: activeEstablishmentId,
          producto_id: l.producto_id,
          cantidad_pedida: Math.max(0, Math.trunc(l.cantidad)),
          cantidad_recibida: 0,
          estado: "pendiente"
        }));
      if (itemsPayload.length) {
        const { error: iErr } = await supabase().from("pedido_items").insert(itemsPayload);
        if (iErr) throw iErr;
      }

      // Movimientos "pedido" después del registro (si fallan no bloquean el pedido ya creado).
      for (const l of lineas) {
        if (l.cantidad <= 0) continue;
        const payload = {
          client_uuid: newClientUuid(),
          producto_id: l.producto_id,
          establecimiento_id: activeEstablishmentId,
          tipo: "pedido" as const,
          cantidad: l.cantidad,
          usuario_id,
          timestamp: ts,
          proveedor_id: proveedor.id
        };
        try {
          if (typeof navigator !== "undefined" && navigator.onLine) {
            const { error } = await supabase()
              .from("movimientos")
              .upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
            if (error) throw error;
          } else {
            await enqueueMovimiento(payload);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canAccessRecepcion && !canAccessPedidosAdmin) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Pedidos</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Pedidos" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-xl font-semibold">Pedidos</h1>
          {canAccessRecepcion ? (
            <Link
              href="/admin/pedidos/recepcion"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-black px-4 text-sm font-semibold text-white hover:bg-slate-900"
            >
              Gestión de Recepción
            </Link>
          ) : null}
        </div>

        {err ? (
          <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}
        {loadingData ? <p className="text-sm text-slate-500">Cargando catálogo…</p> : null}

        {!canAccessPedidosAdmin ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            Preparación y envío por WhatsApp: solo Admin/Superadmin.
          </p>
        ) : null}

        {canAccessPedidosAdmin && !loadingData && productos.length === 0 && !err ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            No hay productos en este establecimiento.
          </p>
        ) : canAccessPedidosAdmin && !loadingData && grupos.length === 0 && !err ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            No hay productos agrupables por proveedor. Asigna un proveedor a cada artículo.
          </p>
        ) : canAccessPedidosAdmin ? (
          <ul className="flex flex-col gap-3">
            {grupos.map((g) => {
              const key = g.id;
              const expanded = !!open[key];
              const productosFiltrados = (() => {
                try {
                  const searchKey = normSearch(search[key]);
                  const base = Array.isArray(g.productos) ? g.productos : [];
                  if (!searchKey) return base;
                  return base.filter((p) => normSearch(p.articulo).includes(searchKey));
                } catch (e) {
                  // No permitimos que el filtrado rompa la UI completa (evita crash en producción).
                  void e;
                  return [];
                }
              })();
              const lineasWa = g.productos.map((p) => ({
                articulo: p.articulo,
                unidad: p.unidad,
                cantidad: parseQty(qty[p.id] ?? "")
              }));
              const urlWa = waUrlPedidoAgrupadoProveedor({
                nombreProveedor: g.nombre,
                telefonoWhatsapp: g.telefono_whatsapp,
                nombreEstablecimiento: nombreLocal,
                lineas: lineasWa
              });
              const tieneLineas = lineasWa.some((l) => l.cantidad > 0);

              const porCat = new Map<string, ProductoPedido[]>();
              for (const p of productosFiltrados) {
                const cat = normCat(p.categoria);
                porCat.set(cat, [...(porCat.get(cat) ?? []), p]);
              }
              const cats = Array.from(porCat.keys()).sort(sortCats);

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
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                        <input
                          type="search"
                          value={search[key] ?? ""}
                          onChange={(e) => setSearch((prev) => ({ ...prev, [key]: readEvtValue(e) }))}
                          placeholder="Buscar producto…"
                          className="min-h-12 w-full rounded-3xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                          aria-label="Buscar producto…"
                        />
                      </div>
                      <div className="space-y-4">
                        {cats.map((cat) => (
                          <section key={cat} className="space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{cat}</p>
                            <ul className="flex flex-col gap-4">
                              {(porCat.get(cat) ?? [])
                                .slice()
                                .sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }))
                                .map((p) => (
                                  <li key={p.id} className="flex items-center gap-3">
                                    <div className="min-w-0 flex-1">
                                      <p className="font-semibold leading-snug text-slate-900">{p.articulo}</p>
                                    </div>
                                    <label className="sr-only" htmlFor={`qty-${p.id}`}>
                                      Cantidad para {p.articulo}
                                    </label>
                                    <input
                                      id={`qty-${p.id}`}
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      placeholder="0"
                                      className="h-16 w-24 shrink-0 rounded-2xl border-2 border-slate-800 bg-white px-2 text-center text-3xl font-black tabular-nums text-slate-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-slate-300"
                                      value={qty[p.id] ?? ""}
                                      onChange={(e) => {
                                        const raw = readEvtValue(e);
                                        // Permitimos limpiar o escribir; guardamos solo dígitos para evitar estados inválidos.
                                        const cleaned = raw.replace(/[^\d]/g, "");
                                        setQty((prev) => ({ ...prev, [p.id]: cleaned }));
                                      }}
                                      min={0}
                                    />
                                  </li>
                                ))}
                            </ul>
                          </section>
                        ))}
                      </div>

                      <a
                        href={urlWa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={[
                          "inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl px-4 py-4 text-base font-bold text-white shadow-md transition",
                          tieneLineas ? "bg-emerald-500 hover:bg-emerald-600" : "pointer-events-none bg-slate-300"
                        ].join(" ")}
                        aria-disabled={!tieneLineas}
                        onClick={async (e) => {
                          if (!tieneLineas) {
                            e.preventDefault();
                            return;
                          }
                          e.preventDefault();
                          if (!activeEstablishmentId) return;
                          if (sending === g.id) return;
                          setSending(g.id);
                          setErr(null);
                          try {
                            const lineas = g.productos
                              .map((p) => ({
                                producto_id: p.id,
                                articulo: p.articulo,
                                unidad: p.unidad,
                                cantidad: parseQty(qty[p.id] ?? "")
                              }))
                              .filter((l) => l.cantidad > 0);

                            // Registrar ANTES de abrir WhatsApp (ID estable, sin popup).
                            await registrarComoPedido(
                              { id: g.id, nombre: g.nombre, telefono_whatsapp: g.telefono_whatsapp },
                              lineas
                            );

                            window.open(urlWa, "_blank", "noopener,noreferrer");
                          } catch (err) {
                            setErr(supabaseErrToString(err));
                          } finally {
                            setSending(null);
                          }
                        }}
                      >
                        <IconWhatsApp className="h-8 w-8 shrink-0 text-white" />
                        {sending === g.id ? "Registrando…" : `Enviar pedido a ${g.nombre} por WhatsApp`}
                      </a>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </main>

    </div>
  );
}
