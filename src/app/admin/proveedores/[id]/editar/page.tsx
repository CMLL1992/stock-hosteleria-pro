"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";

function normalizeWhatsappPhone(input: string): string {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return (hasPlus ? "+" : "") + digits;
}

type Proveedor = {
  id: string;
  nombre: string;
  telefono_whatsapp: string | null;
};

export default function EditarProveedorPage({ params }: { params: { id: string } }) {
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [prov, setProv] = useState<Proveedor | null>(null);
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

  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase()
          .from("proveedores")
          .select("id,nombre,telefono_whatsapp")
          .eq("id", params.id)
          .single();
        if (error) throw error;
        if (cancelled) return;
        const p = data as unknown as Proveedor;
        setProv(p);
        setNombre(p.nombre ?? "");
        setTelefono(p.telefono_whatsapp ?? "");
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id, role]);

  async function guardar() {
    if (!prov) return;
    setErr(null);
    const telefono_whatsapp = telefono.trim() ? normalizeWhatsappPhone(telefono) : null;
    const { error } = await supabase()
      .from("proveedores")
      .update({ nombre: nombre.trim(), telefono_whatsapp })
      .eq("id", prov.id);
    if (error) {
      setErr(error.message);
      return;
    }
    window.location.href = "/admin/proveedores";
  }

  if (loading) return <main className="p-4 text-sm text-zinc-700">Cargando…</main>;
  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Editar proveedor (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-700">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-4 pb-24">
      <a className="text-sm text-zinc-700 underline" href="/admin/proveedores">
        Volver
      </a>
      <h1 className="mb-3 mt-2 text-xl font-semibold">Editar proveedor</h1>

      {err ? (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <label className="text-sm font-medium">Nombre</label>
          <input
            className="min-h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
            value={nombre}
            onChange={(e) => setNombre(e.currentTarget.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Teléfono WhatsApp</label>
          <input
            className="min-h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
            placeholder="+34..."
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.currentTarget.value)}
          />
        </div>

        <Button onClick={guardar} disabled={!nombre.trim()}>
          Guardar cambios
        </Button>
      </div>
    </main>
  );
}

