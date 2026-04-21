import { MobileHeader } from "@/components/MobileHeader";

export default function TerminosServicioPage() {
  return (
    <div className="min-h-dvh">
      <MobileHeader title="Términos de Servicio" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <p className="text-sm text-slate-600">Última actualización: 21/04/2026.</p>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">1. Objeto</h2>
            <p className="text-sm text-slate-700">
              Estos Términos regulan el uso de OPS by CM11 (CM11 Asset Management SLU), una plataforma SaaS de gestión de
              stock y escandallos para hostelería.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">2. Cuenta y acceso</h2>
            <p className="text-sm text-slate-700">
              El acceso está restringido a usuarios autorizados por establecimiento. Cada usuario queda asignado a un
              establecimiento y no puede elegir o modificar dicho contexto.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">3. Seguridad y multi‑tenant</h2>
            <p className="text-sm text-slate-700">
              OPS implementa controles de aislamiento por establecimiento y políticas RLS a nivel de base de datos para
              evitar accesos cruzados. El cliente se compromete a custodiar credenciales y limitar su uso interno.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">4. Confidencialidad</h2>
            <p className="text-sm text-slate-700">
              Los datos de proveedores, precios, consumos, márgenes y escandallos se consideran confidenciales. Queda
              prohibida su divulgación a terceros salvo obligación legal.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">5. Propiedad intelectual</h2>
            <p className="text-sm text-slate-700">
              OPS by CM11 y sus componentes (código, diseño, marca y documentación) son propiedad de CM11 Asset Management
              SLU. No se concede licencia salvo la necesaria para el uso del servicio.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">6. Limitación de responsabilidad</h2>
            <p className="text-sm text-slate-700">
              OPS se proporciona “tal cual”. CM11 Asset Management SLU no será responsable de pérdidas indirectas,
              interrupciones externas, o uso indebido de credenciales.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">7. Modificaciones</h2>
            <p className="text-sm text-slate-700">
              Podemos actualizar estas condiciones por motivos legales o técnicos. La continuidad de uso implica
              aceptación.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

