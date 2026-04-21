import { Suspense } from "react";
import { ProductList } from "@/components/ProductList";
import { MobileHeader } from "@/components/MobileHeader";
import { RequireSession } from "@/components/RequireSession";

export default function StockPage() {
  return (
    <RequireSession>
      <div className="min-h-dvh">
        <MobileHeader title="Stock" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <Suspense fallback={<p className="text-base text-slate-600">Cargando lista…</p>}>
            <ProductList />
          </Suspense>
        </main>
      </div>
    </RequireSession>
  );
}

