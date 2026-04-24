"use client";

import { useEffect } from "react";

const LS_URL = "ops_supabase_url";
const LS_ANON = "ops_supabase_anon_key";

function writeLs(k: string, v: string) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    // ignore
  }
}

/**
 * Evita el error "No apikey header" en clientes con bundle viejo/PWA cacheada:
 * si faltan NEXT_PUBLIC_SUPABASE_* en runtime, las obtenemos del servidor y
 * las guardamos en localStorage para que `supabase()` pueda inicializar.
 */
export function SupabaseEnvBootstrap() {
  useEffect(() => {
    const envUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
    const envAnon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
    if (envUrl && envAnon) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/env/supabase", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; url?: string; anonKey?: string };
        if (!res.ok || !json.ok) return;
        const url = String(json.url ?? "").trim();
        const anon = String(json.anonKey ?? "").trim();
        if (!url || !anon) return;
        writeLs(LS_URL, url);
        writeLs(LS_ANON, anon);
        if (cancelled) return;
        // Forzamos recarga para que el resto de componentes inicialicen Supabase ya con key.
        window.location.reload();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

