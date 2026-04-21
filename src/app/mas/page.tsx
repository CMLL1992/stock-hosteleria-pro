import { MobileHeader } from "@/components/MobileHeader";
import { MoreClient } from "@/app/mas/ui";
import { Suspense } from "react";

export default function MasPage() {
  return (
    <div className="min-h-dvh">
      <MobileHeader title="Más" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <div className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
          <Suspense fallback={<p className="text-sm text-gray-600">Cargando…</p>}>
            <MoreClient />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

