"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Drawer({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        className="absolute inset-0 bg-black/30"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl border border-slate-200 bg-white/90 shadow-2xl backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        role="dialog"
        aria-modal="true"
      >
        <div className="mx-auto flex max-h-[min(92dvh,900px)] max-w-3xl flex-col px-4 pb-4 pt-3">
          <div className="mx-auto mb-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />
          <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0">
              {title ? <p className="truncate text-lg font-black tracking-tight text-slate-900">{title}</p> : null}
            </div>
            <button
              className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
              onClick={onClose}
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X className="h-5 w-5 text-slate-700" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </div>
    </div>
  );
}

