import { MobileHeader } from "@/components/MobileHeader";
import { RequireSession } from "@/components/RequireSession";
import { PedidosReposicionClient } from "@/components/PedidosReposicionClient";

export default function PedidosPage() {
  return (
    <RequireSession>
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Pedidos" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <PedidosReposicionClient />
        </main>
      </div>
    </RequireSession>
  );
}

