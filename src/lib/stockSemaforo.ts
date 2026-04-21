/** Semáforo: agotado (0) → rojo; bajo mínimo (>0 pero ≤ mín.) → naranja; OK → verde. */
export type StockSemaforo = "sin" | "bajo" | "ok";

export function stockSemaforo(actual: number, minimo: number): StockSemaforo {
  if (actual === 0) return "sin";
  if (actual <= minimo) return "bajo";
  return "ok";
}

export function clasesBordeSemaforo(s: StockSemaforo): string {
  if (s === "sin") return "border-l-4 border-l-red-500";
  if (s === "bajo") return "border-l-4 border-l-amber-400";
  return "border-l-4 border-l-emerald-500";
}

export function clasesFondoSemaforo(s: StockSemaforo): string {
  if (s === "sin") return "bg-red-50/50";
  if (s === "bajo") return "bg-amber-50/40";
  return "bg-emerald-50/30";
}
