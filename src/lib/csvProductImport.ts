/**
 * Importación CSV de productos: columnas FAMILIA, ARTICULO, FORMATO, PRECIO TARIFA
 * y normalización de precios con coma decimal (estilo ES).
 */

export type CsvProductRow = {
  familia: string;
  articulo: string;
  formato: string;
  precioTarifaRaw: string;
  precioTarifa: number;
};

/** Limpia precio: "15,35" "129,20 €" "1.234,56" → number */
export function parsePrecioTarifa(value: string): number {
  const s = value
    .trim()
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  // Si hay coma y punto: asumir miles con punto y decimal con coma (1.234,56)
  if (s.includes(".") && s.includes(",")) {
    const noThousands = s.replace(/\./g, "");
    return Number.parseFloat(noThousands.replace(",", ".")) || 0;
  }
  if (s.includes(",") && !s.includes(".")) {
    return Number.parseFloat(s.replace(",", ".")) || 0;
  }
  return Number.parseFloat(s.replace(",", ".")) || 0;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

/**
 * Separa en campos; respeta comillas "..."; delimitador `,` o `;`.
 */
function splitCsvLine(line: string, separator: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === separator) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function detectSeparator(headerLine: string): "," | ";" {
  const comma = headerLine.split(",").length;
  const sc = headerLine.split(";").length;
  if (sc > comma) return ";";
  return ",";
}

export function parseProductosCsv(text: string): CsvProductRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const normalizeCells = (line: string, sep: "," | ";") => splitCsvLine(line, sep).map(normalizeHeader);

  const hasAllTemplateHeaders = (cells: string[]) => {
    const set = new Set(cells.map((c) => c.replace(/_/g, " ").trim()));
    return (
      set.has("familia") &&
      set.has("articulo") &&
      set.has("formato") &&
      Array.from(set).some((x) => x.includes("precio tarifa") || x.replace(/\s/g, "") === "preciotarifa")
    );
  };

  const hasVendorHeaders = (cells: string[]) => {
    const set = new Set(cells);
    return set.has("productos") && set.has("precio");
  };

  // Encuentra la cabecera real: puede haber líneas tipo "Tabla 1;;;;" antes.
  let headerIdx = -1;
  let sep: "," | ";" = ";";
  let mode: "template" | "vendor" | null = null;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const candidate = lines[i]!;
    const s = detectSeparator(candidate);
    const cells = normalizeCells(candidate, s);
    if (hasAllTemplateHeaders(cells)) {
      headerIdx = i;
      sep = s;
      mode = "template";
      break;
    }
    if (hasVendorHeaders(cells)) {
      headerIdx = i;
      sep = s;
      mode = "vendor";
      break;
    }
  }
  if (headerIdx === -1 || !mode) {
    throw new Error(
      'CSV inválido: no se encontró cabecera. Usa la plantilla (FAMILIA;ARTICULO;FORMATO;PRECIO TARIFA) o un CSV con columnas PRODUCTOS y PRECIO.'
    );
  }

  const headerCells = normalizeCells(lines[headerIdx]!, sep);

  const col = (candidates: string[]): number => {
    for (const c of candidates) {
      const i = headerCells.findIndex(
        (h) => h === c || h.replace(/_/g, " ") === c.replace(/_/g, " ")
      );
      if (i >= 0) return i;
    }
    // Coincidencia por inclusión: "precio tarifa"
    for (const name of candidates) {
      const j = headerCells.findIndex(
        (h) => h.includes(name) || name.includes(h) || h.replace(/\s/g, "") === name.replace(/\s/g, "")
      );
      if (j >= 0) return j;
    }
    return -1;
  };

  const inferFormatoFromArticulo = (articulo: string): string => {
    const a = articulo.trim().toLowerCase();
    if (!a) return "";
    if (a.includes("barril")) return "barril";
    if (a.includes("lata")) return "lata";
    if (a.includes("caja")) return "caja";
    // "2l", "0,7", "0.7", "200ml", "0,33cl"
    if (/\b\d+([.,]\d+)?\s*(l|cl|ml)\b/.test(a) || a.includes("litro")) return "botella";
    return "unidad";
  };

  const rows: CsvProductRow[] = [];

  if (mode === "template") {
    const iFam = col(["familia"]);
    const iArt = col(["articulo"]);
    const iFor = col(["formato"]);
    const iPre = col(["precio tarifa", "precio_tarifa", "preciatarifa"]);

    if (iArt === -1 || iPre === -1) {
      throw new Error('CSV inválido: hacen falta columnas "ARTICULO" y "PRECIO TARIFA".');
    }
    if (iFam === -1) throw new Error('CSV inválido: falta la columna "FAMILIA".');
    if (iFor === -1) throw new Error('CSV inválido: falta la columna "FORMATO".');

    for (const line of lines.slice(headerIdx + 1)) {
      if (!line.trim()) continue;
      const cells = splitCsvLine(line, sep);
      const get = (i: number) => (cells[i] ?? "").trim();
      const familia = get(iFam);
      const articulo = get(iArt);
      const formato = get(iFor);
      const precioRaw = get(iPre);
      if (!articulo) continue;

      const precioTarifa = parsePrecioTarifa(precioRaw);
      rows.push({
        familia,
        articulo,
        formato,
        precioTarifaRaw: precioRaw,
        precioTarifa
      });
    }
    return rows;
  }

  // mode === "vendor": CSV tipo Excel con PRODUCTOS; ... ; PRECIO; ... y secciones / cabeceras repetidas.
  const iArt = col(["productos"]);
  const iPre = col(["precio"]);
  if (iArt === -1 || iPre === -1) {
    throw new Error('CSV inválido: en este formato hacen falta columnas "PRODUCTOS" y "PRECIO".');
  }

  let familiaContext = "";
  const isHeaderAgain = (line: string) => {
    const cells = normalizeCells(line, sep);
    return hasVendorHeaders(cells);
  };

  for (const line of lines.slice(headerIdx + 1)) {
    const upper = line.toUpperCase();
    if (upper.includes("ESTOS PRECIOS CORRESPONDEN A")) {
      familiaContext = line.replace(/;+$/g, "").trim();
      continue;
    }
    if (isHeaderAgain(line)) continue;
    const cells = splitCsvLine(line, sep);
    const articulo = (cells[iArt] ?? "").trim();
    const precioRaw = (cells[iPre] ?? "").trim();
    if (!articulo) continue;
    if (normalizeHeader(articulo) === "productos") continue;
    if (normalizeHeader(articulo) === "tabla 1") continue;
    if (articulo.toLowerCase().includes("precios corresponden a")) continue;

    const precioTarifa = parsePrecioTarifa(precioRaw);
    rows.push({
      familia: familiaContext,
      articulo,
      formato: inferFormatoFromArticulo(articulo),
      precioTarifaRaw: precioRaw,
      precioTarifa
    });
  }
  return rows;
}

