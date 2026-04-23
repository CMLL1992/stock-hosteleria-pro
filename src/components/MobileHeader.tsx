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

  const effectiveRole = getEffectiveRole(me);
  const canEditPerfilNombre = effectiveRole === "superadmin";

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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          {/* Este es el contenedor blanco del modal */}
          <div className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
            {/* Cabecera del modal */}
            <div className="border-b border-slate-200 p-6 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Nombre</h3>
                </div>
                <button
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                  type="button"
                  onClick={() => setPerfilOpen(false)}
                  disabled={perfilSaving}
                >
                  Cerrar
                </button>
              </div>
            </div>

            {/* Cuerpo del modal (donde está el input) */}
            <div className="p-6">
              <input
                type="text"
                value={perfilNombre}
                onChange={(e) => setPerfilNombre(e.currentTarget.value)}
                className="w-full rounded-lg border border-slate-300 px-4 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                placeholder="Tu nombre completo"
                disabled={!canEditPerfilNombre || perfilSaving}
              />
              {perfilErr ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{perfilErr}</p>
              ) : null}
              {perfilOk ? (
                <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  {perfilOk}
                </p>
              ) : null}
            </div>

            {/* Pie del modal con los botones */}
            <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-6 dark:border-slate-800 dark:bg-slate-800/50">
              <button
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                type="button"
                onClick={() => setPerfilOpen(false)}
                disabled={perfilSaving}
              >
                Cancelar
              </button>
              {canEditPerfilNombre ? (
                <button
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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

                      const { error } = await supabase().rpc("update_user_name_admin", {
                        p_user_id: uid,
                        p_new_name: perfilNombre.trim()
                      });
                      if (error) throw error;

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
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

