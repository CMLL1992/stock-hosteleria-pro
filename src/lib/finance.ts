export type DescuentoTipo = "%" | "€";
export type IvaPct = 4 | 10 | 21;

export type ProductoFinanzas = {
  precio_tarifa: number | null;
  descuento_valor: number | null;
  descuento_tipo: DescuentoTipo | string | null;
  iva_compra: number | null;
  pvp: number | null;
  iva_venta: number | null;
};

function n(x: unknown): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function formatEUR(x: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(x);
}

export function normalizeIvaPct(v: unknown, fallback: IvaPct): IvaPct {
  const x = n(v);
  if (x === 4 || x === 10 || x === 21) return x;
  return fallback;
}

export function descuentoAplicado(p: ProductoFinanzas): number {
  const tarifa = n(p.precio_tarifa);
  const desc = n(p.descuento_valor);
  const tipo = (p.descuento_tipo ?? "%") as string;
  if (tipo === "%") return (tarifa * desc) / 100;
  return desc;
}

export function baseCompraSinIva(p: ProductoFinanzas): number {
  const tarifa = n(p.precio_tarifa);
  const desc = descuentoAplicado(p);
  return Math.max(0, tarifa - desc);
}

export function costeNeto(p: ProductoFinanzas): number {
  const base = baseCompraSinIva(p);
  const iva = normalizeIvaPct(p.iva_compra, 10);
  return round2(base * (1 + iva / 100));
}

export function ventaNetaSinIva(p: ProductoFinanzas): number {
  const pvp = n(p.pvp);
  const ivaV = normalizeIvaPct(p.iva_venta, 10);
  const denom = 1 + ivaV / 100;
  if (denom <= 0) return 0;
  return round2(pvp / denom);
}

export function margenBrutoEUR(p: ProductoFinanzas): number {
  return round2(ventaNetaSinIva(p) - costeNeto(p));
}

export function margenBeneficioPct(p: ProductoFinanzas): number {
  const ventaNeta = ventaNetaSinIva(p);
  if (ventaNeta <= 0) return 0;
  return round2((margenBrutoEUR(p) / ventaNeta) * 100);
}

