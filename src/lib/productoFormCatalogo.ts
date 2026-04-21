/**
 * Opciones fijas para formularios de producto (alineadas con UX móvil y columnas `categoria` / `unidad`).
 * Valores persistidos en minúsculas, sin emoji en la BD.
 */

export const CATEGORIA_PRODUCTO = ["vino", "cerveza", "agua", "refresco", "otros"] as const;
export type CategoriaProductoValor = (typeof CATEGORIA_PRODUCTO)[number];

export const UNIDAD_PRODUCTO = ["caja", "barril", "gas", "botella"] as const;
export type UnidadProductoValor = (typeof UNIDAD_PRODUCTO)[number];

export const CATEGORIA_OPTIONS: ReadonlyArray<{
  value: CategoriaProductoValor;
  emoji: string;
  /** Texto visible (emoji + nombre) */
  label: string;
}> = [
  { value: "vino", emoji: "🍷", label: "🍷 Vino" },
  { value: "cerveza", emoji: "🍺", label: "🍺 Cerveza" },
  { value: "agua", emoji: "💧", label: "💧 Agua" },
  { value: "refresco", emoji: "🥤", label: "🥤 Refresco" },
  { value: "otros", emoji: "📦", label: "📦 Otros" }
];

export const UNIDAD_OPTIONS: ReadonlyArray<{
  value: UnidadProductoValor;
  emoji: string;
  label: string;
}> = [
  { value: "caja", emoji: "📦", label: "📦 Caja" },
  { value: "barril", emoji: "🛢️", label: "🛢️ Barril" },
  { value: "gas", emoji: "💨", label: "💨 Gas" },
  { value: "botella", emoji: "🍾", label: "🍾 Botella" }
];

/** Clase Tailwind: ≥48px de alto y 16px de fuente (evita zoom en iOS). */
export const FORM_CONTROL_CLASS =
  "min-h-[48px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10";

export const FORM_CONTROL_CLASS_GRAY =
  "min-h-[48px] w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-black/10";

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Emoji para una clave de categoría conocida o datos legacy. */
export function emojiCategoria(raw: string | null | undefined): string {
  const k = mapCategoriaDbToValor(raw);
  const hit = CATEGORIA_OPTIONS.find((o) => o.value === k);
  return hit?.emoji ?? "📦";
}

/** Mapea texto guardado en BD a un valor del selector. */
export function mapCategoriaDbToValor(raw: string | null | undefined): CategoriaProductoValor {
  const n = norm(raw);
  if (!n) return "otros";

  if (n.includes("vino") || n === "wine") return "vino";
  if (n.includes("cerveza") || n.includes("beer")) return "cerveza";
  if (n.includes("agua") || n === "water") return "agua";
  if (n.includes("refresco") || n.includes("refrescos") || n.includes("soft")) return "refresco";

  if (
    CATEGORIA_PRODUCTO.includes(n as CategoriaProductoValor)
  ) {
    return n as CategoriaProductoValor;
  }

  // Legacy / variantes
  if (n.includes("licor") || n.includes("spirit") || n.includes("whisky") || n.includes("ron")) return "otros";
  if (n === "general" || n === "otros" || n.includes("misc")) return "otros";

  return "otros";
}

export function mapUnidadDbToValor(raw: string | null | undefined): UnidadProductoValor {
  const n = norm(raw);
  if (!n) return "botella";

  if (n === "caja" || n.includes("caja")) return "caja";
  if (n === "barril" || n.includes("barril") || n.includes("keg")) return "barril";
  if (n === "gas" || n.includes("gas")) return "gas";
  if (n === "botella" || n.includes("botella") || n === "lata" || n.includes("lata")) return "botella";

  if (UNIDAD_PRODUCTO.includes(n as UnidadProductoValor)) {
    return n as UnidadProductoValor;
  }

  // "unidad" genérico u otros → botella como comodín de producto suelto
  if (n === "unidad" || n === "uds" || n === "ud") return "botella";

  return "botella";
}

/** Etiqueta legible (sin depender del emoji en mapas). */
export function etiquetaCategoriaMostrada(raw: string | null | undefined): string {
  const v = mapCategoriaDbToValor(raw);
  const opt = CATEGORIA_OPTIONS.find((o) => o.value === v);
  return opt?.label.split(" ").slice(1).join(" ") ?? v;
}
