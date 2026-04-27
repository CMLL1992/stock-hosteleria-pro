"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { clearPersistedQueryCache } from "@/lib/queryPersist";

/**
 * Tras login/logout, invalida el perfil (rol, establecimiento_id) y el listado admin de establecimientos.
 * Evita datos obsoletos sin depender de recarga completa.
 */
export function AuthQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        // Evita que un usuario vea caché persistida de otro (cambio de rol/establecimiento en el mismo dispositivo).
        void clearPersistedQueryCache();
        queryClient.clear();
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void queryClient.invalidateQueries({ queryKey: ["myRole"] });
        void queryClient.invalidateQueries({ queryKey: ["establecimientos"] });
        void queryClient.invalidateQueries({ queryKey: ["establecimiento"] });
      }
      if (event === "SIGNED_OUT") {
        void clearPersistedQueryCache();
        queryClient.clear();
        void queryClient.removeQueries({ queryKey: ["myRole"] });
        void queryClient.removeQueries({ queryKey: ["establecimientos"] });
        void queryClient.removeQueries({ queryKey: ["establecimiento"] });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return null;
}
