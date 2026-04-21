"use client";

import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export async function ensureUserRow(user: User) {
  const id = user.id;
  const email = user.email ?? null;

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
  const { error: insertError } = await supabase().from("usuarios").insert({ id, email });
  if (insertError) throw insertError;
}

