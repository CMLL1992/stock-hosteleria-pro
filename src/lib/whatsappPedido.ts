/** Dígitos para wa.me (sin + inicial obligatoria en muchos casos). */
import type { Lang } from "@/lib/i18n";

export function digitsWaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length ? d : null;
}

export function deficitPedido(stockActual: number, stockMinimo: number): number {
  return Math.max(0, stockMinimo - stockActual);
}

export function urlWhatsApp(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
}

function formatUnidad(cantidad: number, unidadRaw: string | null | undefined): string {
  const n = Math.trunc(Number(cantidad));
  if (!Number.isFinite(n)) return "unidades";

  const u0 = (unidadRaw ?? "").trim().toLowerCase();
  if (!u0) return n === 1 ? "unidad" : "unidades";

  // Si ya está en plural (heurística simple), no lo tocamos.
  if (n !== 1 && u0.endsWith("s")) return u0;

  if (n === 1) return u0;

  const last = u0.slice(-1);
  const esVocal = "aeiouáéíóú".includes(last);
  // Regla A: vocal -> +s, Regla B: consonante -> +es
  return esVocal ? `${u0}s` : `${u0}es`;
}

function formatCantidadUnidad(cantidad: number, unidadRaw: string | null | undefined): string {
  const n = Math.trunc(Number(cantidad));
  const unidad = formatUnidad(n, unidadRaw);
  return `${n} ${unidad}`;
}

function getActiveLang(): Lang {
  return "es";
}

function waText(lang: Lang) {
  if (lang === "en") {
    return {
      stockHeader: "*STOCK ORDER*",
      helloNeed: "Hello, I need to replenish:",
      product: "*Product:*",
      qty: "*Quantity:*",
      thanks: "Thank you!",
      replenishmentHead: (prov: string) => `Order for ${prov}:`,
      basketHead: (prov: string) => `Order for ${prov}:`,
      of: "of"
    };
  }
  if (lang === "ca") {
    return {
      stockHeader: "*COMANDA D’ESTOC*",
      helloNeed: "Hola, necessito reposar:",
      product: "*Producte:*",
      qty: "*Quantitat:*",
      thanks: "Gràcies!",
      replenishmentHead: (prov: string) => `Comanda per a ${prov}:`,
      basketHead: (prov: string) => `Comanda per a ${prov}:`,
      of: "de"
    };
  }
  return {
    stockHeader: "*PEDIDO DE STOCK*",
    helloNeed: "Hola, necesito reponer:",
    product: "*Producto:*",
    qty: "*Cantidad:*",
    thanks: "¡Gracias!",
    replenishmentHead: (prov: string) => `Pedido para ${prov}:`,
    basketHead: (prov: string) => `Pedido para ${prov}:`,
    of: "de"
  };
}

/**
 * Mensaje estándar de pedido de stock (una línea de producto).
 * Cantidad mostrada: unidades a reponer hasta el mínimo (mínimo 1 si hace falta pedir).
 */
export function mensajePedidoStockProfesional(
  nombre: string,
  stockActual: number,
  stockMinimo: number,
  unidad: string | null,
  lang?: Lang
): string {
  const l = lang ?? getActiveLang();
  const txt = waText(l);
  const diff = deficitPedido(stockActual, stockMinimo);
  const cant = diff > 0 ? diff : Math.max(1, stockMinimo - stockActual);
  return [
    txt.stockHeader,
    txt.helloNeed,
    `- ${txt.product} ${nombre}`,
    `- ${txt.qty} ${formatCantidadUnidad(cant, unidad)}`,
    txt.thanks
  ].join("\n");
}

/** Mensaje corto (legacy / tests). */
export function mensajePedidoMovil(articulo: string, cantidad: number): string {
  return mensajePedidoStockProfesional(articulo, 0, cantidad, "uds");
}

/**
 * Abre WhatsApp al proveedor si hay teléfono; si no, `api.whatsapp.com` para elegir contacto.
 */
export function waUrlSendText(message: string, phoneDigits: string | null): string {
  if (phoneDigits) return urlWhatsApp(phoneDigits, message);
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
}

export function mensajePedidoGlobalLineas(
  lineas: Array<{ articulo: string; stock_actual: number; stock_minimo: number; unidad: string | null }>,
  lang?: Lang
): string {
  const l = lang ?? getActiveLang();
  const txt = waText(l);
  const bloques = lineas.map((l) => {
    const diff = deficitPedido(l.stock_actual, l.stock_minimo);
    const cant = diff > 0 ? diff : Math.max(1, l.stock_minimo - l.stock_actual);
    return [`- ${txt.product} ${l.articulo}`, `- ${txt.qty} ${formatCantidadUnidad(cant, l.unidad)}`].join("\n");
  });
  return [txt.stockHeader, txt.helloNeed, ...bloques, txt.thanks].join("\n");
}

export type ProductoPedidoWa = {
  articulo: string;
  stock_actual: number;
  stock_minimo: number;
  unidad: string | null;
  proveedor: { nombre: string; telefono_whatsapp: string | null } | null;
};

