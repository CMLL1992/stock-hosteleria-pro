"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/Button";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { getBaseUrl } from "@/lib/baseUrl";

type ProductoRow = {
  id: string;
  nombre: string;
  proveedor_id: string | null;
};

async function loadProductos(): Promise<ProductoRow[]> {
  const { data, error } = await supabase()
    .from("productos")
    .select("id,nombre,proveedor_id")
    .order("nombre", { ascending: true });
  if (error) throw error;
  return (data as unknown as ProductoRow[]) ?? [];
}

export default function AdminEtiquetasPage() {
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [items, setItems] = useState<ProductoRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    setErr(null);
    loadProductos()
      .then((p) => {
        if (cancelled) return;
        setItems(p);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const origin = useMemo(() => getBaseUrl(), []);

  if (loading) return <main className="p-4 text-sm text-zinc-600 dark:text-zinc-300">Cargando…</main>;

  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Etiquetas (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="no-print mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Generación de etiquetas</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Imprime desde el navegador. Cada QR apunta a la ficha del producto.
          </p>
        </div>
        <Button onClick={() => window.print()}>Imprimir</Button>
      </div>

      {err ? (
        <p className="no-print mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((p) => {
          const url = `${origin}/p/${encodeURIComponent(p.id)}`;
          return (
            <div key={p.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center justify-center">
                    <QRCodeSVG value={url} width={160} height={160} includeMargin />
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-medium">{p.nombre}</p>
              <p className="mt-1 break-all text-[10px] text-zinc-500">{p.id}</p>
            </div>
          );
        })}
      </div>
    </main>
  );
}

