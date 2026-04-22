"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Zap } from "lucide-react";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

export function QrScanner({ onDetected }: { onDetected: (decodedText: string) => void }) {
  const regionId = useId().replaceAll(":", "_");
  const qrRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setError(null);
      setTorchSupported(false);
      setTorchOn(false);
      const mod = await import("html5-qrcode");
      const Html5QrcodeCtor = mod.Html5Qrcode;

      if (cancelled) return;

      const html5Qr = new Html5QrcodeCtor(regionId, /* verbose= */ false);
      qrRef.current = html5Qr;

      try {
        await html5Qr.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            onDetected(decodedText);
          },
          () => {
            // ignore decode errors (very chatty)
          }
        );
        if (cancelled) return;
        try {
          const caps = html5Qr.getRunningTrackCapabilities?.();
          const hasTorch = Boolean((caps as unknown as { torch?: unknown } | null)?.torch);
          setTorchSupported(hasTorch);
        } catch {
          setTorchSupported(false);
        }
      } catch (e) {
        setError(supabaseErrToString(e));
      }
    }

    start();

    return () => {
      cancelled = true;
      const inst = qrRef.current;
      qrRef.current = null;
      if (!inst) return;
      Promise.resolve((inst as unknown as { stop: () => Promise<void> }).stop())
        .catch(() => undefined)
        .finally(() => Promise.resolve((inst as unknown as { clear: () => void | Promise<void> }).clear()).catch(() => undefined));
    };
  }, [onDetected, regionId]);

  const toggleTorch = useCallback(async () => {
    const inst = qrRef.current;
    if (!inst) return;
    try {
      const next = !torchOn;
      // `advanced: [{ torch: true }]` es el estándar de MediaTrackConstraints.
      await inst.applyVideoConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch (e) {
      setError(supabaseErrToString(e));
    }
  }, [torchOn]);

  return (
    <div className="relative bg-black">
      <div id={regionId} className="aspect-square w-full" />

      {/* Visor / marco centrado */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[62%] w-[62%] rounded-3xl border border-white/60 bg-black/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>

      {/* Linterna */}
      {torchSupported ? (
        <div className="absolute right-3 top-3">
          <button
            type="button"
            onClick={toggleTorch}
            className={[
              "inline-flex min-h-10 items-center gap-2 rounded-2xl border px-3 text-sm font-semibold",
              torchOn ? "border-white/25 bg-white/15 text-white" : "border-white/20 bg-black/35 text-white"
            ].join(" ")}
            aria-pressed={torchOn}
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
            Linterna
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="p-3 text-sm text-red-200">
          Error de cámara/escáner: <span className="font-mono">{error}</span>
        </div>
      ) : null}
    </div>
  );
}

