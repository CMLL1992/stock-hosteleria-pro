import { MobileHeader } from "@/components/MobileHeader";
import { RequireSession } from "@/components/RequireSession";
import { ChecklistClient } from "@/app/checklist/ui";

export default function ChecklistPage() {
  return (
    <RequireSession>
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Checklist" showBack backHref="/mas" />
        <main className="mx-auto max-w-lg px-4 pb-28 pt-4">
          <header className="mb-4">
            <h1 className="text-lg font-bold text-slate-900">Checklist operativo</h1>
            <p className="mt-1 text-sm text-slate-600">Marca todo y firma en un minuto.</p>
          </header>
          <ChecklistClient />
        </main>
      </div>
    </RequireSession>
  );
}
