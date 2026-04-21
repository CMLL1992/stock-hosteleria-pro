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

/** Mensaje corto para flujo móvil (pedido por artículo). */
export function mensajePedidoMovil(articulo: string, cantidad: number): string {
  return `Hola, necesito pedir: ${articulo} - ${cantidad}`;
}

/**
 * Abre WhatsApp al proveedor si hay teléfono; si no, `api.whatsapp.com` para elegir contacto.
 */
export function waUrlSendText(message: string, phoneDigits: string | null): string {
  if (phoneDigits) return urlWhatsApp(phoneDigits, message);
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
}

export function mensajePedidoUnitario(opts: {
  proveedorNombre: string;
  articulo: string;
  deficit: number;
  unidad: string;
}): string {
  const u = (opts.unidad || "uds").trim();
  return `Hola ${opts.proveedorNombre}, necesito reponer el siguiente artículo: *${opts.articulo}* (Cantidad estimada: ${opts.deficit} ${u}).`;
}

export function mensajePedidoGlobal(
  proveedorNombre: string,
  lineas: Array<{ articulo: string; deficit: number; unidad: string }>
): string {
  const cuerpo = lineas
    .map((l) => {
      const u = (l.unidad || "uds").trim();
      return `• *${l.articulo}* (Cantidad estimada: ${l.deficit} ${u})`;
    })
    .join("\n");
  return `Hola ${proveedorNombre}, necesito reponer los siguientes artículos:\n\n${cuerpo}`;
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
  const cant = Math.max(1, deficitPedido(p.stock_actual, p.stock_minimo));
  const msg = mensajePedidoMovil(p.articulo, cant);
  const tel = digitsWaPhone(p.proveedor?.telefono_whatsapp);
  return waUrlSendText(msg, tel);
}

export function waUrlPedidoGlobal(bajoMinimos: ProductoPedidoWa[]): string | null {
  if (!bajoMinimos.length) return null;
  const head = bajoMinimos.find((p) => digitsWaPhone(p.proveedor?.telefono_whatsapp));
  const tel = head ? digitsWaPhone(head.proveedor?.telefono_whatsapp) : null;
  if (!tel || !head) return null;
  const prov = head.proveedor?.nombre ?? "Proveedor";
  const lineas = bajoMinimos.map((p) => ({
    articulo: p.articulo,
    deficit: Math.max(1, deficitPedido(p.stock_actual, p.stock_minimo)),
    unidad: p.unidad ?? "uds"
  }));
  return urlWhatsApp(tel, mensajePedidoGlobal(prov, lineas));
}
