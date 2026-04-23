"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppRole } from "@/lib/session";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { MobileHeader } from "@/components/MobileHeader";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { hasPermission } from "@/lib/permissions";
import { DangerConfirmModal } from "@/components/ui/DangerConfirmModal";

function normalizeWhatsappPhone(input: string): string {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return (hasPlus ? "+" : "") + digits;
}

type Proveedor = {
  id: string;
  establecimiento_id: string;
  nombre: string;
  telefono_whatsapp: string | null;
  categoria?: string | null;
  notas?: string | null;
};

export default function EditarProveedorPage({ params }: { params: { id: string } }) {
  const [role, setRole] = useState<AppRole | null>(null);
  const canManage = hasPermission(role, "admin");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const { activeEstablishmentId } = useActiveEstablishment();

  const [prov, setProv] = useState<Proveedor | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [categoria, setCategoria] = useState("");
  const [notas, setNotas] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
          .select("id,establecimiento_id,nombre,telefono_whatsapp,categoria,notas")
          .eq("id", params.id)
          .eq("establecimiento_id", activeEstablishmentId)
          .single();
        if (error) throw error;
        if (cancelled) return;
        const p = data as unknown as Proveedor;
        setProv(p);
        setNombre(p.nombre ?? "");
        setTelefono(p.telefono_whatsapp ?? "");
        setCategoria(String(p.categoria ?? ""));
        setNotas(String(p.notas ?? ""));
      } catch (e) {
        if (cancelled) return;
        setErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEstablishmentId, canManage, params.id]);

  async function guardar() {
    if (!prov) return;
    if (!activeEstablishmentId) {
      setErr("No hay establecimiento activo.");
      return;
    }
    if (prov.establecimiento_id && prov.establecimiento_id !== activeEstablishmentId) {
      setErr(
        "El establecimiento activo no coincide con el del proveedor. Cambia al establecimiento correcto en el selector y vuelve a intentarlo."
      );
      return;
    }
    setErr(null);
    const telefono_whatsapp = telefono.trim() ? normalizeWhatsappPhone(telefono) : null;
    const { error, count } = await supabase()
      .from("proveedores")
      .update(
        {
          nombre: nombre.trim(),
          telefono_whatsapp,
          categoria: categoria.trim() || null,
          notas: notas.trim() || null
        },
        { count: "exact" }
      )
      .eq("id", prov.id)
      .eq("establecimiento_id", prov.establecimiento_id || activeEstablishmentId);
    if (error) {
      setErr(error.message);
      return;
    }
    if (!count) {
      setErr("No se pudo guardar: proveedor no encontrado en el establecimiento activo o sin permisos.");
      return;
    }
    window.location.href = "/admin/proveedores";
  }

  async function borrar() {
    if (!prov) return;
    if (!activeEstablishmentId) {
      setErr("No hay establecimiento activo.");
      return;
    }
    if (prov.establecimiento_id && prov.establecimiento_id !== activeEstablishmentId) {
      setErr(
        "El establecimiento activo no coincide con el del proveedor. Cambia al establecimiento correcto en el selector y vuelve a intentarlo."
      );
      return;
    }
    setErr(null);
    setDeleting(true);
    try {
      const { data, error } = await supabase().rpc("delete_proveedor_safe", { p_proveedor_id: prov.id });
      if (error) throw error;
      const okRes = ((data ?? null) as { ok?: boolean; message?: string } | null)?.ok ?? false;
      if (!okRes) {
        const msg = ((data ?? null) as { message?: string } | null)?.message ?? "No se pudo eliminar el proveedor.";
        throw new Error(msg);
      }
      window.location.href = "/admin/proveedores";
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canManage) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Editar proveedor (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-700">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Editar proveedor" showBack backHref="/admin/proveedores" />
      <main className="mx-auto max-w-md bg-slate-50 p-4 pb-28 text-slate-900">
        <h1 className="mb-3 text-xl font-semibold">Editar proveedor</h1>

      <DangerConfirmModal
        open={confirmDelete}
        title="Eliminar proveedor"
        description={prov ? `Vas a borrar "${prov.nombre}". Esta acción es irreversible.` : "Acción irreversible."}
        confirmLabel="Eliminar"
        keyword="BORRAR"
        busy={deleting}
        onClose={() => {
          if (deleting) return;
          setConfirmDelete(false);
        }}
        onConfirm={async () => {
          await borrar();
        }}
      />

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
            placeholder="Cervezas, Licores, etc."
            value={categoria}
            onChange={(e) => setCategoria(e.currentTarget.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Teléfono WhatsApp</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="+34..."
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.currentTarget.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Notas</label>
          <textarea
            className="min-h-24 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={notas}
            onChange={(e) => setNotas(e.currentTarget.value)}
          />
        </div>

        <Button onClick={guardar} disabled={!nombre.trim()}>
          Guardar cambios
        </Button>

        <button
          type="button"
          className="min-h-12 w-full rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 hover:bg-red-100"
          onClick={() => {
            setConfirmDelete(true);
          }}
        >
          Eliminar proveedor…
        </button>
      </div>
      </main>
    </div>
  );
}

