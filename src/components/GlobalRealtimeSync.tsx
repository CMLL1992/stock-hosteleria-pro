 "use client";

import { useQueryClient } from "@tanstack/react-query";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useCambiosGlobalesRealtime } from "@/lib/useCambiosGlobalesRealtime";

/**
 * Sincronización Realtime global (por establecimiento) para refrescar toda la app.
 * - Staff/Admin/Superadmin: cualquier cambio en productos/movimientos/pedidos/usuarios invalida caches clave.
 * - Evita depender de refetch manual / focus.
 */
export function GlobalRealtimeSync() {
  const queryClient = useQueryClient();
  const { activeEstablishmentId: establecimientoId } = useActiveEstablishment();

  useCambiosGlobalesRealtime({
    establecimientoId: establecimientoId ?? null,
    queryClient,
    queryKeys: [
      // Stock / catálogo
      ["productos", establecimientoId],
      ["productos"],
      // Dashboard
      ["dashboard", "productos", establecimientoId],
      ["dashboard"],
      // Movimientos
      ["movimientos", establecimientoId],
      ["movimientos"],
      // Pedidos / recepción (algunas vistas usan state local, pero esto mantiene caches coherentes)
      ["pedidos", establecimientoId],
      ["pedidos"],
      // Activity log: no se invalida porque no se muestra en dashboard
    ]
  });

  return null;
}

