"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastKind = "info" | "success" | "error";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  title?: string;
  message: string;
};

type Ctx = {
  push: (t: Omit<ToastItem, "id">) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

function newId(): string {
  return (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = newId();
    setItems((prev) => [{ id, ...t }, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-3 top-3 z-[9999] flex w-[min(420px,calc(100vw-1.5rem))] flex-col gap-2">
        {items.map((t) => {
          const cls =
            t.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : t.kind === "error"
                ? "border-red-200 bg-red-50 text-red-950"
                : "border-slate-200 bg-white text-slate-900";
          return (
            <div
              key={t.id}
              className={[
                "pointer-events-none rounded-2xl border p-3 shadow-lg ring-1 ring-black/5",
                cls
              ].join(" ")}
            >
              {t.title ? <p className="text-sm font-bold">{t.title}</p> : null}
              <p className="text-sm">{t.message}</p>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

