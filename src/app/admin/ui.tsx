"use client";

import { useMemo } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { useMyRole } from "@/lib/useMyRole";

type AdminLink = {
  href: string;
  title: string;
  subtitle?: string;
};

type AdminCategory = {
  title: string;
  emoji: string;
  links: AdminLink[];
  superadminOnly?: boolean;
};

const CATEGORIES: AdminCategory[] = [
  {
    title: "Institucional y Accesos",
    emoji: "🏢",
    links: [{ href: "/admin", title: "Panel Admin", subtitle: "Accesos y atajos" }]
  },
  {
    title: "Establecimientos",
    emoji: "🏪",
    links: [{ href: "/admin/clientes", title: "Clientes", subtitle: "Gestión (Superadmin)" }],
    superadminOnly: true
  },
  {
    title: "Usuarios",
    emoji: "👥",
    links: [{ href: "/admin/users", title: "Usuarios", subtitle: "Altas y permisos (Superadmin)" }],
    superadminOnly: true
  },
  {
    title: "Roles",
    emoji: "🔐",
    links: [{ href: "/admin/users", title: "Roles y accesos", subtitle: "Gestiona permisos (Superadmin)" }],
    superadminOnly: true
  },
  {
    title: "Catálogo e Inventario",
    emoji: "📦",
    links: [
      { href: "/admin/productos", title: "Productos", subtitle: "Gestiona catálogo completo" },
      { href: "/admin/importar-csv", title: "Importar CSV", subtitle: "Alta/actualización masiva" },
      { href: "/admin/escandallos", title: "Escandallos", subtitle: "Finanzas (si aplica en tu BD)" },
      { href: "/admin/etiquetas", title: "Etiquetas", subtitle: "Clasificación y filtros" }
    ]
  },
  {
    title: "Operaciones y Movimientos",
    emoji: "🔄",
    links: [
      { href: "/admin/pedido-rapido", title: "Pedidos", subtitle: "Pedido rápido por WhatsApp" },
      { href: "/admin/proveedores", title: "Proveedores", subtitle: "Listado y edición" }
    ]
  }
];

export function AdminHomeClient() {
  const { data, isLoading, error } = useMyRole();

  const content = useMemo(() => {
    if (isLoading) return <p className="text-sm text-slate-600">Cargando…</p>;
    if (data?.role === null && !data?.profileReady) return <p className="text-sm text-slate-600">Cargando perfil…</p>;
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
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Panel de administración</p>
          <p className="mt-1 text-sm text-slate-600">
            Navegación agrupada por categorías para uso rápido en móvil.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.filter((c) => (c.superadminOnly ? !!data?.isSuperadmin : true)).map((cat) => (
            <div key={cat.title} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-lg" aria-hidden>
                  {cat.emoji}
                </span>
                <p className="text-sm font-semibold text-slate-900">{cat.title}</p>
              </div>

              <div className="space-y-2">
                {cat.links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    className="group block rounded-2xl border border-slate-200 bg-white p-3 transition shadow-sm hover:shadow-md hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{l.title}</p>
                        {l.subtitle ? (
                          <p className="mt-0.5 truncate text-xs text-slate-600">{l.subtitle}</p>
                        ) : null}
                      </div>
                      <span className="text-slate-400 group-hover:text-slate-600">→</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }, [data?.isAdmin, data?.isSuperadmin, data?.profileReady, data?.role, error, isLoading]);

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Admin" />
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 pb-28">{content}</main>
    </div>
  );
}

