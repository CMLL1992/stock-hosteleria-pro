"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

const KEY = "ops_last_activity_ts";
const MAX_IDLE_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

function now() {
  return Date.now();
}

function readTs(): number {
  try {
    const v = window.localStorage.getItem(KEY);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeTs(ts: number) {
  try {
    window.localStorage.setItem(KEY, String(ts));
  } catch {}
}

export function SessionGuard() {
  useEffect(() => {
    let cancelled = false;

    async function check() {
      const last = readTs();
      if (last && now() - last > MAX_IDLE_MS) {
        await supabase().auth.signOut().catch(() => undefined);
        if (!cancelled) window.location.href = "/login";
        return;
      }
      writeTs(now());
    }

    const events = ["click", "keydown", "touchstart", "scroll"] as const;
    const onActivity = () => writeTs(now());
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });

    check().catch(() => undefined);
    const t = window.setInterval(() => check().catch(() => undefined), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(t);
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, []);

  return null;
}

