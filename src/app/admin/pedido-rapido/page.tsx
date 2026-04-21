"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { fetchMyRole, requireUserId } from "@/lib/session";
import { supabase } from "@/lib/supabase";

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

async function fetchProductos(): Promise<Row[]> {
  const { data, error } = await supabase()
    .from("productos")
    .select("id,nombre,stock_actual,stock_minimo,tipo,unidad,proveedor:proveedores(id,nombre,telefono_whatsapp)")
    .order("nombre", { ascending: true });
  if (error) throw error;
  return (data as unknown as Row[]) ?? [];
}

function waLink(p: Row, cantidad: number): string | null {
  const tel = p.proveedor?.telefono_whatsapp;
  if (!tel) return null;
  const prov = p.proveedor?.nombre ?? "Proveedor";
  const msg = `Hola ${prov}, soy del establecimiento. Necesito un pedido de ${p.nombre}. Cantidad: ${cantidad}. ¡Gracias!`;
  return `https://wa.me/${encodeURIComponent(tel)}?text=${encodeURIComponent(msg)}`;
}

export default function PedidoRapidoPage() {
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});

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
    if (role !== "admin") return;
    let cancelled = false;
    fetchProductos()
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const totals = useMemo(() => items.length, [items.length]);

  async function pedir(p: Row) {
    setErr(null);
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
  }

  if (loading) return <main className="p-4 text-sm text-zinc-600 dark:text-zinc-300">Cargando…</main>;
  if (err) {
    // sigue renderizando lista si hay items
  }

  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Pedido rápido (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pedido rápido</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{totals} productos</p>
        </div>
        <a className="text-sm text-zinc-600 underline dark:text-zinc-300" href="/admin">
          Volver
        </a>
      </div>

      {err ? (
        <p className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </p>
      ) : null}

      <div className="space-y-2">
        {items.map((p) => {
          const isLow =
            typeof p.stock_minimo === "number" &&
            Number.isFinite(p.stock_minimo) &&
            p.stock_actual < p.stock_minimo;
          return (
            <div
              key={p.id}
              className={
                isLow
                  ? "rounded-xl border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
                  : "rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.nombre}</p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">
                    {p.tipo ?? "—"} · {p.unidad ?? "—"} · Stock:{" "}
                    <span className="font-mono">{p.stock_actual}</span> · Mín:{" "}
                    <span className="font-mono">{p.stock_minimo ?? "—"}</span>
                  </p>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                    Proveedor: {p.proveedor?.nombre ?? "—"}{" "}
                    {p.proveedor?.telefono_whatsapp ? "" : "(sin WhatsApp)"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <input
                    className="min-h-12 w-24 rounded-xl border border-zinc-200 bg-white px-3 text-base dark:border-zinc-800 dark:bg-zinc-950"
                    inputMode="numeric"
                    type="number"
                    min={0}
                    value={qty[p.id] ?? 0}
                    onChange={(e) => setQty((prev) => ({ ...prev, [p.id]: Number(e.currentTarget.value) }))}
                  />
                  <Button
                    onClick={() => pedir(p)}
                    disabled={!p.proveedor?.telefono_whatsapp || (qty[p.id] ?? 0) < 1}
                    className="bg-green-600 hover:bg-green-700 active:bg-green-800 dark:bg-green-600 dark:text-white"
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
  );
}

