"use client";

import { useQuery } from "@tanstack/react-query";
import type { AppRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export type MyRoleResult = {
  role: AppRole | null;
  email: string | null;
  isAdmin: boolean;
  isSuperadmin: boolean;
  establecimientoId: string | null;
  profileReady: boolean;
};

function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function fetchMyRoleRobust(): Promise<MyRoleResult> {
  const { data, error } = await supabase().auth.getSession();
  if (error) throw error;

  const user = data.session?.user ?? null;
  if (!user) return { role: null, email: null, isAdmin: false, isSuperadmin: false, establecimientoId: null, profileReady: false };

  const email = (user.email ?? null)?.toLowerCase() ?? null;
  const adminEmails = parseAdminEmails(process.env.NEXT_PUBLIC_ADMIN_EMAILS);
  const adminByEmail = !!email && adminEmails.includes(email);
  const superadminByEmail = email === "ximomitja1992@hotmail.com";

  // Intentamos primero `usuarios` (nuestro esquema original).
  // Si en prod se llama `perfiles`, hacemos fallback.
  let role: AppRole | null = null;
  let establecimientoId: string | null = null;
  const tryTables: Array<{ table: "usuarios" | "perfiles"; column: string }> = [
    { table: "usuarios", column: "rol" },
    { table: "perfiles", column: "rol" }
  ];

  for (const t of tryTables) {
    // En entornos antiguos `perfiles` puede no tener `establecimiento_id`.
    // Intentamos leerlo y si falla por columna inexistente, reintentamos con solo `rol`.
    const selectCols = `${t.column},establecimiento_id`;
    const res = await supabase().from(t.table).select(selectCols).eq("id", user.id).maybeSingle();
    const missingEstCol = (() => {
      const msg = String((res.error as { message?: unknown } | null)?.message ?? "").toLowerCase();
      return msg.includes("establecimiento_id") && msg.includes("could not find");
    })();
    const res2 =
      res.error && missingEstCol
        ? await supabase().from(t.table).select(t.column).eq("id", user.id).maybeSingle()
        : res;

    if (!res2.error && res2.data) {
      // @ts-expect-error: lectura dinámica por nombre de columna
      const raw = String(res2.data?.[t.column] ?? "")
        .trim()
        .toLowerCase() as string;
      const asRole = raw as AppRole;
      role = raw === "superadmin" || raw === "admin" || raw === "staff" ? asRole : "staff";
      // @ts-expect-error: columna opcional
      establecimientoId = (res2.data?.establecimiento_id as string | undefined) ?? null;
      break;
    }
  }

  // Si tenemos token, pedimos al servidor el establecimientoId (y rol si faltaba).
  // Esto resuelve casos donde el rol se pudo leer desde una tabla legacy pero falta establecimiento_id en el select/RLS.
  try {
    const token = data.session?.access_token ?? "";
    if (token) {
      const res = await fetch("/api/me/role", { headers: { authorization: `Bearer ${token}` } });
      const json = (await res.json()) as { ok?: boolean; role?: AppRole | null; establecimientoId?: string | null };
      if (res.ok && json.ok) {
        if (!role && json.role) role = json.role;
        if (!establecimientoId && json.establecimientoId) establecimientoId = json.establecimientoId;
      }
    }
  } catch {
    // ignore
  }

  // Si no hemos podido leer el rol por RLS/tabla, no bloqueamos UI.
  if (!role) {
    // Fallback final: pedir al servidor el rol con service key (si existe).
    try {
      const token = data.session?.access_token ?? "";
      if (token) {
        const res = await fetch("/api/me/role", { headers: { authorization: `Bearer ${token}` } });
        const json = (await res.json()) as { ok?: boolean; role?: AppRole | null; establecimientoId?: string | null };
        if (res.ok && json.ok && json.role) {
          const r = json.role;
          const isSuperadmin = r === "superadmin";
          const isAdmin = isSuperadmin || r === "admin";
          return {
            role: r,
            email,
            isAdmin,
            isSuperadmin,
            establecimientoId: json.establecimientoId ?? null,
            profileReady: true
          };
        }
      }
    } catch {
      // ignore
    }
    return {
      role: superadminByEmail ? "superadmin" : null,
      email,
      isAdmin: superadminByEmail || adminByEmail,
      isSuperadmin: superadminByEmail,
      establecimientoId,
      profileReady: superadminByEmail
    };
  }

  const isSuperadmin = role === "superadmin" || superadminByEmail;
  const isAdmin = isSuperadmin || role === "admin" || adminByEmail;

  return { role, email, isAdmin, isSuperadmin, establecimientoId, profileReady: true };
}

export function useMyRole() {
  return useQuery({
    queryKey: ["myRole"],
    queryFn: fetchMyRoleRobust,
    staleTime: 30_000,
    retry: 2
  });
}

