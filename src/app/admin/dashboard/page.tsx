"use client";

import { DashboardClient } from "@/components/DashboardClient";
import { MobileHeader } from "@/components/MobileHeader";
import { useMyRole } from "@/lib/useMyRole";
import { useTranslations } from "next-intl";
import { useLanguage } from "@/lib/LanguageContext";

export default function AdminDashboardPage() {
  const { data: me, isLoading } = useMyRole();
  const tServer = useTranslations();
  const { t } = useLanguage();

  if (isLoading) return <main className="p-4 text-base text-slate-600">{tServer("common.loading")}</main>;
  if (!me?.isAdmin) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold text-slate-900">{t("dashboard.title")}</h1>
        <p className="mt-2 text-sm text-slate-500">{t("common.accessDenied")}</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title={t("dashboard.title")} showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <DashboardClient />
      </main>
    </div>
  );
}
