import Link from "next/link";
import { MobileHeader } from "@/components/MobileHeader";
import { RequireSession } from "@/components/RequireSession";
import { HelpChat } from "@/app/ayuda/HelpChat";

export default function AyudaPage() {
  return (
    <RequireSession>
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Ayuda" showBack backHref="/mas" />
        <main className="mx-auto max-w-3xl space-y-6 px-4 pb-28 pt-4 sm:px-5">
          <header>
            <h1 className="text-xl font-bold text-slate-900">Central de ayuda</h1>
            <p className="mt-1 text-sm text-slate-600">
              Documentación rápida y asistente para el uso de <strong>OPS</strong> (App Piqui Blinders).
            </p>
            <p className="mt-2 text-xs text-slate-500">
              También puedes abrir esta pantalla con el botón <strong className="text-slate-700">?</strong> en la cabecera.
            </p>
          </header>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Escandallos</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
              <li>
                <strong>Escandallos (compra / finanzas)</strong> en <Link className="font-semibold underline" href="/admin/escandallos">Admin → Escandallos</Link>: precio tarifa, caja, descuentos, IVA y PVP por producto. Sirve para valorar inventario y márgenes de lo que compras.
              </li>
              <li>
                <strong>Escandallos de cocina</strong> en <Link className="font-semibold underline" href="/admin/escandallos/nuevo">Nuevo (Cocina)</Link>: coste teórico por ración a partir de ingredientes (g/ml y €/kg o €/L), merma y multiplicador.{" "}
                <strong>No mueve stock</strong>; es ingeniería de menú con nombre de plato libre.
              </li>
            </ul>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Stock e inventario</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
              <li>
                La vista <Link className="font-semibold underline" href="/stock">Stock</Link> muestra el catálogo del establecimiento activo y el stock actual.
              </li>
              <li>
                Los movimientos (entradas/salidas) actualizan el stock; revisa <strong>Admin → Movimientos</strong> para el histórico.
              </li>
              <li>
                Puedes exportar un backup CSV del catálogo desde <Link className="font-semibold underline" href="/mas">Más</Link> si tu rol lo permite.
              </li>
            </ul>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Checklist operativo</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">
              <li>
                En <Link className="font-semibold underline" href="/checklist">Checklist</Link> elige <strong>Apertura</strong> o <strong>Cierre</strong>, marca todas las tareas y pulsa <strong>Firmar y finalizar</strong>. Queda guardada la hora y tu usuario.
              </li>
              <li>
                El superadmin ve el historial en <Link className="font-semibold underline" href="/admin/checklists">Admin → Checklists</Link> (por día y local).
              </li>
            </ul>
          </section>

          <HelpChat />
        </main>
      </div>
    </RequireSession>
  );
}
