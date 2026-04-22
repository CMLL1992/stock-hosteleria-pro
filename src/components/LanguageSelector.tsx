"use client";

import { useLanguage, useT, type Lang } from "@/lib/i18n";

export function LanguageSelector({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  const tt = useT();
  return (
    <label className={["flex items-center gap-2 text-xs font-semibold text-slate-600", className].join(" ")}>
      <span className="shrink-0">{tt("common.language")}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.currentTarget.value as Lang)}
        className="min-h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
        aria-label={tt("common.language")}
      >
        <option value="es">ES</option>
        <option value="ca">CAT</option>
        <option value="en">EN</option>
      </select>
    </label>
  );
}

