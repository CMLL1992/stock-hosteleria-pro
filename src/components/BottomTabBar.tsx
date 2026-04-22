"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useMyRole } from "@/lib/useMyRole";
import { useTranslations } from "next-intl";

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
  const isAdmin = !!data?.isAdmin;
  const t = useTranslations();

  const tabs: Tab[] = useMemo(() => {
    if (!isAdmin) {
      return [
        { href: "/", label: t("nav.home").toUpperCase() },
        { href: "/admin/scan", label: t("nav.scan").toUpperCase() },
        { href: "/stock", label: t("nav.stock").toUpperCase() },
        { href: "/stock?vacios=1", label: "VACÍOS" }
      ];
    }
    return [
      { href: "/", label: t("nav.home").toUpperCase() },
      { href: "/admin/scan", label: t("nav.scan").toUpperCase() },
      { href: "/stock", label: t("nav.stock").toUpperCase() },
      { href: "/admin/pedidos", label: t("nav.orders").toUpperCase() },
      { href: "/admin", label: t("nav.panel").toUpperCase() }
    ];
  }, [isAdmin, t]);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegación inferior"
    >
      <div className="mx-auto flex max-w-3xl items-stretch justify-between gap-1 px-1 pb-2 pt-2">
        {tabs.map((t) => {
          const active = tabActive(pathname, t.href);
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className={[
                "flex min-h-[52px] min-w-0 flex-1 items-center justify-center rounded-2xl px-1 py-2 transition-colors",
                active ? "bg-slate-100 text-slate-900" : "text-slate-600 active:bg-slate-50"
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <span className="max-w-full truncate px-0.5 text-xs font-semibold tracking-wide">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
