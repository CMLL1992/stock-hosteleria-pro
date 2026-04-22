"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useMyRole } from "@/lib/useMyRole";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useMyRole();

  if (isLoading) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-700">
        <p className="text-sm">Cargando…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {(error as Error).message}
        </p>
      </main>
    );
  }

  if (!data?.isAdmin && !data?.isSuperadmin) {
    return (
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
          Acceso denegado.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/stock" className="font-semibold text-slate-900 underline">
            Ir a stock
          </Link>
        </p>
      </main>
    );
  }

  return <>{children}</>;
}

