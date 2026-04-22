"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LOCALE_COOKIE } from "@/lib/localeShared";

type Dict = Record<string, unknown>;

import ES from "@/../locales/es.json";
import CAT from "@/../locales/cat.json";
import EN from "@/../locales/en.json";

export type Language = "es" | "cat" | "en";

const DICTS: Record<Language, Dict> = {
  es: ES as Dict,
  cat: CAT as Dict,
  en: EN as Dict
};

function getInitialLang(): Language {
  if (typeof document === "undefined") return "es";
  const cookie = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))?.[1] ?? "";
  const v = decodeURIComponent(cookie).trim().toLowerCase();
  if (v === "en") return "en";
  if (v === "cat" || v === "ca") return "cat";
  if (v === "es") return "es";
  return "es";
}

function setLangCookie(lang: Language) {
  const cookieVal = lang === "cat" ? "cat" : lang;
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(cookieVal)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  try {
    window.localStorage.setItem("ops_lang", cookieVal);
  } catch {
    // ignore
  }
}

function formatTemplate(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

function getByPath(obj: Dict, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

type Ctx = {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const C = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("es");

  useEffect(() => {
    setLangState(getInitialLang());
  }, []);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    if (typeof document !== "undefined") setLangCookie(l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = DICTS[lang] ?? DICTS.es;
      const v = getByPath(dict, key);
      if (typeof v === "string") return formatTemplate(v, vars);
      // fallback
      const fb = getByPath(DICTS.es, key);
      if (typeof fb === "string") {
        if (typeof console !== "undefined") console.warn(`[i18n] Falta traducción "${key}" para "${lang}"`);
        return formatTemplate(fb, vars);
      }
      if (typeof console !== "undefined") console.warn(`[i18n] Clave inexistente "${key}"`);
      return key;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useLanguage() {
  const ctx = useContext(C);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}

