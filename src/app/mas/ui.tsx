"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMyRole } from "@/lib/useMyRole";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { supabase } from "@/lib/supabase";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { supabaseErrToString } from "@/lib/supabaseErrToString";

export function MoreClient() {
  const { data, isLoading, error } = useMyRole();
  const { activeEstablishmentId } = useActiveEstablishment();
  const sp = useSearchParams();
  const [toast, setToast] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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
      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          href="/checklist"
          className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-black px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-900"
        >
          Checklist operativo
        </Link>
        <Link
          href="/ayuda"
          className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
        >
          Ayuda
        </Link>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-900">Perfil</p>
        <p className="mt-1 text-sm text-gray-600">
          Rol: {isLoading ? "Cargando…" : error ? "—" : (data?.role ?? "—")}
        </p>
        {error ? (
          <p className="mt-1 text-xs text-gray-500">
            No se pudo cargar el rol. Puedes entrar al panel desde el botón de abajo.
          </p>
        ) : null}
      </div>

      <a
        href="/admin"
        className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-gray-100 bg-white px-4 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50"
      >
        Entrar a Panel Control
      </a>

      <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <p className="text-sm font-semibold text-gray-900">Ajustes</p>
        {exportErr ? <p className="mt-1 text-xs text-red-700">{exportErr}</p> : null}
        <button
          type="button"
          disabled={exporting || !activeEstablishmentId}
          onClick={async () => {
            if (!activeEstablishmentId) {
              setExportErr("Selecciona un establecimiento antes de exportar.");
              return;
            }
            setExportErr(null);
            setExporting(true);
            try {
              const col = await resolveProductoTituloColumn(activeEstablishmentId);
              const t = tituloColSql(col);
              const { data: rows, error } = await supabase()
                .from("productos")
                .select(`id,${t},categoria,tipo,unidad,stock_actual,stock_minimo,proveedor_id` as "*")
                .eq("establecimiento_id", activeEstablishmentId)
                .order(t, { ascending: true });
              if (error) throw error;

              const safe = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
              const header = ["id", "nombre", "categoria", "tipo", "unidad", "stock_actual", "stock_minimo", "proveedor_id"].join(";");
              const lines = ((rows ?? []) as unknown as Array<Record<string, unknown>>).map((r) =>
                [
                  safe(r.id),
                  safe(r[t] ?? r.articulo ?? r.nombre ?? ""),
                  safe(r.categoria),
                  safe(r.tipo),
                  safe(r.unidad),
                  safe(r.stock_actual ?? 0),
                  safe(r.stock_minimo ?? 0),
                  safe(r.proveedor_id)
                ].join(";")
              );
              const csv = [header, ...lines].join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `backup-productos-${activeEstablishmentId}-${new Date().toISOString().slice(0, 10)}.csv`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              setToast("Backup exportado ✓");
              window.setTimeout(() => setToast(null), 1600);
            } catch (e) {
              setExportErr(supabaseErrToString(e));
            } finally {
              setExporting(false);
            }
          }}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
          title={!activeEstablishmentId ? "Selecciona un establecimiento" : "Descarga CSV del catálogo"}
        >
          {exporting ? "Exportando…" : "Exportar Backup de Productos"}
        </button>
        <p className="mt-1 text-xs text-slate-500">Descarga un CSV del catálogo del establecimiento activo.</p>
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

