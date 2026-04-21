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
    title: "📦 Gestión de Stock",
    emoji: "📦",
    links: [
      { href: "/admin/dashboard", title: "Dashboard operativo", subtitle: "Alertas y reposición" },
      { href: "/admin/productos", title: "Gestión de Productos", subtitle: "Catálogo completo" },
      { href: "/admin/importar-csv", title: "Importar CSV", subtitle: "Alta/actualización masiva" },
      { href: "/admin/escandallos", title: "Escandallos", subtitle: "Finanzas (si aplica)" }
    ]
  },
  {
    title: "🤝 Operaciones",
    emoji: "🤝",
    links: [
      { href: "/admin/proveedores", title: "Gestionar Proveedores", subtitle: "Listado y edición" },
      { href: "/admin/pedido-rapido", title: "Pedido Rápido", subtitle: "Pedir por WhatsApp" }
    ]
  },
  {
    title: "⚙️ Configuración",
    emoji: "⚙️",
    links: [
      { href: "/admin/etiquetas", title: "Etiquetas", subtitle: "Clasificación y filtros" },
      { href: "/admin/users", title: "Usuarios", subtitle: "Altas y permisos (Superadmin)" },
      { href: "/admin/clientes", title: "Clientes", subtitle: "Gestión (Superadmin)" }
    ]
  }
];

function iconColorFor(href: string): string {
  if (href.includes("importar-csv")) return "bg-indigo-50 text-indigo-700 ring-indigo-100";
  if (href.includes("productos")) return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (href.includes("escandallos")) return "bg-slate-50 text-slate-700 ring-slate-200";
  if (href.includes("pedido-rapido")) return "bg-amber-50 text-amber-800 ring-amber-100";
  if (href.includes("proveedores")) return "bg-cyan-50 text-cyan-700 ring-cyan-100";
  if (href.includes("users")) return "bg-rose-50 text-rose-700 ring-rose-100";
  if (href.includes("clientes")) return "bg-violet-50 text-violet-700 ring-violet-100";
  if (href.includes("etiquetas")) return "bg-slate-50 text-slate-700 ring-slate-200";
  if (href.includes("dashboard")) return "bg-blue-50 text-blue-700 ring-blue-100";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

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
          <p className="text-sm font-semibold text-slate-900">Admin</p>
          <p className="mt-1 text-sm text-slate-600">Accesos rápidos, agrupados por área.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.title} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-lg" aria-hidden>
                  {cat.emoji}
                </span>
                <p className="text-sm font-semibold text-slate-900">{cat.title}</p>
              </div>

              <div className="space-y-2">
                {cat.links
                  .filter((l) =>
                    l.href === "/admin/users" || l.href === "/admin/clientes" ? !!data?.isSuperadmin : true
                  )
                  .map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    className="group block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition duration-200 hover:bg-slate-50 hover:shadow-md hover:scale-[1.02] active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={[
                            "grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1",
                            iconColorFor(l.href)
                          ].join(" ")}
                          aria-hidden
                        >
                          →
                        </span>
                        <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{l.title}</p>
                        {l.subtitle ? (
                          <p className="mt-0.5 truncate text-xs text-slate-600">{l.subtitle}</p>
                        ) : null}
                        </div>
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

