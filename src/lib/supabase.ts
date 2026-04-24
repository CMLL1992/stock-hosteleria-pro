"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

const LS_URL = "ops_supabase_url";
const LS_ANON = "ops_supabase_anon_key";

function readLs(k: string): string {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(k) ?? "").trim();
  } catch {
    return "";
  }
}

export function supabase(): SupabaseClient {
  if (_client) return _client;

  const envUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const envAnon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const supabaseUrl = envUrl || readLs(LS_URL);
  const supabaseAnonKey = envAnon || readLs(LS_ANON);

  if (typeof window !== "undefined") {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Supabase no está configurado en este cliente. Recarga la app. Si persiste, borra caché/datos del sitio (PWA)."
      );
    }
  }

  // iOS/Safari/PWA: preferimos storage explícito para persistencia.
  // Si localStorage no está disponible (modo privado extremo), caemos a memoria.
  const safeStorage =
    typeof window !== "undefined"
      ? (() => {
          try {
            const s = window.localStorage;
            const k = "__ops_ls_test__";
            s.setItem(k, "1");
            s.removeItem(k);
            return s;
          } catch {
            return undefined;
          }
        })()
      : undefined;

  _client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: safeStorage,
      storageKey: "ops-auth"
    }
  });
  return _client;
}

