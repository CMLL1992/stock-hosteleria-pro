"use client";

import { supabase } from "@/lib/supabase";
import type { UsuarioListItem, UsuarioRol } from "@/types/ops";

export async function getAccessTokenOrThrow(): Promise<string> {
  const s = await supabase().auth.getSession();
  const token = s.data.session?.access_token;
  if (!token) throw new Error("No hay sesión activa.");
  return token;
}

export async function fetchAdminUsersList(): Promise<UsuarioListItem[]> {
  const token = await getAccessTokenOrThrow();
  const res = await fetch("/api/admin/users", { headers: { authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { items?: UsuarioListItem[]; error?: string };
  if (!res.ok) throw new Error(json.error || "Error cargando usuarios.");
  return json.items ?? [];
}

export async function patchAdminUserRole(
  userId: string,
  rol: UsuarioRol,
  establecimientoId?: string
): Promise<void> {
  const token = await getAccessTokenOrThrow();
  const res = await fetch("/api/admin/users", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      userId,
      rol,
      ...(establecimientoId ? { establecimiento_id: establecimientoId } : {})
    })
  });
  const json = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(json.error || "Error actualizando rol.");
}

export async function deleteAdminUser(userId: string): Promise<void> {
  const token = await getAccessTokenOrThrow();
  const res = await fetch("/api/admin/users", {
    method: "DELETE",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId })
  });
  const json = (await res.json()) as { ok?: boolean; error?: string; warning?: string };
  if (!res.ok) throw new Error(json.error || "Error al eliminar usuario.");
}

export async function deleteAdminEstablecimiento(id: string): Promise<void> {
  const token = await getAccessTokenOrThrow();
  const res = await fetch("/api/admin/establecimientos", {
    method: "DELETE",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ id })
  });
  const json = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(json.error || "Error al eliminar establecimiento.");
}
