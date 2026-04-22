"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE } from "@/lib/localeShared";
import type { Lang } from "@/lib/i18n";
import { useTranslations } from "next-intl";

export function LanguageSelector({ className = "" }: { className?: string }) {
  const router = useRouter();
  const t = useTranslations();
  const [lang, setLang] = useState<Lang>("es");

  useEffect(() => {
    const current = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))?.[1] ?? "es";
    const decoded = decodeURIComponent(current) as Lang;
    setLang(decoded === "en" || decoded === "ca" || decoded === "es" ? decoded : "es");
  }, []);
  return (
    <label className={["flex items-center gap-2 text-xs font-semibold text-slate-600", className].join(" ")}>
      <span className="shrink-0">{t("common.language")}</span>
      <select
        value={lang}
        onChange={(e) => {
          const next = e.currentTarget.value as Lang;
          setLang(next);
          // Cookie persistente (cross-device si el usuario comparte la sesión en el mismo navegador;
          // para cross-device real, se puede persistir en Supabase más adelante).
          document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax`;
          // Transición suave: refresca datos de servidor sin navegación completa.
          startTransition(() => router.refresh());
        }}
        className="min-h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
        aria-label={t("common.language")}
      >
        <option value="es">ES</option>
        <option value="ca">CAT</option>
        <option value="en">EN</option>
      </select>
    </label>
  );
}

