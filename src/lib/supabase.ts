"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (_client) return _client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (typeof window !== "undefined") {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env.local y rellénalo."
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

