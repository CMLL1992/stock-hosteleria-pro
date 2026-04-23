/**
 * Opciones fijas para formularios de producto (alineadas con UX móvil y columnas `categoria` / `unidad`).
 * Valores persistidos en minúsculas, sin emoji en la BD.
 */

export const CATEGORIA_PRODUCTO = ["vino", "cerveza", "agua", "refresco", "licor", "comida", "otros"] as const;
export type CategoriaProductoValor = (typeof CATEGORIA_PRODUCTO)[number];

export const UNIDAD_PRODUCTO = ["caja", "barril", "gas", "botella", "bolsa", "unidades"] as const;
export type UnidadProductoValor = (typeof UNIDAD_PRODUCTO)[number];

export const CATEGORIA_OPTIONS: ReadonlyArray<{
  value: CategoriaProductoValor;
  label: string;
}> = [
  { value: "vino", label: "Vino" },
  { value: "cerveza", label: "Cerveza" },
  { value: "agua", label: "Agua" },
  { value: "refresco", label: "Refresco" },
  { value: "licor", label: "Licor" },
  { value: "comida", label: "Comida" },
  { value: "otros", label: "Otros" }
];

export const UNIDAD_OPTIONS: ReadonlyArray<{
  value: UnidadProductoValor;
  label: string;
}> = [
  { value: "caja", label: "Caja" },
  { value: "barril", label: "Barril" },
  { value: "gas", label: "Gas" },
  { value: "botella", label: "Botella" },
  { value: "bolsa", label: "Bolsa" },
  { value: "unidades", label: "Unidades" }
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

/** Mapea texto guardado en BD a un valor del selector. */
export function mapCategoriaDbToValor(raw: string | null | undefined): CategoriaProductoValor {
  const n = norm(raw);
  if (!n) return "otros";

  if (n.includes("vino") || n === "wine") return "vino";
  if (n.includes("cerveza") || n.includes("beer")) return "cerveza";
  if (n.includes("agua") || n === "water") return "agua";
  if (n.includes("refresco") || n.includes("refrescos") || n.includes("soft")) return "refresco";
  if (n.includes("licor") || n.includes("spirit") || n.includes("whisky") || n.includes("ron")) return "licor";
  if (n.includes("comida") || n.includes("food")) return "comida";

  if (
    CATEGORIA_PRODUCTO.includes(n as CategoriaProductoValor)
  ) {
    return n as CategoriaProductoValor;
  }

  // Legacy / variantes
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
  if (n === "bolsa" || n.includes("bolsa") || n.includes("bag")) return "bolsa";
  if (n === "unidades" || n === "uds" || n === "ud" || n === "unidad" || n.includes("unidad")) return "unidades";

  if (UNIDAD_PRODUCTO.includes(n as UnidadProductoValor)) {
    return n as UnidadProductoValor;
  }

  return "botella";
}

/** Etiqueta legible (sin depender del emoji en mapas). */
export function etiquetaCategoriaMostrada(raw: string | null | undefined): string {
  const v = mapCategoriaDbToValor(raw);
  const opt = CATEGORIA_OPTIONS.find((o) => o.value === v);
  return opt?.label ?? v;
}
