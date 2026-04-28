"use client";

import { MobileHeader } from "@/components/MobileHeader";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";

export default function AdminEstablecimientoPage() {
  const { activeEstablishmentName, activeEstablishmentSlug } = useActiveEstablishment();

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Establecimiento" showBack backHref="/admin" />
      <main className="mx-auto w-full max-w-3xl p-4 pb-28">
        <section className="premium-card space-y-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Perfil del local</p>
            <p className="mt-1 text-lg font-black tracking-tight text-slate-900">{(activeEstablishmentName ?? "").trim() || "Mi local"}</p>
            <p className="mt-1 text-sm text-slate-600">
              Slug: <span className="font-semibold text-slate-900">{activeEstablishmentSlug ?? "—"}</span>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

