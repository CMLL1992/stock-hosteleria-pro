"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";

type Msg = { role: "user" | "assistant"; content: string };

export function HelpChat() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hola. Soy el asistente del manual de **OPS / Piqui Blinders**. Pregúntame solo sobre el uso de la app (stock, escandallos, checklist, pedidos, roles…)."
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setErr(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const { data: sess } = await supabase().auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sesión no disponible.");

      const res = await fetch("/api/help/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ messages: next })
      });
      const json = (await res.json()) as { ok?: boolean; reply?: string; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "Error al contactar la IA.");
      const reply = String(json.reply ?? "").trim() || "Sin respuesta.";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">Asistente (manual de usuario)</h2>
      <p className="mt-1 text-xs text-slate-500">Solo dudas sobre esta app. Sin recetas ni temas ajenos.</p>

      {err ? <p className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-800">{err}</p> : null}

      <div className="mt-3 max-h-[min(420px,55vh)] space-y-2 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50 p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={[
              "max-w-[95%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
              m.role === "user" ? "ml-auto bg-black text-white" : "mr-auto border border-slate-200 bg-white text-slate-800"
            ].join(" ")}
          >
            {m.content}
          </div>
        ))}
        {loading ? <p className="text-center text-xs text-slate-500">Pensando…</p> : null}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="min-h-12 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
          placeholder="Ej: ¿Cómo registro una salida de stock?"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={loading}
        />
        <Button type="button" className="shrink-0 px-4" disabled={loading || !input.trim()} onClick={() => void send()}>
          Enviar
        </Button>
      </div>
    </section>
  );
}
