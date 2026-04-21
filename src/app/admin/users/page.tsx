"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MobileHeader } from "@/components/MobileHeader";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";

type EstRow = { id: string; nombre: string; plan_suscripcion?: string | null };

export default function AdminUsersPage() {
  const { data: me, isLoading } = useMyRole();
  const [ests, setEsts] = useState<EstRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<"admin" | "staff">("staff");
  const [establecimientoId, setEstablecimientoId] = useState<string>("");

  const allowed = !!me?.isSuperadmin && me.profileReady;

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase()
        .from("establecimientos")
        .select("id,nombre,plan_suscripcion")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (!error) {
        const rows = (data as unknown as EstRow[]) ?? [];
        setEsts(rows);
        if (!establecimientoId && rows[0]?.id) setEstablecimientoId(rows[0].id);
        return;
      }

      const msg = (error as { message?: string }).message?.toLowerCase() ?? "";
      const missingPlan = msg.includes("plan_suscripcion") && msg.includes("could not find");
      if (!missingPlan) throw error;

      const fb = await supabase().from("establecimientos").select("id,nombre").order("created_at", { ascending: true });
      if (fb.error) throw fb.error;
      const rows = ((fb.data as unknown as Array<{ id: string; nombre: string }>) ?? []).map((r) => ({
        ...r,
        plan_suscripcion: null
      }));
      setEsts(rows);
      if (!establecimientoId && rows[0]?.id) setEstablecimientoId(rows[0].id);
    })().catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const canSubmit = useMemo(() => {
    return !!email.trim() && password.length >= 6 && !!establecimientoId && !busy;
  }, [busy, email, establecimientoId, password.length]);

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
        body: JSON.stringify({ email: email.trim(), password, rol, establecimiento_id: establecimientoId })
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error || "Error creando usuario.");
      setOk("Usuario creado correctamente.");
      setEmail("");
      setPassword("");
      setRol("staff");
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

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                onChange={(e) => setRol(e.currentTarget.value as "admin" | "staff")}
              >
                <option value="staff">staff</option>
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
    </div>
  );
}

