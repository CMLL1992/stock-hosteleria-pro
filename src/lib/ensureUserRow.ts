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
  const adminByEmail =
    !!email && parseAdminEmails(process.env.NEXT_PUBLIC_ADMIN_EMAILS).includes(email.toLowerCase());

  // 1) Si existe, no hacemos nada.
  const { data: existing, error: selectError } = await supabase()
    .from("usuarios")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing?.id) return;

  // 2) Si no existe, insertamos con rol por defecto (staff).
  // Requiere la policy "usuarios_insert_own".
  const insertPayload = adminByEmail ? ({ id, email, rol: "admin" } as const) : ({ id, email } as const);
  const { error: insertError } = await supabase().from("usuarios").insert(insertPayload);
  if (insertError) {
    // Fallback: si RLS no permite setear `rol`, insertamos sin rol.
    if (adminByEmail) {
      const { error: fallbackErr } = await supabase().from("usuarios").insert({ id, email });
      if (fallbackErr) throw fallbackErr;
    } else {
      throw insertError;
    }
  }

  // Best-effort: si es admin por email e insertamos sin rol, intentamos promover.
  if (adminByEmail) {
    await supabase().from("usuarios").update({ rol: "admin" }).eq("id", id);
  }
}

