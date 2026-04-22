"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/scanner/QrScanner";

function extractProductId(decodedText: string): string | null {
  const raw = decodedText.trim();
  if (!raw) return null;

  // Si el QR contiene URL, intentamos extraer ?id=... o /p/<uid>
  try {
    const u = new URL(raw);
    const id = u.searchParams.get("id");
    if (id) return decodeURIComponent(id);
    const m = u.pathname.match(/\/p\/([^/]+)$/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  } catch {
    // no-op: no era URL
  }

  // Si no es URL, asumimos que el QR contiene el id/uid
  return raw;
}

export function ScanGoClient() {
  const router = useRouter();
  const [last, setLast] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // iOS/Safari suele requerir un gesto del usuario para poder reproducir sonido.
    const prime = () => {
      try {
        if (!audioCtxRef.current) {
          const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
            | typeof AudioContext
            | undefined;
          if (Ctx) audioCtxRef.current = new Ctx();
        }
        void audioCtxRef.current?.resume?.();
      } catch {
        // ignore
      }
    };
    window.addEventListener("pointerdown", prime, { once: true });
    return () => window.removeEventListener("pointerdown", prime);
  }, []);

  const beep = useCallback(() => {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.13);
    } catch {
      // ignore
    }
  }, []);

  const onDetected = useCallback(
    (decodedText: string) => {
      const id = extractProductId(decodedText);
      if (!id) return;
      if (last === id) return;
      setLast(id);

      // Haptic feedback simple si el dispositivo lo permite
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
      } catch {
        // ignore
      }
      beep();

      router.replace(`/stock?id=${encodeURIComponent(id)}&scan=1&return=${encodeURIComponent("/admin/scan")}`);
    },
    [beep, last, router]
  );

  return <QrScanner onDetected={onDetected} />;
}

