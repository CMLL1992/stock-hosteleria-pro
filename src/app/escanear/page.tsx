import { MobileHeader } from "@/components/MobileHeader";
import { ScanClient } from "@/app/escanear/ui";

export default function ScanPage() {
  return (
    <div className="min-h-dvh">
      <MobileHeader title="Escanear" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <div className="rounded-3xl border border-gray-100 bg-white p-3 shadow-sm">
          <ScanClient />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Consejo: si el escaneo falla en iOS, prueba a dar permiso de cámara y usar buena luz.
        </p>
      </main>
    </div>
  );
}

