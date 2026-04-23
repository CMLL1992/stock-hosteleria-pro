"use client";

import { useEffect, useMemo, useState } from "react";

export function DangerConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Borrar",
  cancelLabel = "Cancelar",
  keyword = "BORRAR",
  busy,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  description?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  keyword?: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");

  const ok = useMemo(() => value.trim().toUpperCase() === String(keyword).trim().toUpperCase(), [keyword, value]);

  useEffect(() => {
    if (!open) return;
    setValue("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-base font-extrabold text-slate-900">{title}</p>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-slate-700">
            Escribe <span className="rounded bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-900">{keyword}</span> para confirmar.
          </p>
          <input
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            placeholder={keyword}
            disabled={!!busy}
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-60"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={!ok || !!busy}
            className="min-h-12 w-full rounded-2xl bg-red-600 px-4 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

