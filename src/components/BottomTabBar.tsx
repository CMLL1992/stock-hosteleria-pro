"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Home, Package, ScanBarcode, Settings, ShoppingCart } from "lucide-react";
import { useMyRole } from "@/lib/useMyRole";

type Tab = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export function BottomTabBar() {
  const pathname = usePathname() ?? "";
  const { data } = useMyRole();
  const isAdmin = !!data?.isAdmin;

  const tabs: Tab[] = useMemo(
    () => [
      { href: "/", label: "Inicio", icon: Home },
      { href: isAdmin ? "/admin/productos" : "/stock", label: "Productos", icon: Package },
      {
        href: isAdmin ? "/admin/pedido-rapido" : "/escanear",
        label: "Pedidos",
        icon: isAdmin ? ShoppingCart : ScanBarcode
      },
      { href: "/mas", label: "Ajustes", icon: Settings }
    ],
    [isAdmin]
  );

  function activeFor(href: string): boolean {
    if (href === "/") return pathname === "/" || pathname === "";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegación inferior"
    >
      <div className="mx-auto flex max-w-3xl items-stretch justify-between gap-2 px-2 pb-2 pt-2">
        {tabs.map((t) => {
          const active = activeFor(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className={[
                "flex min-h-12 min-w-[48px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 transition-colors",
                active ? "bg-slate-100 text-slate-900" : "text-slate-500 active:bg-slate-50"
              ].join(" ")}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={["shrink-0", active ? "h-7 w-7" : "h-6 w-6"].join(" ")} />
              <span className="text-[11px] font-semibold leading-none">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
