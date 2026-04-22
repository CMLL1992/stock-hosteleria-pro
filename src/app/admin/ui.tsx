"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { MobileHeader } from "@/components/MobileHeader";
import { useMyRole } from "@/lib/useMyRole";

type AdminNavItem = {
  id: string;
  href: string;
  title: string;
  subtitle: string;
  /** Solo superadmin (establecimientos, usuarios del tenant global, etc.) */
  superadminOnly?: boolean;
};

type AdminSection = {
  id: string;
  heading: string;
  items: AdminNavItem[];
};

const SECTIONS: AdminSection[] = [
  {
    id: "institucional",
    heading: "Institucional y accesos",
    items: [
      {
        id: "establecimientos",
        href: "/admin/clientes",
        title: "Establecimientos",
        subtitle: "Gestionar locales y sedes.",
        superadminOnly: true
      },
      {
        id: "usuarios",
        href: "/admin/users",
        title: "Usuarios",
        subtitle: "Control de personal y accesos.",
        superadminOnly: true
      },
      {
        id: "roles",
        href: "/superadmin/roles",
        title: "Roles",
        subtitle: "Superadmin, Admin y Staff en un solo lugar.",
        superadminOnly: true
      }
    ]
  },
  {
    id: "catalogo",
    heading: "Catálogo e inventario",
    items: [
      {
        id: "productos",
        href: "/admin/productos",
        title: "Productos",
        subtitle: "Listado maestro y edición (clave artículo)."
      },
      {
        id: "importar-csv",
        href: "/admin/importar-csv",
        title: "Importar CSV",
        subtitle: "Carga masiva con validador (;)."
      },
      {
        id: "escandallos",
        href: "/admin/escandallos",
        title: "Escandallos",
        subtitle: "Gestión de recetas y costes."
      }
    ]
  },
  {
    id: "operaciones",
    heading: "Operaciones y movimientos",
    items: [
      {
        id: "pedidos",
        href: "/admin/pedidos",
        title: "Pedidos",
        subtitle: "Pedidos agrupados por proveedor y WhatsApp."
      },
      {
        id: "proveedores",
        href: "/admin/proveedores",
        title: "Proveedores",
        subtitle: "Directorio de contactos y pedidos."
      },
      {
        id: "movimientos",
        href: "/admin/movimientos",
        title: "Movimientos",
        subtitle: "Histórico de entradas y salidas de stock."
      }
    ]
  }
];

function filterSections(sections: AdminSection[], isSuperadmin: boolean): AdminSection[] {
  return sections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter((it) => (it.superadminOnly ? isSuperadmin : true))
    }))
    .filter((sec) => sec.items.length > 0);
}

export function AdminHomeClient() {
  const { data, isLoading, error } = useMyRole();
  const searchParams = useSearchParams();
  const denied = searchParams.get("denied");

  const content = useMemo(() => {
    if (isLoading) return <p className="px-1 text-sm text-slate-600">Cargando…</p>;
    if (data?.role === null && !data?.profileReady) return <p className="px-1 text-sm text-slate-600">Cargando perfil…</p>;
    if (error) {
      return (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {(error as Error).message}
        </p>
      );
    }
    if (!data?.isAdmin) {
      return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Acceso denegado</p>
          <p className="mt-1 text-sm text-slate-600">Esta sección es solo para administradores.</p>
        </div>
      );
    }

    const visible = filterSections(SECTIONS, !!data.isSuperadmin);

    return (
      <div className="space-y-6">
        {denied ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">
            Acceso denegado.
          </div>
        ) : null}
        <header className="px-1">
          <h1 className="text-lg font-semibold text-slate-900">Panel de control</h1>
          <p className="mt-0.5 text-sm text-slate-500">Menú de administración por áreas.</p>
        </header>

        {visible.map((section) => (
          <section key={section.id} className="space-y-2">
            <h2 className="px-1 text-sm font-bold tracking-tight text-slate-900">{section.heading}</h2>
            <div className="w-full max-w-full overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
              {section.items.map((item, idx) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className={[
                    "flex w-full min-h-[56px] max-w-full items-center gap-3 px-4 py-3 transition",
                    "hover:bg-slate-50 hover:pl-5",
                    idx < section.items.length - 1 ? "border-b border-slate-100" : ""
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-snug text-slate-500">{item.subtitle}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" aria-hidden strokeWidth={2} />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }, [data?.isAdmin, data?.isSuperadmin, data?.profileReady, data?.role, denied, error, isLoading]);

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Admin" />
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 pb-28">{content}</main>
    </div>
  );
}
