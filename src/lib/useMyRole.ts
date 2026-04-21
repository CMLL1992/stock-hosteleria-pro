"use client";

import { useQuery } from "@tanstack/react-query";
import type { AppRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export type MyRoleResult = {
  role: AppRole | null;
  email: string | null;
  isAdmin: boolean;
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
  if (!user) return { role: null, email: null, isAdmin: false };

  const email = (user.email ?? null)?.toLowerCase() ?? null;
  const adminEmails = parseAdminEmails(process.env.NEXT_PUBLIC_ADMIN_EMAILS);
  const adminByEmail = !!email && adminEmails.includes(email);

  // Intentamos primero `usuarios` (nuestro esquema original).
  // Si en prod se llama `perfiles`, hacemos fallback.
  let role: AppRole | null = null;
  const tryTables: Array<{ table: "usuarios" | "perfiles"; column: string }> = [
    { table: "usuarios", column: "rol" },
    { table: "perfiles", column: "rol" }
  ];

  for (const t of tryTables) {
    const res = await supabase().from(t.table).select(t.column).eq("id", user.id).maybeSingle();
    if (!res.error) {
      // @ts-expect-error: lectura dinámica por nombre de columna
      role = (res.data?.[t.column] as AppRole | undefined) ?? "staff";
      break;
    }
  }

  // Si no hemos podido leer el rol por RLS/tabla, no bloqueamos UI.
  if (!role) role = adminByEmail ? "admin" : "staff";

  return { role, email, isAdmin: role === "admin" || adminByEmail };
}

export function useMyRole() {
  return useQuery({
    queryKey: ["myRole"],
    queryFn: fetchMyRoleRobust,
    staleTime: 30_000,
    retry: 1
  });
}

