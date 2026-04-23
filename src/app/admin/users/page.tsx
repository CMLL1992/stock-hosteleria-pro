"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { MobileHeader } from "@/components/MobileHeader";
import { deleteAdminUser, fetchAdminUsersList, patchAdminUserRole } from "@/lib/adminApi";
import { fetchAdminEstablecimientosList } from "@/lib/fetchAdminEstablecimientos";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import type { UsuarioListItem } from "@/types/ops";

type EstRow = { id: string; nombre: string; plan_suscripcion?: string | null };

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useMyRole();
  const [ests, setEsts] = useState<EstRow[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioListItem[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<"superadmin" | "admin" | "staff">("staff");
  const [establecimientoId, setEstablecimientoId] = useState<string>("");

  const [confirmDeleteUser, setConfirmDeleteUser] = useState<UsuarioListItem | null>(null);
  const [editUser, setEditUser] = useState<UsuarioListItem | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [editRol, setEditRol] = useState<"superadmin" | "admin" | "staff">("staff");
  const [editEstId, setEditEstId] = useState<string>("");

  const allowed = !!me?.isSuperadmin && me.profileReady;

  const estNombreById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of ests) m.set(e.id, e.nombre);
    return m;
  }, [ests]);

  const loadAll = useCallback(async () => {
    const s = await supabase().auth.getSession();
    setMyId(s.data.session?.user?.id ?? null);
    const list = await fetchAdminEstablecimientosList();
    const rows: EstRow[] = list.map((x) => ({
      id: x.id,
      nombre: x.nombre,
      plan_suscripcion: x.plan_suscripcion ?? null
    }));
    setEsts(rows);
    setEstablecimientoId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? ""));
    setUsuarios(await fetchAdminUsersList());
  }, []);

  useEffect(() => {
    if (!allowed) return;
    loadAll().catch((e) => setErr(supabaseErrToString(e)));
  }, [allowed, loadAll]);

  const canSubmit = useMemo(() => {
    return !!nombre.trim() && !!email.trim() && password.length >= 6 && !!establecimientoId && !busy;
  }, [busy, email, establecimientoId, nombre, password.length]);

  async function crear() {
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const s = await supabase().auth.getSession();
      const token = s.data.session?.access_token;
      if (!token) throw new Error("No hay sesión activa.");

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre_completo: nombre.trim(), email: email.trim(), password, rol, establecimiento_id: establecimientoId })
      });
      const json = (await res.json()) as { ok?: boolean; reused?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Error creando usuario.");
      setOk(json.reused ? "Usuario ya existía: rol/establecimiento actualizados." : "Usuario creado correctamente.");
      setEmail("");
      setPassword("");
      setNombre("");
      setRol("staff");
      await loadAll();
      void queryClient.invalidateQueries({ queryKey: ["myRole"] });
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setBusy(false);
    }
  }

  async function ejecutarBorrarUsuario() {
    if (!confirmDeleteUser) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await deleteAdminUser(confirmDeleteUser.id);
      setOk("Usuario eliminado.");
      setConfirmDeleteUser(null);
      await loadAll();
      void queryClient.invalidateQueries({ queryKey: ["establecimientos"] });
      void queryClient.invalidateQueries({ queryKey: ["myRole"] });
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setBusy(false);
    }
  }

  async function guardarEdicion() {
    if (!editUser) return;
    if (!editNombre.trim()) {
      setErr("El nombre no puede estar vacío.");
      return;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await patchAdminUserRole(editUser.id, editRol, editEstId, editNombre.trim());
      setOk("Usuario actualizado.");
      setEditUser(null);
      await loadAll();
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
        <p className="text-sm text-slate-600">Cargando perfil…</p>
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
        <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Acceso restringido.</p>
          <p className="mt-1 text-sm text-slate-600">Solo superadmin puede gestionar usuarios.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Usuarios" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <div className="mb-3">
          <h1 className="text-xl font-semibold text-slate-900">Gestión de usuarios</h1>
        </div>

        {err ? <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}
        {ok ? <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{ok}</p> : null}

        <div className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Usuarios</p>
          <p className="mt-1 text-xs text-slate-500">Mismo orden que en base de datos (email).</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {usuarios.map((u) => {
              const isSelf = myId !== null && u.id === myId;
              const estId = typeof (u as unknown as { establecimiento_id?: unknown }).establecimiento_id === "string"
                ? ((u as unknown as { establecimiento_id: string }).establecimiento_id as string)
                : "";
              const estLabel =
                (estId && estNombreById.get(estId)) ||
                (estId ? `${estId.slice(0, 8)}…` : "—");
              const nombreMostrado = String((u as unknown as { nombre_completo?: unknown }).nombre_completo ?? "").trim();
              return (
                <li key={u.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{nombreMostrado || u.email || u.id}</p>
                    <p className="text-xs text-slate-500">
                      {u.rol} · {estLabel}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="min-h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        setErr(null);
                        setOk(null);
                        setEditUser(u);
                        setEditNombre(nombreMostrado || "");
                        setEditRol((String(u.rol ?? "staff") as "superadmin" | "admin" | "staff") || "staff");
                        setEditEstId(estId || ests[0]?.id || "");
                      }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="min-h-10 rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSelf || busy}
                      onClick={async () => {
                        if (isSelf) return;
                        setConfirmDeleteUser(u);
                      }}
                    >
                      {isSelf ? "Tu cuenta" : "Borrar"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {usuarios.length === 0 ? <p className="text-sm text-slate-500">No hay usuarios.</p> : null}
        </div>

        {editUser ? (
          <div className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Editar usuario</p>
            <p className="mt-1 text-xs text-slate-500">{editUser.email ?? editUser.id}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-semibold text-slate-900">Nombre</label>
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={editNombre}
                  onChange={(e) => setEditNombre(e.currentTarget.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">Rol</label>
                <select
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={editRol}
                  onChange={(e) => setEditRol(e.currentTarget.value as "superadmin" | "admin" | "staff")}
                >
                  <option value="staff">staff</option>
                  <option value="admin">admin</option>
                  <option value="superadmin">superadmin</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">Establecimiento</label>
                <select
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={editEstId}
                  onChange={(e) => setEditEstId(e.currentTarget.value)}
                >
                  {ests.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button onClick={guardarEdicion} disabled={busy || !editNombre.trim() || !editEstId}>
                {busy ? "Guardando…" : "Guardar cambios"}
              </Button>
              <button
                type="button"
                className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                onClick={() => setEditUser(null)}
                disabled={busy}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Crear usuario</p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-semibold text-slate-900">Nombre (obligatorio)</label>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={nombre}
                onChange={(e) => setNombre(e.currentTarget.value)}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Email</label>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                autoComplete="email"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Contraseña</label>
              <input
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                autoComplete="new-password"
                type="password"
              />
              <p className="text-xs text-slate-500">Mínimo 6 caracteres (recomendado 10+).</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Rol</label>
              <select
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={rol}
                onChange={(e) => setRol(e.currentTarget.value as "superadmin" | "admin" | "staff")}
              >
                <option value="staff">staff</option>
                <option value="admin">admin</option>
                <option value="superadmin">superadmin</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-900">Establecimiento</label>
              <select
                className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                value={establecimientoId}
                onChange={(e) => setEstablecimientoId(e.currentTarget.value)}
              >
                {ests.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                    {x.plan_suscripcion ? ` (${x.plan_suscripcion})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <Button onClick={crear} disabled={!canSubmit}>
              {busy ? "Creando…" : "Crear usuario"}
            </Button>
          </div>
        </div>
      </main>

      <ConfirmModal
        open={!!confirmDeleteUser}
        title="Eliminar usuario"
        message="¿Estás seguro de que quieres eliminar a este usuario?"
        confirmLabel="Eliminar"
        danger
        busy={busy}
        onCancel={() => setConfirmDeleteUser(null)}
        onConfirm={ejecutarBorrarUsuario}
      />
    </div>
  );
}
