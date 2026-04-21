"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MobileHeader } from "@/components/MobileHeader";
import { fetchMyRole } from "@/lib/session";

type AppRole = "admin" | "staff";

type AdminLink = {
  href: string;
  title: string;
  subtitle?: string;
};

const LINKS: AdminLink[] = [
  { href: "/admin/proveedores", title: "Gestionar proveedores" },
  { href: "/admin/proveedores/nuevo", title: "Crear proveedor" },
  { href: "/admin/productos/nuevo", title: "Crear producto" },
  { href: "/admin/etiquetas", title: "Gestión de etiquetas" },
  { href: "/admin/importar-csv", title: "Importar CSV" },
  { href: "/admin/pedido-rapido", title: "Pedido rápido" }
];

export function AdminHomeClient() {
  const router = useRouter();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchMyRole()
      .then((r) => {
        if (cancelled) return;
        setRole(r);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // Si no hay sesión, mandamos a login (evita estados raros + 500 percibidos).
        if (msg.toLowerCase().includes("no hay sesión")) {
          router.replace("/login");
          return;
        }
        setErr(msg);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const content = useMemo(() => {
    if (loading) return <p className="text-sm text-gray-600">Cargando…</p>;
    if (err) {
      return (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      );
    }
    if (role !== "admin") {
      return (
        <div className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-900">Acceso denegado.</p>
          <p className="mt-1 text-sm text-gray-600">Esta sección es solo para administradores.</p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {LINKS.map((l) => (
          <a
            key={l.href}
            className="flex min-h-14 items-center justify-between rounded-3xl border border-gray-100 bg-white px-4 shadow-sm hover:bg-gray-50"
            href={l.href}
          >
            <span className="text-sm font-semibold text-gray-900">{l.title}</span>
            <span className="text-sm text-gray-400">→</span>
          </a>
        ))}
      </div>
    );
  }, [err, loading, role]);

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">{content}</main>
    </div>
  );
}

