"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function StockError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
      <main className="mx-auto max-w-md">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <h1 className="text-lg font-semibold">No se pudo abrir Stock</h1>
          <p className="mt-2 text-sm text-slate-600">
            Si has llegado aquí tras escanear un QR, asegúrate de haber iniciado sesión en este dispositivo. Puedes reintentar
            o volver al inicio.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="min-h-12 w-full rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-950"
            >
              Reintentar
            </button>
            <Link
              href="/login"
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Ir a login
            </Link>
            <Link
              href="/"
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Volver a inicio
            </Link>
          </div>
          <p className="mt-4 break-words text-xs text-slate-500">{error?.message || "Error desconocido"}</p>
          {error?.stack ? (
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700">
              {error.stack}
            </pre>
          ) : null}
          {error?.digest ? <p className="mt-2 text-xs text-slate-500">Código: {error.digest}</p> : null}
        </div>
      </main>
    </div>
  );
}

