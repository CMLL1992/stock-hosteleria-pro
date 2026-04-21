"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export function AuthRefresh() {
  useEffect(() => {
    // Nota: esto refresca la sesión/token. La "schema cache" de PostgREST se actualiza
    // tras aplicar cambios en BD, pero este refresh ayuda a evitar estados raros de auth.
    supabase()
      .auth.refreshSession()
      .catch(() => undefined);
  }, []);
  return null;
}

