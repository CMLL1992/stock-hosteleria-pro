"use client";

import { useEffect } from "react";

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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={busy ? undefined : onCancel}
        aria-label="Cerrar"
      />
      <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-lg">
        <h2 id="confirm-modal-title" className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{message}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 sm:w-auto"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              danger
                ? "min-h-11 w-full rounded-2xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 sm:w-auto"
                : "min-h-11 w-full rounded-2xl bg-black px-4 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50 sm:w-auto"
            }
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
