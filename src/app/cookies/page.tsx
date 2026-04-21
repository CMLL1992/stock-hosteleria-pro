import { MobileHeader } from "@/components/MobileHeader";

export default function CookiesPage() {
  return (
    <div className="min-h-dvh">
      <MobileHeader title="Cookies" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <p className="text-sm text-slate-700">
            Esta sección permite gestionar preferencias de cookies/almacenamiento local. Actualmente OPS utiliza
            almacenamiento local para:
          </p>
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            <li>Persistencia de sesión (Supabase).</li>
            <li>Preferencia de establecimiento activo (solo SuperAdmin).</li>
            <li>Consentimiento del banner de cookies.</li>
          </ul>
          <p className="text-sm text-slate-700">La gestión avanzada se habilitará en futuras versiones.</p>
        </div>
      </main>
    </div>
  );
}

