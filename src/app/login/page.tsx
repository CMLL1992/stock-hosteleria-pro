"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { ensureUserRow } from "@/lib/ensureUserRow";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Asegura sesión + fila de usuario antes de navegar (móvil/PWA).
      await supabase().auth.refreshSession().catch(() => undefined);
      const s = await supabase().auth.getSession();
      const user = s.data.session?.user ?? null;
      if (user) await ensureUserRow(user);
      // Forzamos reload para que permisos/rol se reflejen inmediatamente.
      window.location.replace("/");
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function signUp() {
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase().auth.signUp({ email, password });
      if (error) throw error;
      await supabase().auth.refreshSession().catch(() => undefined);
      const s = await supabase().auth.getSession();
      const user = s.data.session?.user ?? null;
      if (user) await ensureUserRow(user);
      window.location.replace("/");
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-slate-50 p-4 pb-28 text-slate-900">
      <div className="mx-auto max-w-md">
        <div className="mb-6 pt-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-black text-white shadow-sm">
            <span className="text-lg font-extrabold tracking-wide">OPS</span>
          </div>
          <h1 className="mt-4 text-2xl font-semibold">Acceso</h1>
          <p className="mt-1 text-sm text-slate-600">Inicia sesión para gestionar stock y admin.</p>
        </div>

      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Email</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            type="email"
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.currentTarget.value)}
            autoComplete="email"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Contraseña</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            type="password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Button onClick={signIn} disabled={loading || !email || !password}>
            Entrar
          </Button>
          <Button
            onClick={signUp}
            disabled={loading || !email || !password}
            className="bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100"
          >
            Crear cuenta
          </Button>
        </div>
      </div>
      </div>
    </main>
  );
}

