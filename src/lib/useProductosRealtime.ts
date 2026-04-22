import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Suscripción Realtime para invalidar cachés cuando cambia `public.productos`.
 * Objetivo: reemplazar polling por actualizaciones instantáneas.
 *
 * Nota: esto no "empuja" datos al estado local; dispara `invalidateQueries` para que React Query refetchee.
 */
export function useProductosRealtime(opts: {
  establecimientoId: string | null | undefined;
  queryClient: QueryClient;
  queryKeys: Array<unknown[]>;
}) {
  const { establecimientoId, queryClient, queryKeys } = opts;

  useEffect(() => {
    if (!establecimientoId) return;

    const channel = supabase()
      .channel(`productos:${establecimientoId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "productos",
          filter: `establecimiento_id=eq.${establecimientoId}`
        },
        () => {
          for (const k of queryKeys) {
            void queryClient.invalidateQueries({ queryKey: k });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establecimientoId]);
}

