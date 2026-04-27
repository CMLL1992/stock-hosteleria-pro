"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { LayoutDashboard } from "lucide-react";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";

type Tab = {
  href: string;
  label: string;
  icon: "home" | "reservas" | "stock" | "vacios" | "pedidos" | "panel";
};

function tabActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname === "" || pathname.startsWith("/admin/dashboard");
  }
  if (href === "/stock") {
    return pathname === "/stock" || pathname.startsWith("/stock/");
  }
  if (href === "/admin/reservas") {
    return pathname === "/admin/reservas" || pathname.startsWith("/admin/reservas/");
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

  function Icon({ name, active }: { name: Tab["icon"]; active: boolean }) {
    const cls = ["h-[22px] w-[22px] transition-colors duration-200", active ? "text-premium-blue" : "text-slate-500"].join(" ");
    if (name === "home") {
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path
            d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    if (name === "reservas") {
      return <LayoutDashboard className={cls} aria-hidden strokeWidth={2.2} />;
    }
    if (name === "stock") {
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    }
    if (name === "vacios") {
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path
            d="M9 3h6l-1 3v3l2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V11l2-2V6L9 3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    if (name === "pedidos") {
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden>
          <path d="M7 3h10v18H7z" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M9 7h6M9 11h6M9 15h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-hidden>
        <path d="M12 2 2 7v10l10 5 10-5V7L12 2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );
  }

  const tabs: Tab[] = useMemo(() => {
    if (!isAdmin) {
      return [
        { href: "/", label: "INICIO", icon: "home" },
        { href: "/admin/reservas", label: "Reservas", icon: "reservas" },
        { href: "/stock", label: "STOCK", icon: "stock" },
        { href: "/stock?vacios=1", label: "VACÍOS", icon: "vacios" }
      ];
    }
    return [
      { href: "/", label: "INICIO", icon: "home" },
      { href: "/admin/reservas", label: "Reservas", icon: "reservas" },
      { href: "/stock", label: "STOCK", icon: "stock" },
      { href: "/admin/pedidos", label: "PEDIDOS", icon: "pedidos" },
      { href: "/admin", label: "PANEL", icon: "panel" }
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
                "relative flex min-h-[54px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 transition-colors duration-200",
                active ? "text-premium-blue" : "text-slate-500 hover:text-slate-700"
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              {/* Indicador superior (activo) */}
              {active ? (
                <span className="absolute left-2 right-2 top-0 h-1 rounded-b-full bg-premium-blue" aria-hidden />
              ) : null}
              <Icon name={t.icon} active={active} />
              <span className="max-w-full truncate px-0.5 text-[11px] font-semibold tracking-wide">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
