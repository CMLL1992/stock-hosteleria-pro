"use client";

import { useCallback, useState } from "react";
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

      router.replace(`/stock?id=${encodeURIComponent(id)}&scan=1&return=${encodeURIComponent("/admin/scan")}`);
    },
    [last, router]
  );

  return <QrScanner onDetected={onDetected} />;
}

