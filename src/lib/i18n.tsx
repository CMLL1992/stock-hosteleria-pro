export type Lang = "es" | "ca" | "en";
export function isLang(x: string): x is Lang {
  return x === "es" || x === "ca" || x === "en";
}

