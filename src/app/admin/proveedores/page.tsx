"use client";

import { useEffect, useState } from "react";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { Pencil } from "lucide-react";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { hasPermission } from "@/lib/permissions";

type Proveedor = {
  id: string;
  nombre: string;
  telefono_whatsapp: string | null;
  categoria?: string | null;
};

export default function ProveedoresPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const canManage = hasPermission(role, "admin");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Proveedor[]>([]);
  const { activeEstablishmentId } = useActiveEstablishment();

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
        setErr(supabaseErrToString(e));
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
    if (!canManage) return;
    if (!activeEstablishmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase()
          .from("proveedores")
          .select("id,nombre,telefono_whatsapp,categoria")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("nombre", { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        setItems((data as unknown as Proveedor[]) ?? []);
      } catch (e) {
        if (cancelled) return;
        setErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, canManage]);

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canManage) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Proveedores (Admin)</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Proveedores" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl bg-slate-50 p-4 pb-28 text-slate-900">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Proveedores</h1>
            <p className="text-sm text-slate-600">{items.length} proveedores</p>
          </div>
          <a
            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-black px-4 text-sm font-semibold text-white hover:bg-slate-900 active:bg-slate-950"
            href="/admin/proveedores/nuevo"
          >
            Crear
          </a>
        </div>

      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      <div className="space-y-2">
        {items.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{p.nombre}</p>
              <p className="mt-1 text-xs text-slate-600">
                {p.telefono_whatsapp ?? "—"}
                {p.categoria ? <span> · {p.categoria}</span> : null}
              </p>
            </div>
            <a
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              href={`/admin/proveedores/${encodeURIComponent(p.id)}/editar`}
              aria-label="Editar proveedor"
              title="Editar"
            >
              <Pencil className="h-5 w-5 text-slate-700" aria-hidden />
            </a>
          </div>
        ))}
      </div>
      </main>
    </div>
  );
}

