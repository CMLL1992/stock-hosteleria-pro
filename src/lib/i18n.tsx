"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "es" | "ca" | "en";

const STORAGE_KEY = "ops_lang";

export function getStoredLanguage(): Lang {
  if (typeof window === "undefined") return "es";
  const raw = String(window.localStorage.getItem(STORAGE_KEY) ?? "").trim().toLowerCase();
  if (raw === "ca" || raw === "en" || raw === "es") return raw;
  return "es";
}

export function storeLanguage(lang: Lang) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, lang);
}

type Dict = Record<string, { es: string; ca: string; en: string }>;

const DICT: Dict = {
  // Common
  "common.loading": { es: "Cargando…", ca: "Carregant…", en: "Loading…" },
  "common.accessDenied": { es: "Acceso denegado.", ca: "Accés denegat.", en: "Access denied." },
  "common.close": { es: "Cerrar", ca: "Tancar", en: "Close" },
  "common.searchProduct": { es: "Buscar producto…", ca: "Cercar producte…", en: "Search product…" },
  "common.language": { es: "Idioma", ca: "Idioma", en: "Language" },

  // Admin / Dashboard
  "admin.panel": { es: "Panel de control", ca: "Tauler de control", en: "Control panel" },
  "admin.menuSubtitle": { es: "Menú de administración por áreas.", ca: "Menú d’administració per àrees.", en: "Administration menu by area." },
  "admin.dashboard": { es: "Dashboard", ca: "Tauler", en: "Dashboard" },
  "admin.lowStock": { es: "Bajo mínimos", ca: "Per sota del mínim", en: "Below minimum" },
  "admin.lowStockHint": { es: "Stock actual ≤ stock mínimo", ca: "Stock actual ≤ stock mínim", en: "Current stock ≤ minimum stock" },
  "admin.lowStockEmpty": { es: "No hay productos bajo mínimos.", ca: "No hi ha productes per sota del mínim.", en: "There are no products below minimum." },
  "admin.stockRatioHint": { es: "Stock actual / stock mínimo", ca: "Stock actual / stock mínim", en: "Current stock / minimum stock" },

  // Pedidos
  "orders.title": { es: "Pedidos", ca: "Comandes", en: "Orders" },
  "orders.byProvider": { es: "Pedidos por proveedor", ca: "Comandes per proveïdor", en: "Orders by supplier" },
  "orders.subtitle": {
    es: "Despliega un proveedor, escribe cantidades y envía el pedido por WhatsApp.",
    ca: "Desplega un proveïdor, escriu quantitats i envia la comanda per WhatsApp.",
    en: "Expand a supplier, enter quantities and send the order via WhatsApp."
  },
  "orders.sendWhatsapp": { es: "Enviar pedido a {prov} por WhatsApp", ca: "Enviar comanda a {prov} per WhatsApp", en: "Send order to {prov} via WhatsApp" }
};

function formatTemplate(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

export function t(key: keyof typeof DICT, lang: Lang, vars?: Record<string, string | number>): string {
  const row = DICT[key];
  const base = row?.[lang] ?? row?.es ?? String(key);
  return formatTemplate(base, vars);
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void };
const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => {
    setLangState(getStoredLanguage());
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    storeLanguage(l);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}

export function useT() {
  const { lang } = useLanguage();
  return useCallback((key: keyof typeof DICT, vars?: Record<string, string | number>) => t(key, lang, vars), [lang]);
}

