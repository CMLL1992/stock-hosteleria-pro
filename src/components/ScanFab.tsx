"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { QrScanner } from "@/components/scanner/QrScanner";

function extractUidFromScannedText(text: string): string | null {
  try {
    const u = new URL(text);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "p") return parts[1];
    return null;
  } catch {
    return null;
  }
}

export function ScanFab() {
  const [open, setOpen] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);

  const uid = useMemo(() => (lastScan ? extractUidFromScannedText(lastScan) : null), [lastScan]);

  useEffect(() => {
    if (!uid) return;
    window.location.href = `/p/${encodeURIComponent(uid)}`;
  }, [uid]);

  const onDetected = useCallback((decodedText: string) => {
    setLastScan(decodedText);
    setOpen(false);
  }, []);

  return (
    <>
      <button
        className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-zinc-900 text-white shadow-lg active:scale-[0.98] dark:bg-zinc-50 dark:text-zinc-950"
        aria-label="Añadir movimiento (Escanear QR)"
        onClick={() => {
          setLastScan(null);
          setOpen(true);
        }}
      >
        <span className="text-3xl leading-none">+</span>
      </button>

      <Modal open={open} title="Escanear QR" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Asegúrate de dar permiso de cámara. En iOS, funciona mejor tras pulsar este botón (por
            seguridad del navegador).
          </p>
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <QrScanner onDetected={onDetected} />
          </div>
          <div className="flex gap-2">
            <Button className="w-full" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

