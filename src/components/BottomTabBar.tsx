"use client";

import { Barcode, Boxes, MoreHorizontal, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMyRole } from "@/lib/useMyRole";

type Tab = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
};

const TABS: Tab[] = [
  { href: "/", label: "Stock", icon: Boxes },
  { href: "/escanear", label: "Escanear", icon: Barcode },
  { href: "/admin", label: "Admin", icon: Shield, adminOnly: true },
  { href: "/mas", label: "Más", icon: MoreHorizontal }
];

export function BottomTabBar() {
  const { data } = useMyRole();
  const [path, setPath] = useState<string>("");

  useEffect(() => {
    setPath(window.location.pathname);
  }, []);

  const tabs = useMemo(() => {
    return TABS.filter((t) => (t.adminOnly ? data?.isAdmin : true));
  }, [data?.isAdmin]);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-100 bg-white/90 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegación inferior"
    >
      <div className="mx-auto flex max-w-3xl items-stretch justify-between gap-1 px-3 pb-2 pt-2">
        {tabs.map((t) => {
          const active = path === t.href || (t.href !== "/" && path.startsWith(t.href));
          const Icon = t.icon;
          return (
            <a
              key={t.href}
              href={t.href}
              className={[
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2",
                active ? "bg-gray-50 text-gray-900" : "text-gray-500 hover:bg-gray-50"
              ].join(" ")}
            >
              <Icon className={["h-5 w-5", active ? "text-gray-900" : "text-gray-500"].join(" ")} />
              <span className="text-[11px] font-medium leading-none">{t.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

