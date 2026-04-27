"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative z-10 max-h-[min(92dvh,880px)] w-full max-w-lg overflow-hidden rounded-t-3xl border border-slate-200 bg-white/90 shadow-2xl backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex max-h-[inherit] flex-col">
          <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h3 className="min-w-0 flex-1 truncate text-lg font-black tracking-tight text-slate-900">{title}</h3>
            <button
              type="button"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
