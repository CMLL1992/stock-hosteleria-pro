"use client";

import { ArrowLeft, LogOut, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { supabase } from "@/lib/supabase";
import { getEffectiveRole } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

export function MobileHeader({
  title,
  showBack,
  backHref
}: {
  title: string;
  showBack?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const {
    me,
    isSuperadmin,
    establishments,
    activeEstablishmentId,
    activeEstablishmentName,
    activeEstablishmentLogoUrl,
    setActiveEstablishmentId
  } = useActiveEstablishment();

  const [perfilOpen, setPerfilOpen] = useState(false);
  const [perfilNombre, setPerfilNombre] = useState("");
  const [perfilSaving, setPerfilSaving] = useState(false);
  const [perfilErr, setPerfilErr] = useState<string | null>(null);
  const [perfilOk, setPerfilOk] = useState<string | null>(null);

  useEffect(() => {
    if (!perfilOpen) return;
    let cancelled = false;
    (async () => {
      setPerfilErr(null);
      setPerfilOk(null);
      try {
        const { data: auth } = await supabase().auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) throw new Error("No se pudo obtener el usuario autenticado.");
        const res = await supabase().from("usuarios").select("nombre_completo").eq("id", uid).maybeSingle();
        if (res.error) throw res.error;
        if (cancelled) return;
        setPerfilNombre(String((res.data as { nombre_completo?: unknown } | null)?.nombre_completo ?? "").trim());
      } catch (e) {
        if (cancelled) return;
        setPerfilErr(supabaseErrToString(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [perfilOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {showBack ? (
              <button
                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                aria-label="Volver"
                title="Volver"
                onClick={() => {
                  const fallback = backHref || "/admin";
                  try {
                    if (typeof window !== "undefined" && window.history.length > 1) {
                      router.back();
                      return;
                    }
                  } catch {
                    // ignore
                  }
                  router.replace(fallback);
                }}
              >
                <ArrowLeft className="h-4 w-4 text-slate-800" />
              </button>
            ) : null}
            {activeEstablishmentLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeEstablishmentLogoUrl}
                alt={activeEstablishmentName ?? "Logo"}
                className="h-9 w-9 rounded-2xl border border-slate-200 bg-white object-contain p-1 shadow-sm"
              />
            ) : (
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-700">{activeEstablishmentName ?? "OPS"}</p>
              </div>
            )}
          </div>

          <p className="mt-1 text-xs font-medium text-slate-500">
            {(() => {
              const role = getEffectiveRole(me);
              if (role === "superadmin") return "Superadmin";
              if (role === "admin") return "Admin";
              return "Staff";
            })()}
          </p>
          <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
          {isSuperadmin ? (
            <div className="mt-2 max-w-[280px]">
              <label className="sr-only" htmlFor="establecimiento">
                Establecimiento activo:
              </label>
              <select
                id="establecimiento"
                className="min-h-9 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                value={activeEstablishmentId ?? ""}
                onChange={(e) => setActiveEstablishmentId(e.currentTarget.value || null)}
              >
                {establishments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </select>
              {activeEstablishmentName ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  Establecimiento activo: {activeEstablishmentName}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
            aria-label="Mi perfil"
            title="Mi perfil"
            onClick={() => setPerfilOpen(true)}
          >
            <User className="h-5 w-5 text-slate-700" />
          </button>
          <button
            className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white shadow-sm"
            aria-label="Salir"
            title="Salir"
            onClick={async () => {
              await supabase().auth.signOut();
              window.location.href = "/login";
            }}
          >
            <LogOut className="h-5 w-5 text-slate-700" />
          </button>
        </div>
      </div>

      {perfilOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Mi perfil</p>
                <p className="mt-0.5 text-xs text-slate-500">Edita tu nombre (tabla `usuarios`).</p>
              </div>
              <button
                className="min-h-10 rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                type="button"
                onClick={() => setPerfilOpen(false)}
                disabled={perfilSaving}
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-sm font-semibold text-slate-900" htmlFor="mi-nombre">
                Nombre
              </label>
              <input
                id="mi-nombre"
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={perfilNombre}
                onChange={(e) => setPerfilNombre(e.currentTarget.value)}
                placeholder="Tu nombre completo"
              />
              {perfilErr ? (
                <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{perfilErr}</p>
              ) : null}
              {perfilOk ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  {perfilOk}
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                type="button"
                onClick={() => setPerfilOpen(false)}
                disabled={perfilSaving}
              >
                Cancelar
              </button>
              <button
                className="min-h-12 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                type="button"
                disabled={perfilSaving || !perfilNombre.trim()}
                onClick={async () => {
                  setPerfilSaving(true);
                  setPerfilErr(null);
                  setPerfilOk(null);
                  try {
                    const { data: auth } = await supabase().auth.getUser();
                    const uid = auth?.user?.id;
                    if (!uid) throw new Error("No se pudo obtener el usuario autenticado.");

                    // Preferimos RPC para limitar el update a nombre_completo.
                    const rpc = await supabase().rpc("update_my_nombre_completo", {
                      p_nombre_completo: perfilNombre.trim()
                    });
                    if (rpc.error) {
                      // Fallback: update directo (requiere policy adecuada)
                      const up = await supabase()
                        .from("usuarios")
                        .update({ nombre_completo: perfilNombre.trim() })
                        .eq("id", uid);
                      if (up.error) throw up.error;
                    }
                    setPerfilOk("Nombre actualizado.");
                    router.refresh();
                    setPerfilOpen(false);
                  } catch (e) {
                    setPerfilErr(supabaseErrToString(e));
                  } finally {
                    setPerfilSaving(false);
                  }
                }}
              >
                {perfilSaving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

