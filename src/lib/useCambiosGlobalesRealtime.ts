import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type RealtimeTable =
  | "movimientos"
  | "productos"
  | "pedidos"
  | "usuarios"
  | "escandallos"
  | "checklists_tareas"
  | "checklists_tareas_estado"
  | "checklists_registros";

/**
 * Suscripción Realtime "global" por establecimiento.
 *
 * Objetivo:
 * - Escuchar INSERT/UPDATE/DELETE en tablas clave y disparar invalidaciones de React Query
 * - o ejecutar un callback para pantallas que no usan React Query.
 *
 * Nota: Supabase Realtime filtra por columna (cuando existe) vía `filter`.
 */
export function useCambiosGlobalesRealtime(opts: {
  establecimientoId: string | null | undefined;
  /**
   * Si se pasa, invalidará todas estas keys en cada evento Realtime.
   * Usar las mismas keys que el resto de la app (por ejemplo: ["productos", estId]).
   */
  queryClient?: QueryClient;
  queryKeys?: Array<unknown[]>;
  /**
   * Callback opcional para pantallas con state local (sin React Query).
   */
  onChange?: () => void | Promise<void>;
  /**
   * Tablas a escuchar. Por defecto, las 4 del "pipeline".
   */
  tables?: RealtimeTable[];
}) {
  const { establecimientoId, queryClient, queryKeys, onChange, tables } = opts;
  const instanceIdRef = useRef<string | null>(null);

  if (instanceIdRef.current === null) {
    // Evita colisiones: Supabase reutiliza channels por nombre; si dos componentes usan el mismo nombre,
    // el segundo intentará registrar callbacks después de subscribe() y puede crashear.
    instanceIdRef.current =
      (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  useEffect(() => {
    if (!establecimientoId) return;

    const watchTables: RealtimeTable[] =
      tables ?? ["movimientos", "productos", "pedidos", "usuarios", "escandallos", "checklists_tareas", "checklists_tareas_estado", "checklists_registros"];
    const channel = supabase().channel(`cambios-globales:${establecimientoId}:${instanceIdRef.current}`);

    for (const table of watchTables) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `establecimiento_id=eq.${establecimientoId}`
        },
        () => {
          if (queryClient && queryKeys?.length) {
            for (const k of queryKeys) {
              void queryClient.invalidateQueries({ queryKey: k });
            }
          }
          if (onChange) void onChange();
        }
      );
    }

    channel.subscribe();

    return () => {
      void supabase().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establecimientoId]);
}

