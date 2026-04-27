"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Drawer({
  open,
  title,
  onClose,
  children,
  variant = "light"
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  variant?: "light" | "dark";
}) {
  if (!open) return null;

  const isDark = variant === "dark";
  return (
    <div className="fixed inset-0 z-50">
      <button
        className={["absolute inset-0", isDark ? "bg-black/60" : "bg-black/30"].join(" ")}
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className={[
          "absolute bottom-0 left-0 right-0 rounded-t-3xl shadow-2xl backdrop-blur",
          isDark ? "border border-white/10 bg-[#0F0F14]/92" : "border border-slate-200 bg-white/90"
        ].join(" ")}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        role="dialog"
        aria-modal="true"
      >
        <div className="mx-auto flex max-h-[min(92dvh,900px)] max-w-3xl flex-col px-4 pb-4 pt-3">
          <div className={["mx-auto mb-2 h-1.5 w-12 shrink-0 rounded-full", isDark ? "bg-white/20" : "bg-slate-200"].join(" ")} />
          <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0">
              {title ? (
                <p className={["truncate text-lg font-black tracking-tight", isDark ? "text-white" : "text-slate-900"].join(" ")}>
                  {title}
                </p>
              ) : null}
            </div>
            <button
              className={[
                "grid h-10 w-10 place-items-center rounded-full shadow-sm",
                isDark ? "border border-white/10 bg-white/5 hover:bg-white/10" : "border border-slate-200 bg-white hover:bg-slate-50"
              ].join(" ")}
              onClick={onClose}
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X className={["h-5 w-5", isDark ? "text-white/80" : "text-slate-700"].join(" ")} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </div>
    </div>
  );
}

