"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Boxes,
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Link as LinkIcon,
  Package,
  MapPin,
  Shield,
  ShoppingBag,
  Truck,
  Users
} from "lucide-react";
import { MobileHeader } from "@/components/MobileHeader";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

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

function itemIcon(id: string) {
  switch (id) {
    case "url-reservas":
      return LinkIcon;
    case "establecimientos":
      return Building2;
    case "usuarios":
      return Users;
    case "roles":
      return Shield;
    case "auditoria-albaranes":
      return ClipboardList;
    case "productos":
      return Package;
    case "catalogo-envases":
      return Boxes;
    case "importar-csv":
      return ClipboardList;
    case "escandallos":
      return ClipboardList;
    case "eventos":
      return CalendarDays;
    case "reservas":
      return MapPin;
    case "pedidos":
      return ShoppingBag;
    case "proveedores":
      return Truck;
    case "movimientos":
      return ClipboardList;
    default:
      return Package;
  }
}

function accentByIndex(i: number): { bar: string; bg: string; text: string } {
  // Paleta premium: azul / naranja / verde (sin clases dinámicas).
  if (i % 3 === 1) return { bar: "bg-premium-orange", bg: "bg-premium-orange/10", text: "text-premium-orange" };
  if (i % 3 === 2) return { bar: "bg-premium-green", bg: "bg-premium-green/10", text: "text-premium-green" };
  return { bar: "bg-premium-blue", bg: "bg-premium-blue/10", text: "text-premium-blue" };
}

const SECTIONS: AdminSection[] = [
  {
    id: "local",
    heading: "Establecimiento",
    items: [
      {
        id: "url-reservas",
        href: "/admin/establecimiento",
        title: "Enlace de reservas",
        subtitle: "Copiar URL pública y generar QR para mesas."
      }
    ]
  },
  {
    id: "institucional",
    heading: "Usuarios y accesos",
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
      },
      {
        id: "auditoria-albaranes",
        href: "/admin/control/albaranes",
        title: "Auditoría de albaranes",
        subtitle: "Control de costes y revisión semanal.",
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
        id: "catalogo-envases",
        href: "/admin/envases",
        title: "Catálogo de envases",
        subtitle: "Maestro de envases y coste real (por ID)."
      },
      {
        id: "importar-csv",
        href: "/admin/importar-csv",
        title: "Importar CSV",
        subtitle: "Carga masiva con validador (;).",
        superadminOnly: true
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
        id: "eventos",
        href: "/admin/eventos",
        title: "Eventos",
        subtitle: "Pedidos y control financiero independiente del establecimiento."
      },
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

export function AdminHomeClient({ denied }: { denied?: string | null } = {}) {
  const { data, isLoading, error } = useMyRole();

  const content = useMemo(() => {
    if (isLoading) return <p className="px-1 text-sm text-slate-600">Cargando…</p>;
    if (data?.role === null && !data?.profileReady) return <p className="px-1 text-sm text-slate-600">Cargando perfil…</p>;
    if (error) {
      return (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {supabaseErrToString(error)}
        </p>
      );
    }
    const role = getEffectiveRole(data ?? null);
    const isAdmin = hasPermission(role, "admin");
    if (!isAdmin) {
      return (
        <div className="space-y-4">
          <header className="px-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-slate-900">Panel de control</h1>
                <p className="mt-0.5 text-sm text-slate-500">Menú de administración por áreas.</p>
              </div>
            </div>
          </header>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Acceso denegado</p>
            <p className="mt-1 text-sm text-slate-600">Esta sección es solo para administradores.</p>
          </div>
        </div>
      );
    }

    const visible = filterSections(SECTIONS, !!data?.isSuperadmin);

    return (
      <div className="space-y-6">
        {denied ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">
            Acceso denegado.
          </div>
        ) : null}
        <header className="px-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Panel de control</h1>
              <p className="mt-0.5 text-sm text-slate-500">Menú de administración por áreas.</p>
            </div>
          </div>
        </header>

        {visible.map((section) => (
          <section key={section.id} className="space-y-3">
            <h2 className="px-1 text-sm font-black tracking-tight text-slate-700">{section.heading}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item, idx) => {
                const Icon = itemIcon(item.id);
                const accent = accentByIndex(idx);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={[
                      "group relative flex min-h-[88px] w-full max-w-full items-center gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm",
                      "transition hover:-translate-y-[1px] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-premium-blue/20"
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                        accent.bg,
                        accent.text
                      ].join(" ")}
                      aria-hidden
                    >
                      <Icon className="h-5 w-5" strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black tracking-tight text-slate-900">{item.title}</p>
                      <p className="mt-1 text-xs leading-snug text-slate-500">{item.subtitle}</p>
                    </div>
                    <ChevronRight
                      className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5"
                      aria-hidden
                      strokeWidth={2}
                    />
                    <span className={["absolute left-0 top-0 h-full w-1", accent.bar].join(" ")} aria-hidden />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }, [data, denied, error, isLoading]);

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Admin" />
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 pb-28">{content}</main>
    </div>
  );
}
