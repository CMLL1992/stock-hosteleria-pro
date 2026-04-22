"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/Button";
import { getBaseUrl } from "@/lib/baseUrl";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

export default function QrProductPage({ params }: { params: { id: string } }) {
  const base = getBaseUrl();
  const url = `${base}/stock?id=${encodeURIComponent(params.id)}&scan=true`;
  const [nombre, setNombre] = useState<string>("Producto");
  const [err, setErr] = useState<string | null>(null);

  const shortName = useMemo(() => {
    const s = (nombre ?? "").trim() || "Producto";
    return s.length > 26 ? `${s.slice(0, 26).trim()}…` : s;
  }, [nombre]);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        // Compat: en algunas BD la columna es `articulo`, en otras `nombre`.
        // Probamos ambas sin romper la UI.
        const trySelect = async (sel: string) => {
          const res = await supabase().from("productos").select(sel).eq("id", params.id).maybeSingle();
          if (res.error) throw res.error;
          return (res.data ?? null) as Record<string, unknown> | null;
        };

        let row: Record<string, unknown> | null = null;
        try {
          row = await trySelect("articulo,nombre");
        } catch (e) {
          const msg = String((e as { message?: unknown })?.message ?? "").toLowerCase();
          if (msg.includes("column productos.articulo does not exist")) {
            row = await trySelect("nombre");
          } else if (msg.includes("column productos.nombre does not exist")) {
            row = await trySelect("articulo");
          } else {
            throw e;
          }
        }

        const titulo = String(row?.articulo ?? row?.nombre ?? "").trim();
        if (!cancelled && titulo) setNombre(titulo);
      } catch (e) {
        if (cancelled) return;
        setErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <main className="mx-auto max-w-md bg-slate-50 p-4 pb-28 text-slate-900">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { size: 58mm 40mm; margin: 0; }
          main { padding: 0 !important; }
        }
      `}</style>

      <div className="no-print mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">QR del producto</h1>
          <p className="text-sm text-slate-600">Este QR abre Stock y permite gestionar el producto.</p>
        </div>
        <Button onClick={() => window.print()}>Imprimir</Button>
      </div>

      {err ? (
        <p className="no-print mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-center">
          <QRCodeSVG value={url} width={180} height={180} includeMargin />
        </div>
        <p className="mt-2 text-center text-sm font-bold tracking-tight text-slate-900">{shortName}</p>
        <p className="no-print mt-2 break-all text-[11px] text-slate-500">{url}</p>
      </div>
    </main>
  );
}

