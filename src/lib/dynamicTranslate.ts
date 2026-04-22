"use client";

import type { Lang } from "@/lib/i18n";

type CacheEntry = { v: string; ts: number };
const CACHE_PREFIX = "ops_i18n_dyn:";

function cacheKey(term: string, lang: Lang) {
  return `${CACHE_PREFIX}${lang}:${term.trim().toLowerCase()}`;
}

export function getCachedTranslation(term: string, lang: Lang): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(term, lang));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.v) return null;
    return String(parsed.v);
  } catch {
    return null;
  }
}

export function setCachedTranslation(term: string, lang: Lang, value: string) {
  if (typeof window === "undefined") return;
  try {
    const payload: CacheEntry = { v: value, ts: Date.now() };
    window.localStorage.setItem(cacheKey(term, lang), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

/**
 * Traducción dinámica “IA-powered”.
 * - Solo intenta llamar al backend si no existe cache local.
 * - Si la API no está configurada o falla, devuelve el término original.
 */
export async function translateDynamic(term: string, lang: Lang): Promise<string> {
  const clean = term.trim();
  if (!clean) return term;
  if (lang === "es") return clean;
  const cached = getCachedTranslation(clean, lang);
  if (cached) return cached;
  try {
    const res = await fetch("/api/i18n/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: clean, lang })
    });
    if (!res.ok) return clean;
    const data = (await res.json()) as { translation?: unknown };
    const tr = String(data.translation ?? "").trim();
    if (!tr) return clean;
    setCachedTranslation(clean, lang, tr);
    return tr;
  } catch {
    return clean;
  }
}

