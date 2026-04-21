"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";

export function LoginForm({ onSuccessHref = "/" }: { onSuccessHref?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = onSuccessHref;
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
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
          <p className="mt-1 text-sm text-slate-600">Inicia sesión para continuar.</p>
        </div>

        {err ? (
          <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p>
        ) : null}

        <form
          className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
          onSubmit={submit}
        >
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-900">Email</label>
            <input
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
              type="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.currentTarget.value)}
              autoComplete="email"
              name="email"
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
              name="password"
            />
          </div>
          <Button type="submit" disabled={loading || !email || !password}>
            {loading ? "Entrando…" : "Entrar"}
          </Button>
          <p className="text-xs text-slate-500">
            Si tu cuenta no está provisionada para un establecimiento, contacta con el administrador.
          </p>
        </form>
      </div>
    </main>
  );
}

