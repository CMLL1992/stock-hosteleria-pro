"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";

type Tab = {
  href: string;
  label: string;
};

function tabActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname === "" || pathname.startsWith("/admin/dashboard");
  }
  if (href === "/stock") {
    return pathname === "/stock" || pathname.startsWith("/stock/");
  }
  if (href === "/admin/pedidos") {
    return pathname === "/admin/pedidos" || pathname.startsWith("/admin/pedidos/");
  }
  if (href === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/");
  }
  if (href.startsWith("/stock?")) {
    return pathname === "/stock" || pathname.startsWith("/stock/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomTabBar() {
  const pathname = usePathname() ?? "";
  const { data } = useMyRole();
  const role = getEffectiveRole(data ?? null);
  const isAdmin = hasPermission(role, "admin");

  const tabs: Tab[] = useMemo(() => {
    if (!isAdmin) {
      return [
        { href: "/", label: "INICIO" },
        { href: "/admin/scan", label: "ESCANEAR" },
        { href: "/stock", label: "STOCK" },
        { href: "/stock?vacios=1", label: "VACÍOS" }
      ];
    }
    return [
      { href: "/", label: "INICIO" },
      { href: "/admin/scan", label: "ESCANEAR" },
      { href: "/stock", label: "STOCK" },
      { href: "/admin/pedidos", label: "PEDIDOS" },
      { href: "/admin", label: "PANEL" }
    ];
  }, [isAdmin]);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-100 bg-white shadow-[0_-14px_30px_rgba(15,23,42,0.10)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegación inferior"
    >
      <div className="mx-auto flex max-w-3xl items-stretch justify-between gap-1 px-2 pb-2 pt-2">
        {tabs.map((t) => {
          const active = tabActive(pathname, t.href);
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className={[
                "relative flex min-h-[54px] min-w-0 flex-1 items-center justify-center px-2 py-2 transition-colors duration-200",
                active ? "text-premium-blue" : "text-slate-500 hover:text-slate-700"
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              {/* Indicador superior (activo) */}
              {active ? (
                <span className="absolute left-2 right-2 top-0 h-1 rounded-b-full bg-premium-blue" aria-hidden />
              ) : null}
              <span className="max-w-full truncate px-0.5 text-[11px] font-semibold tracking-wide">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
