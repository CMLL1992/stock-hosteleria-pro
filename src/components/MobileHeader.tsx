"use client";

import { ArrowLeft, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { supabase } from "@/lib/supabase";

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
                  router.back();
                  // fallback si no hay historial útil
                  window.setTimeout(() => {
                    if (backHref) window.location.href = backHref;
                  }, 150);
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
            {me?.isSuperadmin ? "Superadmin" : me?.isAdmin ? "Admin" : "Staff"}
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
    </header>
  );
}

