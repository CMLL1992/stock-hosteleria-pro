"use client";

import { useEffect, useState } from "react";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";

type Proveedor = {
  id: string;
  nombre: string;
  telefono_whatsapp: string | null;
};

export default function ProveedoresPage() {
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Proveedor[]>([]);

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
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase()
          .from("proveedores")
          .select("id,nombre,telefono_whatsapp")
          .order("nombre", { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        setItems((data as unknown as Proveedor[]) ?? []);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (loading) return <main className="p-4 text-sm text-zinc-700">Cargando…</main>;
  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Proveedores (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-700">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Proveedores</h1>
          <p className="text-sm text-zinc-700">{items.length} proveedores</p>
        </div>
        <a className="text-sm text-zinc-700 underline" href="/admin">
          Volver
        </a>
      </div>

      {err ? (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      <div className="space-y-2">
        {items.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{p.nombre}</p>
              <p className="text-xs text-zinc-700">{p.telefono_whatsapp ?? "—"}</p>
            </div>
            <a
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
              href={`/admin/proveedores/${encodeURIComponent(p.id)}/editar`}
              aria-label="Editar proveedor"
              title="Editar"
            >
              ✎
            </a>
          </div>
        ))}
      </div>
    </main>
  );
}

