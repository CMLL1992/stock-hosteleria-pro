"use client";

import type { ReactNode } from "react";

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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            className="min-h-12 rounded-xl px-3 text-sm text-zinc-700 hover:bg-zinc-100"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

