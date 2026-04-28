"use client";

import { useEffect, useState } from "react";
import { useMyRole } from "@/lib/useMyRole";
import { supabase } from "@/lib/supabase";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";

function LinkItem({ href, label, activeHref }: { href: string; label: string; activeHref: string | null }) {
  const isActive = activeHref === href;
  return (
    <a
      href={href}
      className={[
        "min-h-12 rounded-xl px-3 text-sm font-medium inline-flex items-center",
        isActive
          ? "bg-zinc-950 text-white"
          : "text-zinc-800 hover:bg-zinc-100"
      ].join(" ")}
    >
      {label}
    </a>
  );
}

export function NavBar() {
  const { data } = useMyRole();
  const role = getEffectiveRole(data ?? null);
  const isAdmin = hasPermission(role, "admin");
  const [activeHref, setActiveHref] = useState<string | null>(null);

  // Evita mismatch SSR/cliente: solo activamos el "active" tras montar.
  useEffect(() => {
    setActiveHref(window.location.pathname);
  }, []);

  return (
    <div className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 p-2">
        <div className="flex items-center gap-1">
          <LinkItem href="/" label="Stock" activeHref={activeHref} />
          {isAdmin ? <LinkItem href="/admin" label="Admin" activeHref={activeHref} /> : null}
          {isAdmin ? (
            <LinkItem href="/admin/productos" label="Gestionar Productos" activeHref={activeHref} />
          ) : null}
          {isAdmin ? (
            <LinkItem href="/admin/productos/nuevo" label="Crear Productos" activeHref={activeHref} />
          ) : null}
          {isAdmin ? (
            <LinkItem href="/admin/importar-csv" label="Importar CSV" activeHref={activeHref} />
          ) : null}
          {isAdmin ? (
            <LinkItem href="/admin/pedidos" label="Pedidos" activeHref={activeHref} />
          ) : null}
          {isAdmin ? <LinkItem href="/admin/staff" label="Staff" activeHref={activeHref} /> : null}
        </div>
        <button
          className="min-h-12 rounded-xl px-3 text-sm text-zinc-700 hover:bg-zinc-100"
          onClick={async () => {
            await supabase().auth.signOut();
            window.location.href = "/login";
          }}
        >
          Salir
        </button>
      </div>
    </div>
  );
}

