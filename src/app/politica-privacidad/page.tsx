import { MobileHeader } from "@/components/MobileHeader";

export default function PoliticaPrivacidadPage() {
  return (
    <div className="min-h-dvh">
      <MobileHeader title="Política de Privacidad" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <p className="text-sm text-slate-600">
            Última actualización: 21/04/2026.
          </p>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">1. Responsable</h2>
            <p className="text-sm text-slate-700">
              El responsable del tratamiento es <span className="font-semibold">CM11 Asset Management SLU</span>,
              titular de la plataforma <span className="font-semibold">OPS</span> (en adelante, “OPS by CM11”).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">2. Finalidad</h2>
            <p className="text-sm text-slate-700">
              OPS es una herramienta de gestión de stock para hostelería. Tratamos datos para permitir autenticación,
              gestión de inventario, registro de movimientos y funcionalidades de administración por establecimiento.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">3. Datos tratados</h2>
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
              <li>Datos de acceso: email, identificadores de usuario y tokens de sesión.</li>
              <li>Datos del establecimiento: nombre y plan de suscripción.</li>
              <li>Datos operativos: productos, movimientos de stock, proveedores y precios/escandallos.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">4. Confidencialidad</h2>
            <p className="text-sm text-slate-700">
              La información de precios, proveedores, consumos y márgenes se considera confidencial. OPS aplica un modelo
              multi‑tenant por establecimiento con controles de acceso y políticas de seguridad (RLS) para impedir el
              acceso cruzado entre clientes.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">5. Base jurídica</h2>
            <p className="text-sm text-slate-700">
              El tratamiento se basa en la ejecución del contrato (prestación del servicio) y en el interés legítimo de
              garantizar la seguridad y continuidad del sistema.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">6. Conservación</h2>
            <p className="text-sm text-slate-700">
              Conservamos los datos mientras exista relación contractual y, posteriormente, durante los plazos necesarios
              para cumplimiento de obligaciones legales o defensa de reclamaciones.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">7. Derechos</h2>
            <p className="text-sm text-slate-700">
              Puedes solicitar acceso, rectificación, supresión, limitación u oposición. Para ejercer derechos, contacta
              con el administrador del establecimiento o con CM11 Asset Management SLU.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">8. Propiedad intelectual</h2>
            <p className="text-sm text-slate-700">
              OPS by CM11 es una obra protegida. Se prohíbe la reproducción, distribución o ingeniería inversa sin
              autorización expresa.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

