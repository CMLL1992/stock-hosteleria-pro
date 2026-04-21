"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

export function QrScanner({ onDetected }: { onDetected: (decodedText: string) => void }) {
  const regionId = useId().replaceAll(":", "_");
  const qrRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setError(null);
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
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

  return (
    <div className="bg-black">
      <div id={regionId} className="aspect-square w-full" />
      {error ? (
        <div className="p-3 text-sm text-red-200">
          Error de cámara/escáner: <span className="font-mono">{error}</span>
        </div>
      ) : null}
    </div>
  );
}

