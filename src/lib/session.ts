"use client";

import { supabase } from "@/lib/supabase";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function requireUserId(): Promise<string> {
  // `getUser()` puede devolver "Auth session missing!" en algunos estados (especialmente en prod/PWA)
  // aunque haya sesión en proceso de restauración. `getSession()` es más tolerante.
  // En móvil/PWA a veces la sesión tarda unos ms en restaurarse: hacemos retry corto.
  for (let i = 0; i < 6; i++) {
    const { data, error } = await supabase().auth.getSession();
    if (error) throw error;
    const id = data.session?.user?.id;
    if (id) return id;
    await sleep(200);
  }
  throw new Error("No hay sesión. Inicia sesión.");
}

export type AppRole = "admin" | "staff";

export async function fetchMyRole(): Promise<AppRole> {
  const uid = await requireUserId();
  const { data, error } = await supabase().from("usuarios").select("rol").eq("id", uid).maybeSingle();
  // Si el perfil todavía no existe o hay lag de RLS/cache, no rompemos el flujo: tratamos como staff.
  if (error) return "staff";
  return (data?.rol as AppRole) ?? "staff";
}

