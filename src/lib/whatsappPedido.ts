/** Dígitos para wa.me (sin + inicial obligatoria en muchos casos). */
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

function unidadLegible(u: string | null | undefined): string {
  const t = (u ?? "uds").trim() || "uds";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/**
 * Mensaje estándar de pedido de stock (una línea de producto).
 * Cantidad mostrada: unidades a reponer hasta el mínimo (mínimo 1 si hace falta pedir).
 */
export function mensajePedidoStockProfesional(nombre: string, stockActual: number, stockMinimo: number, unidad: string | null): string {
  const diff = deficitPedido(stockActual, stockMinimo);
  const cant = diff > 0 ? diff : Math.max(1, stockMinimo - stockActual);
  const u = unidadLegible(unidad);
  return [
    "*PEDIDO DE STOCK*",
    "Hola, necesito reponer:",
    `- *Producto:* ${nombre}`,
    `- *Cantidad:* ${cant} ${u}`,
    "¡Gracias!"
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
  lineas: Array<{ articulo: string; stock_actual: number; stock_minimo: number; unidad: string | null }>
): string {
  const bloques = lineas.map((l) => {
    const diff = deficitPedido(l.stock_actual, l.stock_minimo);
    const cant = diff > 0 ? diff : Math.max(1, l.stock_minimo - l.stock_actual);
    const u = unidadLegible(l.unidad);
    return [`- *Producto:* ${l.articulo}`, `- *Cantidad:* ${cant} ${u}`].join("\n");
  });
  return ["*PEDIDO DE STOCK*", "Hola, necesito reponer:", ...bloques, "¡Gracias!"].join("\n");
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
}): string {
  const est = opts.nombreEstablecimiento.trim() || "mi local";
  const prov = opts.nombreProveedor.trim() || "Proveedor";
  const body = opts.lineas.map((l) => {
    const u = unidadLegible(l.unidad);
    return `- ${l.cantidad} ${u} de ${l.articulo}`;
  });
  return [`Hola ${prov}, pedido de ${est}:`, "", ...body].join("\n");
}

/**
 * Pedido agrupado (pantalla Pedidos): solo líneas con cantidad > 0.
 * "Hola [Proveedor], pedido de [Local]:\n- [cant] [artículo]"
 */
export function mensajePedidoAgrupadoLineasSimple(opts: {
  nombreEstablecimiento: string;
  nombreProveedor: string;
  lineas: Array<{ articulo: string; cantidad: number }>;
}): string {
  const est = opts.nombreEstablecimiento.trim() || "mi local";
  const prov = opts.nombreProveedor.trim() || "Proveedor";
  const lineas = opts.lineas
    .filter((l) => l.cantidad > 0 && l.articulo.trim())
    .map((l) => `- ${l.cantidad} ${l.articulo.trim()}`);
  return [`Hola ${prov}, pedido de ${est}:`, "", ...lineas].join("\n");
}

export function waUrlPedidoAgrupadoProveedor(opts: {
  nombreProveedor: string;
  telefonoWhatsapp: string | null;
  nombreEstablecimiento: string;
  lineas: Array<{ articulo: string; cantidad: number }>;
}): string {
  const msg = mensajePedidoAgrupadoLineasSimple({
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
