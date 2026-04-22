"use client";

import { useEffect, useRef } from "react";
import { deleteQueuedMovimiento, listQueuedMovimientos } from "@/lib/offlineQueue";
import { supabase } from "@/lib/supabase";

export function OfflineSync() {
  const flushing = useRef(false);

  useEffect(() => {
    async function flush() {
      if (flushing.current) return;
      if (!navigator.onLine) return;
      flushing.current = true;
      try {
        const queued = await listQueuedMovimientos();
        for (const item of queued) {
          const { id, ...payload } = item;
          const { error } = await supabase()
            .from("movimientos")
            .upsert(payload, { onConflict: "client_uuid", ignoreDuplicates: true });
          if (error) throw error;
          await deleteQueuedMovimiento(id);
        }
      } finally {
        flushing.current = false;
      }
    }

    flush().catch(() => undefined);
    window.addEventListener("online", flush);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") flush().catch(() => undefined);
    });
    window.addEventListener("focus", () => flush().catch(() => undefined));
    return () => window.removeEventListener("online", flush);
  }, []);

  return null;
}

