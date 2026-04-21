"use client";

import { useMemo } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { useMyRole } from "@/lib/useMyRole";

type AdminLink = {
  href: string;
  title: string;
  subtitle?: string;
};

const LINKS: AdminLink[] = [
  { href: "/admin/proveedores", title: "Gestionar proveedores" },
  { href: "/admin/proveedores/nuevo", title: "Crear proveedor" },
  { href: "/admin/productos/nuevo", title: "Crear producto" },
  { href: "/admin/escandallos", title: "Escandallos (Finanzas)" },
  { href: "/admin/etiquetas", title: "Gestión de etiquetas" },
  { href: "/admin/importar-csv", title: "Importar CSV" },
  { href: "/admin/pedido-rapido", title: "Pedido rápido" }
];

export function AdminHomeClient() {
  const { data, isLoading, error } = useMyRole();

  const content = useMemo(() => {
    if (isLoading) return <p className="text-sm text-slate-600">Cargando…</p>;
    if (error) {
      return (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {(error as Error).message}
        </p>
      );
    }
    if (!data?.isAdmin) {
      return (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Acceso denegado.</p>
          <p className="mt-1 text-sm text-slate-600">Esta sección es solo para administradores.</p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {LINKS.map((l) => (
          <a
            key={l.href}
            className="flex min-h-14 items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 shadow-sm hover:bg-slate-50"
            href={l.href}
          >
            <span className="text-sm font-semibold text-slate-900">{l.title}</span>
            <span className="text-sm text-slate-400">→</span>
          </a>
        ))}
      </div>
    );
  }, [data?.isAdmin, error, isLoading]);

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">{content}</main>
    </div>
  );
}

