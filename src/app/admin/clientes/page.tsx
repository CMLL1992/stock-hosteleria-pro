"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MobileHeader } from "@/components/MobileHeader";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";

type EstRow = { id: string; nombre: string; plan_suscripcion: string };

export default function AdminClientesPage() {
  const { data: me, isLoading } = useMyRole();
  const [ests, setEsts] = useState<EstRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nombre, setNombre] = useState("");
  const [plan, setPlan] = useState("free");
  const [logoUrl, setLogoUrl] = useState("");

  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRol, setUserRol] = useState<"admin" | "staff">("staff");
  const [establecimientoId, setEstablecimientoId] = useState<string>("");

  const allowed = !!me?.isSuperadmin && me.profileReady;

  async function refreshEts() {
    const { data, error } = await supabase()
      .from("establecimientos")
      .select("id,nombre,plan_suscripcion")
      .order("nombre", { ascending: true });
    if (error) throw error;
    const rows = (data as unknown as EstRow[]) ?? [];
    setEsts(rows);
    if (!establecimientoId && rows[0]?.id) setEstablecimientoId(rows[0].id);
  }

  useEffect(() => {
    if (!allowed) return;
    refreshEts().catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const canCreateEst = useMemo(() => !!nombre.trim() && !busy, [busy, nombre]);
  const canCreateUser = useMemo(
    () => !!userEmail.trim() && userPassword.length >= 6 && !!establecimientoId && !busy,
    [busy, establecimientoId, userEmail, userPassword.length]
  );

  async function crearEstablecimiento() {
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const s = await supabase().auth.getSession();
      const token = s.data.session?.access_token;
      if (!token) throw new Error("No hay sesión activa.");

      const res = await fetch("/api/admin/establecimientos", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre: nombre.trim(), plan_suscripcion: plan, logo_url: logoUrl.trim() || null })
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Error creando establecimiento.");
      setOk("Establecimiento creado.");
      setNombre("");
      setPlan("free");
      setLogoUrl("");
      await refreshEts();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function crearUsuario() {
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
        body: JSON.stringify({
          email: userEmail.trim(),
          password: userPassword,
          rol: userRol,
          establecimiento_id: establecimientoId
        })
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Error creando usuario.");
      setOk("Usuario creado.");
      setUserEmail("");
      setUserPassword("");
      setUserRol("staff");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
          <p className="mt-1 text-sm text-slate-600">Solo superadmin puede gestionar clientes.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <MobileHeader title="Clientes" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <div className="mb-3">
          <h1 className="text-xl font-semibold text-slate-900">Clientes (Establecimientos)</h1>
        </div>

        {err ? <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}
        {ok ? <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{ok}</p> : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Crear establecimiento</p>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">Nombre</label>
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={nombre}
                  onChange={(e) => setNombre(e.currentTarget.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">Plan</label>
                <select
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={plan}
                  onChange={(e) => setPlan(e.currentTarget.value)}
                >
                  <option value="free">free</option>
                  <option value="pro">pro</option>
                  <option value="enterprise">enterprise</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">URL del logo (opcional)</label>
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.currentTarget.value)}
                  placeholder="https://…"
                  inputMode="url"
                />
              </div>
              <Button onClick={crearEstablecimiento} disabled={!canCreateEst}>
                {busy ? "Creando…" : "Crear"}
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Crear usuario y asignar</p>
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">Email</label>
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.currentTarget.value)}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-slate-900">Contraseña</label>
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.currentTarget.value)}
                  autoComplete="new-password"
                  type="password"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-900">Rol</label>
                  <select
                    className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
                    value={userRol}
                    onChange={(e) => setUserRol(e.currentTarget.value as "admin" | "staff")}
                  >
                    <option value="staff">user (staff)</option>
                    <option value="admin">admin</option>
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
                        {x.nombre} ({x.plan_suscripcion})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button onClick={crearUsuario} disabled={!canCreateUser}>
                {busy ? "Creando…" : "Crear usuario"}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

