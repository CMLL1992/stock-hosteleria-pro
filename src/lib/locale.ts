import type { Lang } from "@/lib/i18n";
import { cookies } from "next/headers";

export const LOCALE_COOKIE = "ops_lang";

export function readLocaleCookie(): Lang {
  const c = cookies().get(LOCALE_COOKIE)?.value?.trim()?.toLowerCase() ?? "";
  if (c === "en" || c === "ca" || c === "es") return c;
  return "es";
}

export async function loadMessages(locale: Lang): Promise<Record<string, string>> {
  // JSON import estático para que Next lo bundlee.
  if (locale === "en") return (await import("@/messages/en.json")).default as unknown as Record<string, string>;
  if (locale === "ca") return (await import("@/messages/ca.json")).default as unknown as Record<string, string>;
  return (await import("@/messages/es.json")).default as unknown as Record<string, string>;
}

