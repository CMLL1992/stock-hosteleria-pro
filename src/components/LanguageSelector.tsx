"use client";

import { useLanguage, type Language } from "@/lib/LanguageContext";

export function LanguageSelector({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <label className={["flex items-center gap-2 text-xs font-semibold text-slate-600", className].join(" ")}>
      <span className="shrink-0">{t("common.language")}</span>
      <select
        value={lang}
        onChange={(e) => {
          setLang(e.currentTarget.value as Language);
        }}
        className="min-h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
        aria-label={t("common.language")}
      >
        <option value="es">ES</option>
        <option value="cat">CAT</option>
        <option value="en">EN</option>
      </select>
    </label>
  );
}