export function normalizeNombreClave(articulo: string): string {
  return articulo.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Si el mismo ARTICULO aparece varias veces, prevalece la última fila del archivo. */
export function dedupeCsvRowsLastWins(rows: CsvProductRow[]): CsvProductRow[] {
  const out: CsvProductRow[] = [];
  const seen = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    const k = normalizeNombreClave(r.articulo);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.reverse();
}

const UNIDADES_OK = new Set(["caja", "barril", "botella", "lata", "unidad"]);

/** Convierte FORMATO (texto libre) a valor permitido en unidad, o "unidad" por defecto. */
export function mapFormatoAUnidad(formato: string): string {
  const f = formato.trim().toLowerCase();
  if (!f) return "unidad";
  if (UNIDADES_OK.has(f)) return f;
  if (f.includes("barril") || f.includes("30l") || f.includes(" 30 ")) return "barril";
  if (f.includes("botella")) return "botella";
  if (f.includes("lata")) return "lata";
  if (f.includes("caja")) return "caja";
  return "unidad";
}

export function mapFamiliaATipo(familia: string): string {
  const f = familia.trim().toLowerCase();
  if (f.includes("cerve")) return "cerveza";
  if (f.includes("vino") || f.includes("tinto") || f.includes("blanc")) return "vino";
  if (f.includes("licor") || f.includes("destil")) return "licor";
  if (f.includes("refres") || f.includes("zumo")) return "refresco";
  if (f.includes("agua")) return "agua";
  if (f.includes("barril") || f.includes("grifo")) return "barril";
  return "otros";
}
