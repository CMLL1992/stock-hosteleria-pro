"use client";

import { useCallback, useState } from "react";
import { QrScanner } from "@/components/scanner/QrScanner";

function toUidOrUrl(decodedText: string): { href: string } | null {
  const raw = decodedText.trim();
  if (!raw) return null;

  // Si el QR contiene una URL, intentamos extraer /p/<uid>
  try {
    const u = new URL(raw);
    const m = u.pathname.match(/\/p\/([^/]+)$/);
    if (m?.[1]) return { href: `/p/${decodeURIComponent(m[1])}` };
  } catch {
    // no-op: no era URL
  }

  // Si no es URL, asumimos que es el uid/id
  return { href: `/p/${encodeURIComponent(raw)}` };
}

export function ScanClient() {
  const [last, setLast] = useState<string | null>(null);

  const onDetected = useCallback((decodedText: string) => {
    const dest = toUidOrUrl(decodedText);
    if (!dest) return;
    // evita redirecciones repetidas por lecturas múltiples
    if (last === dest.href) return;
    setLast(dest.href);
    window.location.href = dest.href;
  }, [last]);

  return <QrScanner onDetected={onDetected} />;
}

