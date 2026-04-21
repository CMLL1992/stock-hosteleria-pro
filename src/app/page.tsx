import { MobileHeader } from "@/components/MobileHeader";
import { DashboardClient } from "@/components/DashboardClient";
import { RequireSession } from "@/components/RequireSession";

export default function HomePage() {
  return (
    <RequireSession>
      <div className="min-h-dvh">
        <MobileHeader title="Dashboard" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <DashboardClient />
        </main>
      </div>
    </RequireSession>
  );
}

