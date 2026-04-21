"use client";

import { LogOut, User } from "lucide-react";
import { useMyRole } from "@/lib/useMyRole";
import { supabase } from "@/lib/supabase";

export function MobileHeader({ title }: { title: string }) {
  const { data: role } = useMyRole();

  return (
    <header className="sticky top-0 z-30 border-b border-gray-100 bg-gray-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{role === "admin" ? "Admin" : "Staff"}</p>
          <h1 className="truncate text-lg font-semibold text-gray-900">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/mas"
            className="grid h-10 w-10 place-items-center rounded-full border border-gray-100 bg-white shadow-sm"
            aria-label="Más opciones"
            title="Más"
          >
            <User className="h-5 w-5 text-gray-700" />
          </a>
          <button
            className="grid h-10 w-10 place-items-center rounded-full border border-gray-100 bg-white shadow-sm"
            aria-label="Salir"
            title="Salir"
            onClick={async () => {
              await supabase().auth.signOut();
              window.location.href = "/login";
            }}
          >
            <LogOut className="h-5 w-5 text-gray-700" />
          </button>
        </div>
      </div>
    </header>
  );
}

