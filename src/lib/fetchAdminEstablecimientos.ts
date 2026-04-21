"use client";

import { supabase } from "@/lib/supabase";
import type { EstablecimientoRow } from "@/types/ops";

/** Lista todos los establecimientos vía API (service role en servidor). Solo para superadmin. */
export async function fetchAdminEstablecimientosList(): Promise<EstablecimientoRow[]> {
  const s = await supabase().auth.getSession();
  const token = s.data.session?.access_token;
  if (!token) throw new Error("No hay sesión activa.");

  const res = await fetch("/api/admin/establecimientos", {
    headers: { authorization: `Bearer ${token}` }
  });
  const json = (await res.json()) as { items?: EstablecimientoRow[]; error?: string };
  if (!res.ok) throw new Error(json.error || "Error cargando establecimientos.");
  return json.items ?? [];
}
