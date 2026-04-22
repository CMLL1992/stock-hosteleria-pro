"use client";

import { useEffect } from "react";
import Link from "next/link";

function looksLikeChunkLoadError(msg: string): boolean {
  const m = (msg ?? "").toLowerCase();
  return m.includes("chunkloaderror") || (m.includes("loading chunk") && m.includes("failed"));
}

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
    const msg = error?.message ?? "";
    // Recuperación automática típica tras despliegues (caché/Service Worker)
    if (looksLikeChunkLoadError(msg)) {
      const t = window.setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          // ignore
        }
      }, 250);
      return () => window.clearTimeout(t);
    }
  }, [error]);

  const msg = error?.message || "Error desconocido";

  return (
    <div className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
      <main className="mx-auto max-w-md">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <h1 className="text-lg font-semibold">Ha ocurrido un error</h1>
          <p className="mt-2 text-sm text-slate-600">
            Si has llegado aquí tras escanear un QR, suele ser por caché antigua tras una actualización. Puedes reintentar o
            recargar la página.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="min-h-12 w-full rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-950"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Recargar
            </button>
            <Link
              href="/"
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Volver a inicio
            </Link>
          </div>
          <p className="mt-4 break-words text-xs text-slate-500">{msg}</p>
          {error?.digest ? <p className="mt-2 text-xs text-slate-500">Código: {error.digest}</p> : null}
        </div>
      </main>
    </div>
  );
}

