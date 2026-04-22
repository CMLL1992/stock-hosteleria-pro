"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { MobileHeader } from "@/components/MobileHeader";
import { enqueueMovimiento } from "@/lib/offlineQueue";
import { newClientUuid } from "@/lib/offlineQueue";
import { requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";

type Producto = {
  id: string;
  articulo: string;
  stock_actual: number;
  stock_vacios?: number;
  stock_minimo: number | null;
  qr_code_uid: string;
  proveedor: null | {
    id: string;
    nombre: string;
    telefono_whatsapp: string | null;
  };
};

function normalizeWhatsAppPhone(input: string): string {
  // wa.me requiere dígitos, sin +, espacios ni símbolos.
  // Aceptamos números con + o con separadores y los normalizamos.
  const trimmed = input.trim();
  // Convierte prefijo 00xx -> xx
  const normalizedPrefix = trimmed.startsWith("00") ? trimmed.slice(2) : trimmed;
  const digits = normalizedPrefix.replace(/\D/g, "");
  return digits;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function fetchProducto(idOrUid: string, establecimientoId: string | null): Promise<Producto | null> {
  if (!establecimientoId) return null;
  const col = await resolveProductoTituloColumn(establecimientoId);
  const t = tituloColSql(col);
  const { data, error } = await supabase()
    .from("productos")
    .select(`id,${t},stock_actual,stock_vacios,stock_minimo,qr_code_uid,proveedor:proveedores(id,nombre,telefono_whatsapp)` as "*")
    .eq(isUuid(idOrUid) ? "id" : "qr_code_uid", idOrUid)
    .eq("establecimiento_id", establecimientoId)
    .maybeSingle();
  if (error) throw error;
  const raw = data as unknown as Record<string, unknown> | null;
  if (!raw) return null;
  return {
    id: String(raw.id ?? ""),
    articulo: String(raw.articulo ?? raw.nombre ?? "").trim() || "—",
    stock_actual: Number(raw.stock_actual ?? 0) || 0,
    stock_vacios: Number(raw.stock_vacios ?? 0) || 0,
    stock_minimo: raw.stock_minimo != null ? Number(raw.stock_minimo) : null,
    qr_code_uid: String(raw.qr_code_uid ?? ""),
    proveedor: raw.proveedor as Producto["proveedor"]
  };
}

async function createMovimientoOnline(input: {
  client_uuid: string;
  producto_id: string;
  establecimiento_id: string;
  tipo: "entrada" | "salida" | "pedido" | "salida_barra" | "entrada_vacio" | "devolucion_proveedor";
  cantidad: number;
  usuario_id: string;
  timestamp: string;
  genera_vacio?: boolean;
}) {
  const { error } = await supabase().from("movimientos").upsert(input, { onConflict: "client_uuid", ignoreDuplicates: true });
  if (error) throw error;
}

export function ProductByUidClient({ uid }: { uid: string }) {
  const { activeEstablishmentId, meLoading, isSuperadmin, establishmentsLoading } = useActiveEstablishment();
  const [producto, setProducto] = useState<Producto | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [modo, setModo] = useState<"entrada" | "salida" | "devolucion_proveedor">("entrada");
  const [cantidad, setCantidad] = useState<number>(0);
  const qtyRef = useRef<HTMLInputElement | null>(null);
  const [saved, setSaved] = useState(false);

  const [movOpen, setMovOpen] = useState(false);
  const [pedidoOpen, setPedidoOpen] = useState(false);
  const [pedidoCantidad, setPedidoCantidad] = useState<number>(1);

  useEffect(() => {
    let cancelled = false;

    if (meLoading) {
      setLoading(true);
      setErr(null);
      return;
    }

    if (isSuperadmin && establishmentsLoading) {
      setLoading(true);
      setErr(null);
      return;
    }

    if (!activeEstablishmentId) {
      setLoading(false);
      setProducto(null);
      setErr("No hay establecimiento activo. Selecciona un establecimiento o revisa el perfil.");
      return;
    }

    setLoading(true);
    setErr(null);
    setProducto(null);
    setMovOpen(false);

    fetchProducto(uid, activeEstablishmentId)
      .then((p) => {
        if (cancelled) return;
        setProducto(p);
        if (p) setMovOpen(true);
        else setMovOpen(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setProducto(null);
        setMovOpen(false);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, establishmentsLoading, isSuperadmin, meLoading, uid]);

  useEffect(() => {
    if (loading) return;
    if (!producto) return;
    if (!movOpen) return;
    // iOS: el teclado suele abrir mejor si el foco ocurre justo tras mostrar el drawer.
    const t = window.setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 80);
    return () => window.clearTimeout(t);
  }, [loading, producto, movOpen]);

  const waLink = useMemo(() => {
    const tel = producto?.proveedor?.telefono_whatsapp;
    if (!tel) return null;
    const phone = normalizeWhatsAppPhone(tel);
    if (!phone) return null;
    const prov = producto?.proveedor?.nombre ?? "Proveedor";
    const prod = producto?.articulo ?? "Producto";
    const msg = `Hola ${prov}, necesito pedir ${pedidoCantidad} de ${prod}.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }, [pedidoCantidad, producto?.articulo, producto?.proveedor?.nombre, producto?.proveedor?.telefono_whatsapp]);

  async function registrar(
    tipo: "entrada" | "salida" | "pedido" | "salida_barra" | "entrada_vacio" | "devolucion_proveedor",
    cantidadMovimiento: number,
    opts?: { genera_vacio?: boolean }
  ) {
    if (!producto) return;
    if (!activeEstablishmentId) {
      setErr("No hay establecimiento activo.");
      return;
    }
    const usuario_id = await requireUserId();
    const payload = {
      client_uuid: newClientUuid(),
      producto_id: producto.id,
      establecimiento_id: activeEstablishmentId,
      tipo,
      cantidad: cantidadMovimiento,
      usuario_id,
      timestamp: new Date().toISOString(),
      ...(opts?.genera_vacio !== undefined ? { genera_vacio: opts.genera_vacio } : {})
    };
    try {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        await createMovimientoOnline(payload);
      } else {
        await enqueueMovimiento(payload);
      }
      // refresco sencillo
      setProducto(await fetchProducto(uid, activeEstablishmentId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Stock" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
      {saved ? (
        <div className="mb-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
          Guardado ✓
        </div>
      ) : null}
      {loading ? <p className="text-sm text-gray-600">Cargando…</p> : null}
      {err ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      {!loading && !producto ? (
        <p className="text-sm text-gray-600">Producto no encontrado.</p>
      ) : null}

      {producto ? (
        <section className="space-y-4 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-gray-500">Producto</p>
            <p className="text-lg font-semibold text-gray-900">{producto.articulo}</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500">Stock actual</p>
              <p className="text-2xl font-semibold tabular-nums text-gray-900">{producto.stock_actual}</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500">Vacíos</p>
              <p className="text-2xl font-semibold tabular-nums text-gray-900">{producto.stock_vacios ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500">Mínimo</p>
              <p className="text-2xl font-semibold tabular-nums text-gray-900">
                {producto.stock_minimo ?? "—"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => { setModo("entrada"); setMovOpen(true); }} className="bg-slate-900 hover:bg-slate-950">
                Entrada
              </Button>
              <Button
                onClick={() => {
                  setModo("salida");
                  setMovOpen(true);
                }}
                className="bg-slate-900 hover:bg-slate-950"
              >
                A barra
              </Button>
              <Button
                onClick={async () => {
                  setErr(null);
                  setCantidad(1);
                  setSaved(false);
                  setModo("devolucion_proveedor");
                  setMovOpen(true);
                }}
                className="bg-slate-900 hover:bg-slate-950"
              >
                Devolver vacío
              </Button>
            </div>
            <Button
              onClick={() => setMovOpen(true)}
            >
              Añadir movimiento
            </Button>
            <Button
              onClick={() => {
                setPedidoCantidad(1);
                setPedidoOpen(true);
              }}
              className="bg-green-600 hover:bg-green-700 active:bg-green-800"
            >
              Realizar pedido (WhatsApp)
            </Button>
            {!producto.proveedor?.telefono_whatsapp ? (
              <p className="text-xs text-gray-500">
                Este producto no tiene teléfono de WhatsApp configurado.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <Drawer
        open={movOpen}
        title="Movimiento"
        onClose={() => {
          setMovOpen(false);
        }}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <button
              className={[
                "min-h-12 rounded-2xl border px-3 text-sm font-semibold",
                modo === "entrada" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-100 bg-white text-gray-700"
              ].join(" ")}
              onClick={() => setModo("entrada")}
            >
              Entrada
            </button>
            <button
              className={[
                "min-h-12 rounded-2xl border px-3 text-sm font-semibold",
                modo === "salida" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-100 bg-white text-gray-700"
              ].join(" ")}
              onClick={() => setModo("salida")}
            >
              A barra
            </button>
            <button
              className={[
                "min-h-12 rounded-2xl border px-3 text-sm font-semibold",
                modo === "devolucion_proveedor" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-100 bg-white text-gray-700"
              ].join(" ")}
              onClick={() => setModo("devolucion_proveedor")}
            >
              Devolver vacío
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-900">
              Cantidad
            </label>
            <input
              className="min-h-12 w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 text-base"
              inputMode="numeric"
              type="number"
              step={1}
              value={cantidad}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCantidad(Number(e.currentTarget.value))}
              onFocus={(e) => e.currentTarget.select()}
              ref={qtyRef}
            />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <Button
              onClick={async () => {
                const n = Number(cantidad);
                if (!Number.isFinite(n) || n === 0) return;
                setSaved(false);
                if (modo === "entrada") {
                  await registrar("entrada", Math.abs(n));
                  setSaved(true);
                  window.setTimeout(() => setSaved(false), 1200);
                  return;
                }
                if (modo === "salida") {
                  await registrar("salida_barra", Math.abs(n), { genera_vacio: true });
                  setSaved(true);
                  window.setTimeout(() => setSaved(false), 1200);
                  return;
                }
                await registrar("devolucion_proveedor", Math.abs(n));
                setSaved(true);
                window.setTimeout(() => setSaved(false), 1200);
              }}
            >
              Confirmar movimiento
            </Button>
            <Button onClick={() => setMovOpen(false)} className="bg-white text-gray-900 hover:bg-gray-50 active:bg-gray-100">
              Cerrar
            </Button>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={pedidoOpen}
        title="Realizar pedido"
        onClose={() => {
          setPedidoOpen(false);
        }}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">¿Qué cantidad quieres pedir por WhatsApp?</p>
          <input
            className="min-h-12 w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 text-base"
            inputMode="numeric"
            type="number"
            min={1}
            value={pedidoCantidad}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPedidoCantidad(Number(e.currentTarget.value))}
          />
          <div className="grid grid-cols-1 gap-2">
            <Button
              onClick={async () => {
                try {
                  await registrar("pedido", pedidoCantidad);
                  setPedidoOpen(false);
                  if (waLink) window.open(waLink, "_blank", "noreferrer");
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                }
              }}
              disabled={!pedidoCantidad || pedidoCantidad < 1 || !producto?.proveedor?.telefono_whatsapp}
              className="bg-green-600 hover:bg-green-700 active:bg-green-800"
            >
              Confirmar y abrir WhatsApp
            </Button>
            <Button onClick={() => setPedidoOpen(false)} className="bg-white text-gray-900 hover:bg-gray-50 active:bg-gray-100">
              Cancelar
            </Button>
          </div>
        </div>
      </Drawer>
    </main>
    </div>
  );
}

