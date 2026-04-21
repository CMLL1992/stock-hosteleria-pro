"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

const KEY = "ops_cookie_consent_v1";

export function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (!v) setOpen(true);
    } catch {
      // si no hay localStorage, no bloqueamos
      setOpen(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed bottom-20 left-0 right-0 z-50 px-4 pb-4">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Cookies</p>
        <p className="mt-1 text-sm text-slate-600">
          Usamos cookies/almacenamiento local para mantener tu sesión y mejorar la experiencia.{" "}
          <a className="underline" href="/politica-privacidad">
            Más información
          </a>
          .
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            onClick={() => {
              try {
                window.localStorage.setItem(KEY, "accepted");
              } catch {}
              setOpen(false);
            }}
          >
            Aceptar
          </Button>
          <button
            className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            onClick={() => {
              try {
                window.localStorage.setItem(KEY, "rejected");
              } catch {}
              setOpen(false);
            }}
          >
            Rechazar
          </button>
        </div>
      </div>
    </div>
  );
}

