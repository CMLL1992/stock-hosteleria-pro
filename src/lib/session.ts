"use client";

import { supabase } from "@/lib/supabase";

export async function requireUserId(): Promise<string> {
  // `getUser()` puede devolver "Auth session missing!" en algunos estados (especialmente en prod/PWA)
  // aunque haya sesión en proceso de restauración. `getSession()` es más tolerante.
  const { data, error } = await supabase().auth.getSession();
  if (error) throw error;
  const id = data.session?.user?.id;
  if (!id) throw new Error("No hay sesión. Inicia sesión.");
  return id;
}

export type AppRole = "admin" | "staff";

export async function fetchMyRole(): Promise<AppRole> {
  const uid = await requireUserId();
  const { data, error } = await supabase().from("usuarios").select("rol").eq("id", uid).single();
  if (error) throw error;
  return (data?.rol as AppRole) ?? "staff";
}

