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
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }} aria-label="Navegación inferior">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-stretch justify-between gap-1 rounded-full border border-slate-200 bg-white/90 p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-md">
          {tabs.map((t) => {
            const active = tabActive(pathname, t.href);
            return (
              <Link
                key={t.href + t.label}
                href={t.href}
                className={[
                  "flex min-h-[46px] min-w-0 flex-1 items-center justify-center rounded-full px-2 py-2 transition-all duration-200",
                  active
                    ? "bg-premium-blue/10 text-premium-blue ring-1 ring-premium-blue/20"
                    : "text-slate-600 hover:bg-slate-50 active:bg-slate-50"
                ].join(" ")}
                aria-current={active ? "page" : undefined}
              >
                <span className="max-w-full truncate px-0.5 text-xs font-semibold tracking-wide">{t.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
