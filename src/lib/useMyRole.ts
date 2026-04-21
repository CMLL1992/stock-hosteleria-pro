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
    const selectCols = t.table === "usuarios" ? `${t.column},establecimiento_id` : t.column;
    const res = await supabase().from(t.table).select(selectCols).eq("id", user.id).maybeSingle();
    if (!res.error && res.data) {
      // @ts-expect-error: lectura dinámica por nombre de columna
      const raw = String(res.data?.[t.column] ?? "")
        .trim()
        .toLowerCase() as string;
      const asRole = raw as AppRole;
      role = raw === "superadmin" || raw === "admin" || raw === "staff" ? asRole : "staff";
      // @ts-expect-error: columna opcional
      establecimientoId = (res.data?.establecimiento_id as string | undefined) ?? null;
      break;
    }
  }

  // Si no hemos podido leer el rol por RLS/tabla, no bloqueamos UI.
  if (!role) {
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

