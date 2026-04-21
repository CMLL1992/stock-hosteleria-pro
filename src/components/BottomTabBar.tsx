"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useMyRole } from "@/lib/useMyRole";

type Tab = {
  href: string;
  label: string;
  emoji: string;
};

function tabActive(pathname: string, href: string, isAdmin: boolean): boolean {
  if (href === "/") {
    return pathname === "/" || pathname === "" || pathname.startsWith("/admin/dashboard");
  }
  if (href === "/admin/productos" || href === "/stock") {
    if (isAdmin) {
      return pathname.startsWith("/admin/productos") && !pathname.startsWith("/admin/productos/nuevo");
    }
    return pathname === "/stock" || pathname.startsWith("/stock/");
  }
  if (href === "/admin") {
    if (!isAdmin) return pathname.startsWith("/escanear");
    return (
      pathname === "/admin" ||
      pathname.startsWith("/admin/importar-csv") ||
      pathname.startsWith("/admin/productos/nuevo")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomTabBar() {
  const pathname = usePathname() ?? "";
  const { data } = useMyRole();
  const isAdmin = !!data?.isAdmin;

  const tabs: Tab[] = useMemo(
    () => [
      { href: "/", label: "Dashboard", emoji: "🏠" },
      { href: isAdmin ? "/admin/productos" : "/stock", label: "Inventario", emoji: "📦" },
      { href: isAdmin ? "/admin" : "/escanear", label: isAdmin ? "Añadir" : "Escanear", emoji: "➕" }
    ],
    [isAdmin]
  );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegación inferior"
    >
      <div className="mx-auto flex max-w-3xl items-stretch justify-between gap-1 px-1 pb-2 pt-2">
        {tabs.map((t) => {
          const active = tabActive(pathname, t.href, isAdmin);
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className={[
                "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1 transition-colors",
                active ? "bg-slate-100 text-slate-900" : "text-slate-500 active:bg-slate-50"
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <span className={["select-none leading-none", active ? "text-[1.65rem]" : "text-2xl"].join(" ")} aria-hidden>
                {t.emoji}
              </span>
              <span className="max-w-full truncate px-0.5 text-[10px] font-bold leading-tight">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
