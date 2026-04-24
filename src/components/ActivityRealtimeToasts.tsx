"use client";

import { useEffect, useRef } from "react";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ui/ToastCenter";

type ActivityRow = {
  id: string;
  message: string;
  icon: string;
  actor_user_id: string | null;
  created_at: string;
  establecimiento_id: string;
};

export function ActivityRealtimeToasts() {
  const { activeEstablishmentId: establecimientoId } = useActiveEstablishment();
  const { push } = useToast();
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!establecimientoId) return;

    // Evita “toasts antiguos” al arrancar: recordamos el último evento del canal.
    lastSeenRef.current = null;

    const channel = supabase().channel(`activity:${establecimientoId}`);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "activity_log", filter: `establecimiento_id=eq.${establecimientoId}` },
      (payload) => {
        const row = (payload.new ?? null) as ActivityRow | null;
        if (!row?.id) return;
        if (lastSeenRef.current === null) {
          lastSeenRef.current = row.id;
          return; // primer insert observado, no toast
        }
        lastSeenRef.current = row.id;
        push({ kind: "info", title: "Última actividad", message: row.message });
      }
    );
    channel.subscribe();

    return () => {
      void supabase().removeChannel(channel);
    };
  }, [establecimientoId, push]);

  return null;
}

