"use client";

import { DashboardClient } from "@/components/DashboardClient";
import { MobileHeader } from "@/components/MobileHeader";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";

export default function AdminDashboardPage() {
  const { data: me, isLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canAccessDashboard = hasPermission(role, "staff");

  if (isLoading) return <main className="p-4 text-base text-slate-600">Cargando…</main>;
  if (!canAccessDashboard) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-2 text-sm text-slate-500">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Dashboard" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <DashboardClient />
      </main>
    </div>
  );
}
