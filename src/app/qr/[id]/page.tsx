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
  const [autoPrintArmed, setAutoPrintArmed] = useState(false);

  const shortName = useMemo(() => {
    const s = (nombre ?? "").trim() || "Producto";
    // 50mm: evitamos cortes; dejamos una sola línea, centrada.
    return s.length > 30 ? `${s.slice(0, 30).trim()}…` : s;
  }, [nombre]);

  const shouldAutoPrint = useMemo(() => {
    if (typeof window === "undefined") return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("print") === "1";
  }, []);

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

  useEffect(() => {
    // Auto-print: solo cuando se abre con ?print=1.
    // Dejamos un pequeño delay para asegurar que el SVG se ha renderizado.
    if (!shouldAutoPrint) return;
    if (autoPrintArmed) return;
    setAutoPrintArmed(true);
    const t = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignore
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [autoPrintArmed, shouldAutoPrint]);

  return (
    <main className="mx-auto max-w-md bg-slate-50 p-4 pb-28 text-slate-900">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* 50mm típico de impresoras térmicas tipo KATASYMBOL T50M Pro */
          @page { size: 50mm auto; margin: 0; }
          main { padding: 0 !important; max-width: none !important; }
          .label { border: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
        }
      `}</style>

      <div className="no-print mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">QR del producto</h1>
          <p className="text-sm text-slate-600">Este QR abre Stock y permite gestionar el producto.</p>
        </div>
        <Button onClick={() => window.print()}>Reintentar impresión</Button>
      </div>

      {err ? (
        <p className="no-print mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
      ) : null}

      <div className="label rounded-2xl border border-slate-200 bg-white p-0 shadow-sm">
        <div
          className="mx-auto"
          style={{
            width: "50mm",
            paddingTop: "2.5mm",
            paddingBottom: "2.5mm",
            paddingLeft: "2mm",
            paddingRight: "2mm"
          }}
        >
          <div className="flex items-center justify-center">
            <QRCodeSVG
              value={url}
              width={180}
              height={180}
              includeMargin={false}
              fgColor="#000000"
              bgColor="#FFFFFF"
            />
          </div>
          <p
            className="mt-2 text-center font-bold tracking-tight text-slate-900"
            style={{ fontSize: "11pt", lineHeight: 1.1 }}
          >
            {shortName}
          </p>
          <p className="no-print mt-2 break-all text-[11px] text-slate-500">{url}</p>
        </div>
      </div>
    </main>
  );
}

