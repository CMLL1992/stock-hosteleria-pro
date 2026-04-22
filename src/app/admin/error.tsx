"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AdminError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Dejamos trazas en consola para soporte, pero UX controlada.
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
      <main className="mx-auto max-w-md">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <h1 className="text-lg font-semibold">Ha ocurrido un error</h1>
          <p className="mt-2 text-sm text-slate-600">
            No se pudo cargar esta sección del panel. Puedes reintentar o volver al inicio.
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
              href="/"
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Volver a inicio
            </Link>
          </div>
          {error?.digest ? <p className="mt-4 text-xs text-slate-500">Código: {error.digest}</p> : null}
        </div>
      </main>
    </div>
  );
}

