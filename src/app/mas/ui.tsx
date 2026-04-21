"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMyRole } from "@/lib/useMyRole";

export function MoreClient() {
  const { data: role } = useMyRole();
  const sp = useSearchParams();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const t = sp.get("toast");
    if (t === "guardado") {
      setToast("Guardado correctamente ✓");
      const id = window.setTimeout(() => setToast(null), 1600);
      return () => window.clearTimeout(id);
    }
  }, [sp]);

  return (
    <div className="space-y-3">
      {toast ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
          {toast}
        </div>
      ) : null}
      <div>
        <p className="text-sm font-semibold text-gray-900">Perfil</p>
        <p className="mt-1 text-sm text-gray-600">Rol: {role ?? "—"}</p>
      </div>

      <div className="rounded-2xl bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-900">Consejos</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>Instala la app en el móvil (A2HS) para una experiencia más nativa.</li>
          <li>En iOS, si la cámara no abre: Ajustes → Safari → Cámara → Permitir.</li>
        </ul>
      </div>
    </div>
  );
}

