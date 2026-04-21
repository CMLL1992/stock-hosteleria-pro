"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { Drawer } from "@/components/ui/Drawer";
import { fetchAdminEstablecimientosList } from "@/lib/fetchAdminEstablecimientos";
import { fetchAdminUsersList, patchAdminUserRole } from "@/lib/adminApi";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";
import type { UsuarioListItem, UsuarioRol } from "@/types/ops";

const LOAD_FAILED_MESSAGE = "⚠️ No se pudieron cargar los roles. Contacta con soporte.";

type EstRow = { id: string; nombre: string };

const ROLE_INFO: Record<
  UsuarioRol,
  { title: string; subtitle: string; emoji: string }
> = {
  superadmin: {
    emoji: "⭐",
    title: "Superadmin",
    subtitle: "Acceso total: Institucional, Catálogo y Operaciones."
  },
  admin: {
    emoji: "🛡️",
    title: "Admin",
    subtitle: "Catálogo y Operaciones de su establecimiento."
  },
  staff: {
    emoji: "🧑‍🍳",
    title: "Staff",
    subtitle: "Pedido rápido y visualización de stock."
  }
};

function normalizeRol(raw: string): UsuarioRol {
  const r = raw.trim().toLowerCase();
  if (r === "superadmin" || r === "admin" || r === "staff") return r;
  return "staff";
}

export default function SuperadminRolesPage() {
  const { data: me, isLoading: roleLoading } = useMyRole();
  const [myId, setMyId] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioListItem[]>([]);
  const [ests, setEsts] = useState<EstRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assignErr, setAssignErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<UsuarioListItem | null>(null);

  const allowed = !!me?.isSuperadmin && me.profileReady;

  const estNombreById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of ests) m.set(e.id, e.nombre);
    return m;
  }, [ests]);

  const loadData = useCallback(async () => {
    setLoadError(false);
    try {
      const s = await supabase().auth.getSession();
      setMyId(s.data.session?.user?.id ?? null);
      const [list, establishments] = await Promise.all([fetchAdminUsersList(), fetchAdminEstablecimientosList()]);
      setUsuarios(list);
      setEsts(establishments.map((x) => ({ id: x.id, nombre: x.nombre })));
    } catch {
      setLoadError(true);
      setUsuarios([]);
      setEsts([]);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadData();
  }, [allowed, loadData]);

  async function assignRole(rol: UsuarioRol) {
    if (!selected || busy) return;
    if (myId && selected.id === myId) {
      setAssignErr("No puedes cambiar tu propio rol.");
      return;
    }
    setAssignErr(null);
    setBusy(true);
    try {
      await patchAdminUserRole(selected.id, rol);
      await loadData();
      setSelected(null);
    } catch (e) {
      setAssignErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (roleLoading) {
    return (
      <main className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
        <p className="text-sm text-slate-600">Cargando…</p>
      </main>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Roles" showBack backHref="/admin" />
        <main className="mx-auto max-w-md p-4 pb-28">
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">Acceso denegado.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Roles" showBack backHref="/admin" />
      <main className="mx-auto max-w-lg p-4 pb-28 text-slate-900">
        <h1 className="text-xl font-semibold">Roles del equipo</h1>
        <p className="mt-1 text-sm text-slate-600">Toca un usuario para asignar Superadmin, Admin o Staff.</p>

        {loadError ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">{LOAD_FAILED_MESSAGE}</p>
        ) : null}

        {assignErr ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{assignErr}</p>
        ) : null}

        {!loadError ? (
          <ul className="mt-6 flex flex-col gap-2" aria-label="Usuarios">
            {usuarios.map((u) => {
              const nr = normalizeRol(u.rol);
              const info = ROLE_INFO[nr];
              const isSelf = myId !== null && u.id === myId;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className="flex w-full min-h-[52px] flex-col items-stretch gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm active:bg-slate-50"
                    onClick={() => {
                      setAssignErr(null);
                      setSelected(u);
                    }}
                    disabled={busy}
                  >
                    <span className="truncate text-base font-semibold text-slate-900">{u.email ?? u.id}</span>
                    <span className="text-sm text-slate-600">
                      {info.emoji} {info.title} · {estNombreById.get(u.establecimiento_id) ?? "Establecimiento"}
                    </span>
                    {isSelf ? <span className="text-xs font-medium text-slate-500">Tu cuenta (el rol no se puede cambiar aquí)</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {!loadError && usuarios.length === 0 ? <p className="mt-4 text-sm text-slate-500">No hay usuarios.</p> : null}
      </main>

      <Drawer open={!!selected} title={selected ? selected.email ?? "Usuario" : ""} onClose={() => !busy && setSelected(null)}>
        {selected ? (
          <div className="space-y-3 pb-2">
            <p className="text-sm text-slate-600">Nuevo rol para este usuario:</p>
            {(["superadmin", "admin", "staff"] as const).map((rol) => {
              const r = ROLE_INFO[rol];
              const current = normalizeRol(selected.rol) === rol;
              return (
                <button
                  key={rol}
                  type="button"
                  disabled={busy || (myId !== null && selected.id === myId)}
                  onClick={() => assignRole(rol)}
                  className={[
                    "flex min-h-[56px] w-full flex-col items-start justify-center rounded-2xl border-2 px-4 py-3 text-left transition",
                    current
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-200 bg-white hover:border-slate-400 active:bg-slate-50",
                    myId !== null && selected.id === myId ? "cursor-not-allowed opacity-50" : ""
                  ].join(" ")}
                >
                  <span className="text-lg font-bold text-slate-900">
                    {r.emoji} {r.title}
                  </span>
                  <span className="text-sm text-slate-600">{r.subtitle}</span>
                  {current ? <span className="mt-1 text-xs font-semibold text-emerald-700">Rol actual</span> : null}
                </button>
              );
            })}
            {busy ? <p className="text-center text-sm text-slate-500">Guardando…</p> : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