/**
 * Enlace WhatsApp si el artículo está en alerta (actual ≤ mínimo).
 * Con proveedor y teléfono → `wa.me` a ese número; sin teléfono → envío genérico con el mismo texto.
 */
export function waUrlProductoPedido(p: ProductoPedidoWa): string | null {
  if (p.stock_actual > p.stock_minimo) return null;
  const msg = mensajePedidoStockProfesional(p.articulo, p.stock_actual, p.stock_minimo, p.unidad);
  const tel = digitsWaPhone(p.proveedor?.telefono_whatsapp);
  return waUrlSendText(msg, tel);
}

export function waUrlPedidoGlobal(bajoMinimos: ProductoPedidoWa[]): string | null {
  if (!bajoMinimos.length) return null;
  const head = bajoMinimos.find((p) => digitsWaPhone(p.proveedor?.telefono_whatsapp));
  const tel = head ? digitsWaPhone(head.proveedor?.telefono_whatsapp) : null;
  if (!tel || !head) return null;
  const lineas = bajoMinimos.map((p) => ({
    articulo: p.articulo,
    stock_actual: p.stock_actual,
    stock_minimo: p.stock_minimo,
    unidad: p.unidad
  }));
  return urlWhatsApp(tel, mensajePedidoGlobalLineas(lineas));
}

/** Líneas para cesta: cantidad sugerida para reponer (mín. 1 si hace falta pedir). */
export function cantidadSugeridaPedido(stockActual: number, stockMinimo: number): number {
  const d = deficitPedido(stockActual, stockMinimo);
  return d > 0 ? d : Math.max(1, stockMinimo - stockActual);
}

/**
 * Mensaje multi-línea por proveedor (cesta).
 * Ej.: "Hola Distribuidora X, pedido de Piqui Blinders:\n- 10 caja de Estrella"
 */
export function mensajePedidoCestaPorProveedor(opts: {
  nombreEstablecimiento: string;
  nombreProveedor: string;
  lineas: Array<{ articulo: string; cantidad: number; unidad: string | null }>;
  lang?: Lang;
}): string {
  const l = opts.lang ?? getActiveLang();
  const txt = waText(l);
  const est = opts.nombreEstablecimiento.trim() || "mi local";
  const prov = opts.nombreProveedor.trim() || "Proveedor";
  const body = opts.lineas.map((l) => {
    return `- ${formatCantidadUnidad(l.cantidad, l.unidad)} ${txt.of} ${l.articulo}`;
  });
  void est; // mantenemos firma sin romper llamadas actuales
  return [txt.basketHead(prov), "", ...body].join("\n");
}

/**
 * Pedido agrupado (pantalla Pedidos): solo líneas con cantidad > 0.
 * "Hola [Proveedor], este es el pedido de reposición de [Local]:\n\n- [cant] [unidad] de [artículo]"
 */
export function mensajePedidoReposicionPorProveedor(opts: {
  nombreEstablecimiento: string;
  nombreProveedor: string;
  lineas: Array<{ articulo: string; cantidad: number; unidad: string | null | undefined }>;
  lang?: Lang;
}): string {
  const l = opts.lang ?? getActiveLang();
  const txt = waText(l);
  const est = opts.nombreEstablecimiento.trim() || "Piqui Blinders";
  const prov = opts.nombreProveedor.trim() || "Proveedor";
  const lineas = opts.lineas
    .filter((l) => l.cantidad > 0 && l.articulo.trim())
    .map((l) => `- ${formatCantidadUnidad(l.cantidad, l.unidad)} ${txt.of} ${l.articulo.trim()}`);
  void est;
  return [txt.replenishmentHead(prov), "", ...lineas].join("\n");
}

export function waUrlPedidoAgrupadoProveedor(opts: {
  nombreProveedor: string;
  telefonoWhatsapp: string | null;
  nombreEstablecimiento: string;
  lineas: Array<{ articulo: string; cantidad: number; unidad: string | null | undefined }>;
}): string {
  const msg = mensajePedidoReposicionPorProveedor({
    nombreEstablecimiento: opts.nombreEstablecimiento,
    nombreProveedor: opts.nombreProveedor,
    lineas: opts.lineas
  });
  return waUrlSendText(msg, digitsWaPhone(opts.telefonoWhatsapp));
}

export function waUrlPedidoCestaProveedor(opts: {
  nombreProveedor: string;
  telefonoWhatsapp: string | null;
  nombreEstablecimiento: string;
  lineas: Array<{ articulo: string; cantidad: number; unidad: string | null }>;
}): string {
  const msg = mensajePedidoCestaPorProveedor({
    nombreEstablecimiento: opts.nombreEstablecimiento,
    nombreProveedor: opts.nombreProveedor,
    lineas: opts.lineas
  });
  return waUrlSendText(msg, digitsWaPhone(opts.telefonoWhatsapp));
}
