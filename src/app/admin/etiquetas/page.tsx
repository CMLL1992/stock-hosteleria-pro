"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { getBaseUrl } from "@/lib/baseUrl";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { hasPermission } from "@/lib/permissions";

type ProductoRow = {
  id: string;
  articulo: string;
  proveedor_id: string | null;
};

async function loadProductos(establecimientoId: string | null): Promise<ProductoRow[]> {
  if (!establecimientoId) return [];
  const col = await resolveProductoTituloColumn(establecimientoId);
  const t = tituloColSql(col);
  const { data, error } = await supabase()
    .from("productos")
    .select(`id,${t},proveedor_id` as "*")
    .eq("establecimiento_id", establecimientoId)
    .order(t, { ascending: true });
  if (error) throw error;
  return (
    ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: String(r.id ?? ""),
      articulo: String(r.articulo ?? r.nombre ?? "").trim() || "—",
      proveedor_id: r.proveedor_id != null ? String(r.proveedor_id) : null
    })) ?? []
  );
}

export default function AdminEtiquetasPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const canManage = hasPermission(role, "admin");
  const [items, setItems] = useState<ProductoRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    if (!canManage) return;
    let cancelled = false;
    setErr(null);
    loadProductos(activeEstablishmentId ?? null)
      .then((p) => {
        if (cancelled) return;
        setItems(p);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(supabaseErrToString(e));
      });
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, canManage]);

  const origin = useMemo(() => getBaseUrl(), []);

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;

  if (!canManage) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Etiquetas (Admin)</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Etiquetas" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl bg-slate-50 p-4 pb-28 text-slate-900">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="no-print mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Generación de etiquetas</h1>
          <p className="text-sm text-slate-600">
            Imprime desde el navegador. Cada QR apunta a la ficha del producto.
          </p>
        </div>
        <Button onClick={() => window.print()}>Imprimir</Button>
      </div>

      {err ? (
        <p className="no-print mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((p) => {
          const url = `${origin}/p/${encodeURIComponent(p.id)}`;
          return (
            <div key={p.id} className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-center">
                    <QRCodeSVG value={url} width={160} height={160} includeMargin />
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900">{p.articulo}</p>
              <p className="mt-1 break-all text-[10px] text-slate-500">{p.id}</p>
            </div>
          );
        })}
      </div>
      </main>
    </div>
  );
}

