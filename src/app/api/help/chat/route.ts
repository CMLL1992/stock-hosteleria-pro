import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function getEnv() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { supabaseUrl, anonKey };
}

const OFF_TOPIC_REPLY =
  "Lo siento, solo puedo ayudarte con dudas sobre el funcionamiento de la App Piqui Blinders.";

const SYSTEM = `Eres el "Manual de usuario" de la aplicación OPS (también referida como App Piqui Blinders): gestión de stock, escandallos, checklists operativos, pedidos, proveedores y administración para hostelería.

REGLAS ESTRICTAS:
1) SOLO respondes sobre el FUNCIONAMIENTO de esta aplicación (pantallas, datos que se guardan en Supabase, roles admin/staff/superadmin, flujos de la app, qué botón hace qué, etc.).
2) NO des recetas de cocina, consejos médicos, política, otros programas, chistes ni conocimiento general fuera de la app.
3) Si la pregunta NO guarda relación con el uso de esta app, responde EXACTAMENTE una sola línea, sin comillas ni markdown:
${OFF_TOPIC_REPLY}
4) Responde en español, claro y breve (párrafos cortos). Si no sabes un detalle concreto de la app, dilo y sugiere revisar la sección Central de Ayuda o al administrador.`;

type ChatMsg = { role?: unknown; content?: unknown };

export async function POST(req: Request) {
  try {
    const { supabaseUrl, anonKey } = getEnv();
    if (!supabaseUrl || !anonKey) return json({ ok: false, error: "Missing Supabase env" }, 500);

    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) return json({ ok: false, error: "Missing auth token" }, 401);

    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    if (userErr || !userData.user) return json({ ok: false, error: "Not authenticated" }, 401);

    const body = (await req.json()) as { messages?: ChatMsg[] };
    const raw = Array.isArray(body?.messages) ? body.messages : [];
    const messages = raw
      .slice(-12)
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(m.content ?? "").slice(0, 4000)
      }))
      .filter((m) => m.content.trim());

    if (!messages.length || messages[messages.length - 1]?.role !== "user") {
      return json({ ok: false, error: "Invalid messages" }, 400);
    }

    if (!OPENAI_API_KEY) {
      return json({
        ok: true,
        reply:
          "La ayuda con IA no está configurada (falta OPENAI_API_KEY en el servidor). Mientras tanto, lee las secciones de documentación en esta misma página."
      });
    }

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.3,
        messages: [{ role: "system", content: SYSTEM }, ...messages]
      })
    });

    if (!resp.ok) {
      const t = await resp.text();
      return json({ ok: false, error: t.slice(0, 500) || "OpenAI error" }, 502);
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const reply = String(data.choices?.[0]?.message?.content ?? "").trim() || OFF_TOPIC_REPLY;
    return json({ ok: true, reply });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Error" }, 500);
  }
}
