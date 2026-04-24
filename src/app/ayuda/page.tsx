import { MobileHeader } from "@/components/MobileHeader";
import { RequireSession } from "@/components/RequireSession";
import { HelpChat } from "@/app/ayuda/HelpChat";

export default function AyudaPage() {
  return (
    <RequireSession>
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Ayuda" showBack backHref="/mas" />
        <main className="mx-auto flex max-w-3xl px-4 pb-28 pt-4 sm:px-5">
          <div className="w-full">
            <HelpChat />
          </div>
        </main>
      </div>
    </RequireSession>
  );
}
