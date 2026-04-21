"use client";

import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/Button";
import { getBaseUrl } from "@/lib/baseUrl";

export default function QrProductPage({ params }: { params: { id: string } }) {
  const base = getBaseUrl();
  const url = `${base}/p/${encodeURIComponent(params.id)}`;

  return (
    <main className="mx-auto max-w-md bg-slate-50 p-4 pb-28 text-slate-900">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="no-print mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">QR del producto</h1>
          <p className="text-sm text-slate-600">Este QR abre la ficha para mover stock.</p>
        </div>
        <Button onClick={() => window.print()}>Imprimir</Button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-center">
          <QRCodeSVG value={url} width={260} height={260} includeMargin />
        </div>
        <p className="mt-3 break-all text-xs text-slate-500">{url}</p>
      </div>
    </main>
  );
}

