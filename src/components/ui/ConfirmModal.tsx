"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Si true, el botón de confirmar es rojo (acciones destructivas) */
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = true,
  busy = false,
  onCancel,
  onConfirm
}: Props) {
  useEffect(() => {
    if (!open) return;
    const t = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <button type="button" className="absolute inset-0" onClick={busy ? undefined : onCancel} aria-label="Cerrar" />
      <div
        className="relative z-10 w-full max-w-lg rounded-t-3xl border border-slate-200 bg-white/90 shadow-2xl backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="flex items-start justify-between gap-2 px-5 pt-2">
          <h2 id="confirm-modal-title" className="min-w-0 flex-1 text-lg font-black tracking-tight text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 max-h-[50dvh] overflow-y-auto px-5 whitespace-pre-line text-sm leading-relaxed text-slate-600">{message}</p>
        <div className="mt-5 flex flex-col gap-2 px-5 pb-5">
          <button
            type="button"
            className={
              danger
                ? "min-h-12 w-full rounded-2xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                : "min-h-12 w-full rounded-2xl bg-premium-blue px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
            }
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
          <button
            type="button"
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
