"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole, requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";

type Row = {
  id: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number | null;
  tipo: string | null;
  unidad: string | null;
  proveedor: null | {
    id: string;
    nombre: string;
    telefono_whatsapp: string | null;
  };
};

async function fetchProductos(establecimientoId: string | null): Promise<Row[]> {
  if (!establecimientoId) return [];
  const { data, error } = await supabase()
    .from("productos")
    .select("id,nombre,stock_actual,stock_minimo,tipo,unidad,proveedor:proveedores(id,nombre,telefono_whatsapp)")
    .eq("establecimiento_id", establecimientoId)
    .order("nombre", { ascending: true });
  if (error) throw error;
  return (data as unknown as Row[]) ?? [];
}

function waLink(p: Row, cantidad: number): string | null {
  const tel = p.proveedor?.telefono_whatsapp;
  if (!tel) return null;
  const prov = p.proveedor?.nombre ?? "Proveedor";
  const msg = `Hola ${prov}, necesito pedir ${cantidad} de ${p.nombre}.`;
  return `https://wa.me/${encodeURIComponent(tel)}?text=${encodeURIComponent(msg)}`;
}

export default function PedidoRapidoPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const { activeEstablishmentId } = useActiveEstablishment();

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
    let cancelled = false;
    setLoadingItems(true);
    fetchProductos(activeEstablishmentId ?? null)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, role]);

  const totals = useMemo(() => items.length, [items.length]);

  async function pedir(p: Row) {
    try {
      setErr(null);
      if (!activeEstablishmentId) {
        setErr("No hay establecimiento activo.");
        return;
      }
      const cantidad = qty[p.id] ?? 0;
      if (!cantidad || cantidad < 1) return;
      const link = waLink(p, cantidad);
      if (!link) {
        setErr(`El proveedor de "${p.nombre}" no tiene teléfono WhatsApp.`);
        return;
      }

      // Registrar movimiento "pedido"
      const usuario_id = await requireUserId();
      const { error } = await supabase().from("movimientos").insert({
        producto_id: p.id,
        establecimiento_id: activeEstablishmentId,
        tipo: "pedido",
        cantidad,
        usuario_id,
        timestamp: new Date().toISOString()
      });
      if (error) {
        setErr(error.message);
        return;
      }

      window.open(link, "_blank", "noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (err) {
    // sigue renderizando lista si hay items
  }

  if (role !== "admin" && role !== "superadmin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Pedido rápido (Admin)</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Pedido rápido" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl bg-slate-50 p-4 pb-28 text-slate-900">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pedido rápido</h1>
          <p className="text-sm text-slate-600">{totals} productos</p>
        </div>
      </div>

      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      {!activeEstablishmentId ? (
        <p className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          No hay establecimiento activo. Selecciona uno para cargar productos.
        </p>
      ) : null}

      {loadingItems ? <p className="mb-3 text-sm text-slate-600">Cargando productos…</p> : null}

      <div className="space-y-2">
        {items.map((p) => {
          const isLow =
            typeof p.stock_minimo === "number" &&
            Number.isFinite(p.stock_minimo) &&
            p.stock_actual < p.stock_minimo;
          return (
            <div
              key={p.id}
              className={[
                "rounded-3xl border bg-white p-4 shadow-sm",
                isLow ? "border-red-200" : "border-slate-200"
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{p.nombre}</p>
                    {isLow ? (
                      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-100">
                        Bajo mínimo
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                        OK
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {p.tipo ?? "—"} · {p.unidad ?? "—"} · Stock:{" "}
                    <span className="font-mono">{p.stock_actual}</span> · Mín:{" "}
                    <span className="font-mono">{p.stock_minimo ?? "—"}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Proveedor: {p.proveedor?.nombre ?? "—"}{" "}
                    {p.proveedor?.telefono_whatsapp ? "" : "(sin WhatsApp)"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <input
                    className="min-h-12 w-24 rounded-2xl border border-slate-200 bg-white px-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                    inputMode="numeric"
                    type="number"
                    min={0}
                    value={qty[p.id] ?? 0}
                    onChange={(e) => {
                      const raw = e.currentTarget.value;
                      const next = raw === "" ? 0 : Number(raw);
                      setQty((prev) => ({ ...prev, [p.id]: Number.isFinite(next) ? next : 0 }));
                    }}
                  />
                  <Button
                    onClick={() => pedir(p)}
                    disabled={!p.proveedor?.telefono_whatsapp || (qty[p.id] ?? 0) < 1}
                    className="bg-black hover:bg-slate-900 active:bg-slate-950"
                  >
                    WhatsApp
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </main>
    </div>
  );
}

