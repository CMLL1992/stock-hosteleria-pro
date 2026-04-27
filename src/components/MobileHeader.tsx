"use client";

import { ArrowLeft, Link as LinkIcon, Lock, LogOut, QrCode, User } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { supabase } from "@/lib/supabase";
import { getEffectiveRole } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { Drawer } from "@/components/ui/Drawer";
import { QRCodeCanvas } from "qrcode.react";

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
    activePublicBookingUrl,
    activeEstablishmentLogoUrl,
    setActiveEstablishmentId
  } = useActiveEstablishment();

  const [perfilOpen, setPerfilOpen] = useState(false);
  const [bookingQrOpen, setBookingQrOpen] = useState(false);
  const [bookingToast, setBookingToast] = useState<string | null>(null);
  const [perfilNombre, setPerfilNombre] = useState("");
  const [perfilSaving, setPerfilSaving] = useState(false);
  const [perfilErr, setPerfilErr] = useState<string | null>(null);
  const [perfilOk, setPerfilOk] = useState<string | null>(null);

  const effectiveRole = getEffectiveRole(me);
  const canAdmin = effectiveRole === "admin" || effectiveRole === "superadmin";

  async function copyBookingUrl() {
    const url = (activePublicBookingUrl ?? "").trim();
    if (!url) return;
    setBookingToast(null);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setBookingToast("¡Enlace de reserva copiado!");
      window.setTimeout(() => setBookingToast(null), 1600);
    } catch {
      setBookingToast("No se pudo copiar el enlace");
      window.setTimeout(() => setBookingToast(null), 1600);
    }
  }

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
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/70 backdrop-blur">
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
          <h1 className="truncate text-xl font-black tracking-tight text-slate-900">{title}</h1>
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
          {canAdmin && activePublicBookingUrl ? (
            <button
              type="button"
              onClick={() => void copyBookingUrl()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
              aria-label="Enlace de reservas"
              title="Enlace de reservas"
            >
              <LinkIcon className="h-5 w-5 text-slate-700" />
            </button>
          ) : null}
          {canAdmin && activePublicBookingUrl ? (
            <button
              type="button"
              onClick={() => setBookingQrOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
              aria-label="QR del enlace de reservas"
              title="QR del enlace"
            >
              <QrCode className="h-5 w-5 text-slate-700" />
            </button>
          ) : null}
          <Link
            href="/ayuda"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            aria-label="Ayuda y documentación"
            title="Ayuda"
          >
            ?
          </Link>
          {getEffectiveRole(me) === "superadmin" ? (
            <button
              className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
              aria-label="Mi perfil"
              title="Mi perfil"
              onClick={() => setPerfilOpen(true)}
            >
              <User className="h-5 w-5 text-slate-700" />
            </button>
          ) : null}
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

      {bookingToast ? (
        <div className="mx-auto max-w-3xl px-4 pb-2">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 shadow-sm">
            {bookingToast}
          </div>
        </div>
      ) : null}

      <Drawer open={bookingQrOpen} title="QR del enlace" onClose={() => setBookingQrOpen(false)}>
        <div className="space-y-4 pb-4">
          <div className="flex items-center justify-center rounded-3xl border border-slate-200 bg-white p-6">
            {activePublicBookingUrl ? (
              <QRCodeCanvas value={activePublicBookingUrl} size={220} includeMargin />
            ) : (
              <p className="text-sm text-slate-600">No hay URL disponible.</p>
            )}
          </div>
          <p className="break-all text-xs font-semibold text-slate-600">{activePublicBookingUrl ?? ""}</p>
        </div>
      </Drawer>

      {perfilOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Mi perfil"
          onClick={() => setPerfilOpen(false)}
        >
          {/* 2. Contenedor blanco del Modal: Centrado, responsivo, sombra */}
          <div
            className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 3. Cabecera (Siempre visible) */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/40">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Mi Perfil</h3>
              <button
                type="button"
                onClick={() => setPerfilOpen(false)}
                disabled={perfilSaving}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700 transition"
                aria-label="Cerrar"
                title="Cerrar"
              >
                ✕
              </button>
            </div>

            {/* 4. Cuerpo (Donde está el formulario) */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nombre Completo</label>

                {effectiveRole !== "superadmin" ? (
                  <div className="flex items-start gap-3 p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-800 dark:text-slate-100 font-medium border border-slate-200 dark:border-slate-700">
                    <div className="mt-0.5 grid h-8 w-8 place-items-center rounded-xl bg-white/70 text-slate-600 border border-slate-200 dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-300">
                      <Lock className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate">{perfilNombre || "Sin Nombre"}</p>
                      <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">(Solo lectura)</p>
                    </div>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={perfilNombre}
                    onChange={(e) => setPerfilNombre(e.currentTarget.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                    placeholder="Ej: Carlos G."
                    disabled={perfilSaving}
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">Rol</label>
                <span className="capitalize font-semibold text-slate-600 dark:text-slate-400">{effectiveRole}</span>
              </div>

              {perfilErr ? (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{perfilErr}</p>
              ) : null}
              {perfilOk ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{perfilOk}</p>
              ) : null}
            </div>

            {/* 5. Pie del Modal (Botones) */}
            <div className="p-5 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/50">
              <button
                onClick={() => setPerfilOpen(false)}
                type="button"
                disabled={perfilSaving}
                className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700 transition"
              >
                {effectiveRole === "superadmin" ? "Cancelar" : "Cerrar"}
              </button>

              {effectiveRole === "superadmin" ? (
                <button
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
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition disabled:opacity-60"
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

