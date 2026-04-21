"use client";

import { LogOut, User } from "lucide-react";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { supabase } from "@/lib/supabase";

export function MobileHeader({ title }: { title: string }) {
  const {
    me,
    isSuperadmin,
    establishments,
    activeEstablishmentId,
    activeEstablishmentName,
    setActiveEstablishmentId
  } = useActiveEstablishment();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            {me?.isSuperadmin ? "Superadmin" : me?.isAdmin ? "Admin" : "Staff"}
          </p>
          <h1 className="truncate text-lg font-semibold text-slate-900">{title}</h1>
          {isSuperadmin ? (
            <div className="mt-2 max-w-[280px]">
              <label className="sr-only" htmlFor="establecimiento">
                Establecimiento activo
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
                <p className="mt-1 text-[11px] text-slate-500">Establecimiento: {activeEstablishmentName}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/mas"
            className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white shadow-sm"
            aria-label="Más opciones"
            title="Más"
          >
            <User className="h-5 w-5 text-slate-700" />
          </a>
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

