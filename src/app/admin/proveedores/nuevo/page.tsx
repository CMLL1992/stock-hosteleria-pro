"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";

function normalizeWhatsappPhone(input: string): string {
  // Mantiene solo dígitos y un '+' inicial si existe.
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return (hasPlus ? "+" : "") + digits;
}

export default function NuevoProveedorPage() {
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");

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
    const telefono_whatsapp = telefono ? normalizeWhatsappPhone(telefono) : null;
    const { error } = await supabase().from("proveedores").insert({
      nombre,
      telefono_whatsapp
    });
    if (error) {
      setErr(error.message);
      return;
    }
    window.location.href = "/admin";
  }

  if (loading) return <main className="p-4 text-sm text-zinc-600 dark:text-zinc-300">Cargando…</main>;

  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Crear proveedor (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-3 text-xl font-semibold">Crear proveedor</h1>
      {err ? (
        <p className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </p>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-1">
          <label className="text-sm font-medium">Nombre</label>
          <input
            className="min-h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base dark:border-zinc-800 dark:bg-zinc-950"
            value={nombre}
            onChange={(e) => setNombre(e.currentTarget.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Teléfono WhatsApp (formato internacional)</label>
          <input
            className="min-h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base dark:border-zinc-800 dark:bg-zinc-950"
            placeholder="+34..."
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.currentTarget.value)}
          />
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            Ejemplo: <span className="font-mono">+34600111222</span>
          </p>
        </div>

        <Button onClick={crear} disabled={!nombre.trim()}>
          Crear proveedor
        </Button>
      </div>
    </main>
  );
}

