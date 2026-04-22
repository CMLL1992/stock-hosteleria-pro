import { openDB } from "idb";

export type MovimientoTipo =
  | "entrada"
  | "salida"
  | "pedido"
  | "salida_barra"
  | "entrada_vacio"
  | "devolucion_proveedor"
  | "entrada_compra";

export type MovimientoDraft = {
  client_uuid: string;
  producto_id: string;
  establecimiento_id: string;
  tipo: MovimientoTipo;
  cantidad: number;
  usuario_id: string;
  timestamp: string;
  genera_vacio?: boolean;
  proveedor_id?: string;
};

function fallbackUuid(): string {
  // Formato UUID v4-like (no perfecto, pero suficiente para deduplicación best-effort)
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

export function newClientUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (crypto as any).randomUUID() as string;
  }
  return fallbackUuid();
}

const DB_NAME = "stock_hosteleria";
const DB_VERSION = 1;
const STORE = "movimientos_queue";

async function db() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("by_timestamp", "timestamp");
      }
    }
  });
}

export async function enqueueMovimiento(draft: MovimientoDraft) {
  const d = await db();
  await d.add(STORE, draft);
}

export async function listQueuedMovimientos(): Promise<Array<{ id: number } & MovimientoDraft>> {
  const d = await db();
  return (await d.getAll(STORE)) as Array<{ id: number } & MovimientoDraft>;
}

export async function deleteQueuedMovimiento(id: number) {
  const d = await db();
  await d.delete(STORE, id);
}

