"use client";

import { DashboardClient } from "@/components/DashboardClient";
import { MobileHeader } from "@/components/MobileHeader";
import { useMyRole } from "@/lib/useMyRole";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useTranslations } from "next-intl";

export default function AdminDashboardPage() {
  const { data: me, isLoading } = useMyRole();
  const t = useTranslations();

  if (isLoading) return <main className="p-4 text-base text-slate-600">{t("common.loading")}</main>;
  if (!me?.isAdmin) {
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
        <div className="mb-4 flex justify-end">
          <LanguageSelector />
        </div>
        <DashboardClient />
      </main>
    </div>
  );
}
