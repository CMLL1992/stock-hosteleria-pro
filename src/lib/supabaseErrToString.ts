export function supabaseErrToString(e: unknown): string {
  const lang = (() => {
    if (typeof document === "undefined") return "es";
    const m = document.cookie.match(/(?:^|; )ops_lang=([^;]*)/);
    const v = decodeURIComponent(m?.[1] ?? "").trim().toLowerCase();
    if (v === "en") return "en";
    if (v === "cat" || v === "ca") return "cat";
    return "es";
  })();

  const DEFAULT_MSG =
    lang === "en"
      ? "Could not complete the action. Check your connection and try again."
      : lang === "cat"
        ? "No s’ha pogut completar l’acció. Revisa la connexió i torna-ho a provar."
        : "No se pudo completar la acción. Revisa la conexión y vuelve a intentarlo.";

  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object" && e) {
    const anyErr = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const msg = typeof anyErr.message === "string" ? anyErr.message : "";
    const details = typeof anyErr.details === "string" ? anyErr.details : "";
    const hint = typeof anyErr.hint === "string" ? anyErr.hint : "";
    const code = typeof anyErr.code === "string" ? anyErr.code : "";
    const merged = [msg, details, hint, code].filter(Boolean).join(" · ");
    if (merged) return merged;
    try {
      const json = JSON.stringify(e);
      if (json && json !== "{}") return json;
    } catch {
      // ignore
    }
  }
  return DEFAULT_MSG;
}

