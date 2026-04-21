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
      const u = await supabase().auth.getUser();
      if (u.data.user) await ensureUserRow(u.data.user);
      window.location.href = "/";
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
      const u = await supabase().auth.getUser();
      if (u.data.user) await ensureUserRow(u.data.user);
      window.location.href = "/";
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-2 text-2xl font-semibold">Iniciar sesión</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        Necesario para aplicar RLS y registrar movimientos.
      </p>

      {err ? (
        <p className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </p>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-1">
          <label className="text-sm font-medium">Email</label>
          <input
            className="min-h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base dark:border-zinc-800 dark:bg-zinc-950"
            type="email"
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.currentTarget.value)}
            autoComplete="email"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Contraseña</label>
          <input
            className="min-h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base dark:border-zinc-800 dark:bg-zinc-950"
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
          <Button onClick={signUp} disabled={loading || !email || !password} className="bg-zinc-700">
            Crear cuenta
          </Button>
        </div>
      </div>
    </main>
  );
}

