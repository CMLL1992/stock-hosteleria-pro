"use client";

import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function ensureUserRow(user: User) {
  const id = user.id;
  const email = user.email ?? null;
  const adminByEmail = !!email && parseAdminEmails(process.env.NEXT_PUBLIC_ADMIN_EMAILS).includes(email.toLowerCase());
  const superadminByEmail = (email ?? "").toLowerCase() === "ximomitja1992@hotmail.com";

  // 1) Si existe, no hacemos nada.
  const { data: existing, error: selectError } = await supabase()
    .from("usuarios")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing?.id) return;

  // SaaS: no auto-provisionamos usuarios. Un superadmin asigna el establecimiento y rol.
  // Si no hay fila en `usuarios`, la cuenta se considera "no provisionada" (acceso restringido).
  // Mantener el comportamiento best-effort solo para whitelists antiguas (adminByEmail) si existiese la policy,
  // pero por defecto no hacemos inserts aquí para evitar cuentas huérfanas sin establecimiento_id.
  if (adminByEmail || superadminByEmail) {
    try {
      const { data: sess } = await supabase().auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) return;
      await fetch("/api/me/provision", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    } catch {
      // ignore
    }
    return;
  }
}

