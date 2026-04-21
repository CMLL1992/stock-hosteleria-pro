"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { ensureUserRow } from "@/lib/ensureUserRow";

export function AuthBootstrap() {
  useEffect(() => {
    let cancelled = false;

    async function handleCurrent() {
      const { data } = await supabase().auth.getSession();
      const user = data.session?.user ?? null;
      if (!user) return;
      try {
        await ensureUserRow(user);
      } catch {
        // best-effort: no bloquear UI por bootstrap
      }
    }

    handleCurrent().catch(() => undefined);

    const { data: sub } = supabase().auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const user = session?.user ?? null;
      if (!user) return;
      ensureUserRow(user).catch(() => undefined);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}

