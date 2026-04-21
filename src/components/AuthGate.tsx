"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ensureUserRow } from "@/lib/ensureUserRow";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase().auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const session = data.session;
      const isLogin = window.location.pathname.startsWith("/login");
      if (!session && !isLogin) window.location.href = "/login";
      if (session?.user) {
        ensureUserRow(session.user).catch(() => undefined);
      }
      setReady(true);
    });

    const { data: sub } = supabase().auth.onAuthStateChange((_evt, session) => {
      const isLogin = window.location.pathname.startsWith("/login");
      if (!session && !isLogin) window.location.href = "/login";
      if (session?.user) {
        ensureUserRow(session.user).catch(() => undefined);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!ready) return <div className="p-4 text-sm text-zinc-600 dark:text-zinc-300">Cargando…</div>;
  return <>{children}</>;
}

