"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";

function normalizeWhatsappPhone(input: string): string {
  // Mantiene solo dígitos y un '+' inicial si existe.
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return (hasPlus ? "+" : "") + digits;
}

export default function NuevoProveedorPage() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [categoria, setCategoria] = useState("");
  const [notas, setNotas] = useState("");
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

  async function crear() {
    setErr(null);
    if (!activeEstablishmentId) {
      setErr("No hay establecimiento activo.");
      return;
    }
    const telefono_whatsapp = telefono ? normalizeWhatsappPhone(telefono) : null;
    const { error } = await supabase().from("proveedores").insert({
      nombre: nombre.trim(),
      telefono_whatsapp,
      categoria: categoria.trim() || null,
      notas: notas.trim() || null,
      establecimiento_id: activeEstablishmentId
    });
    if (error) {
      setErr(error.message);
      return;
    }
    window.location.href = "/admin";
  }

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;

  if (role !== "admin" && role !== "superadmin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Crear proveedor (Admin)</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Crear proveedor" showBack backHref="/admin" />
      <main className="mx-auto max-w-md bg-slate-50 p-4 pb-28 text-slate-900">
        <h1 className="mb-3 text-xl font-semibold">Crear proveedor</h1>
      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Nombre</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={nombre}
            onChange={(e) => setNombre(e.currentTarget.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Categoría</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Cervezas, Licores, Refrescos…"
            value={categoria}
            onChange={(e) => setCategoria(e.currentTarget.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Teléfono WhatsApp (formato internacional)</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="+34..."
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.currentTarget.value)}
          />
          <p className="text-xs text-slate-600">
            Ejemplo: <span className="font-mono">+34600111222</span>
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Notas</label>
          <textarea
            className="min-h-24 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Horario de reparto, condiciones, días de pedido…"
            value={notas}
            onChange={(e) => setNotas(e.currentTarget.value)}
          />
        </div>

        <Button onClick={crear} disabled={!nombre.trim()}>
          Crear proveedor
        </Button>
      </div>
      </main>
    </div>
  );
}

