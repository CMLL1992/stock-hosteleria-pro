"use client";

import { useEffect, useState } from "react";
import { LoginForm } from "@/components/LoginForm";
import { supabase } from "@/lib/supabase";

export function RequireSession({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "authed" | "anon">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase().auth.getSession();
      if (cancelled) return;
      setStatus(data.session?.user ? "authed" : "anon");
    })().catch(() => setStatus("anon"));

    const { data: sub } = supabase().auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setStatus(session?.user ? "authed" : "anon");
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (status === "loading") {
    return (
      <main className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
        <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-600">Cargando sesión…</p>
        </div>
      </main>
    );
  }

  if (status === "anon") return <LoginForm onSuccessHref="/" />;

  return <>{children}</>;
}

