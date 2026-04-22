import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import type { Lang } from "@/lib/i18n";
import { LOCALE_COOKIE } from "@/lib/localeShared";
import { loadMessages } from "@/lib/locale";

export default getRequestConfig(async () => {
  const c = cookies().get(LOCALE_COOKIE)?.value?.trim()?.toLowerCase() ?? "";
  const locale: Lang = c === "en" || c === "ca" || c === "es" ? c : "es";
  const messages = await loadMessages(locale);
  return { locale, messages };
});

