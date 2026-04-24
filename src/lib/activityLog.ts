"use client";

import { supabase } from "@/lib/supabase";

export type ActivityIcon = "check" | "stock" | "price" | "envases" | "info";

export async function logActivity(opts: {
  establecimientoId: string;
  message: string;
  icon?: ActivityIcon;
  metadata?: Record<string, unknown>;
}) {
  const { establecimientoId, message } = opts;
  const icon: ActivityIcon = opts.icon ?? "info";
  if (!establecimientoId || !message.trim()) return;
  try {
    const { data: auth } = await supabase().auth.getUser();
    const uid = auth?.user?.id ?? null;
    await supabase().from("activity_log").insert({
      establecimiento_id: establecimientoId,
      actor_user_id: uid,
      message: message.trim(),
      icon,
      metadata: opts.metadata ?? {}
    });
  } catch {
    // no-op (no bloqueamos flujos críticos por logs)
  }
}

