import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Forzamos Frankfurt para reducir bloqueos/región. */
export const preferredRegion = ["fra1"];

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

const SYSTEM_PROMPT = `Eres el "Manual de usuario" de la aplicación OPS (también referida como App Piqui Blinders): gestión de stock, escandallos, checklists operativos, pedidos, proveedores y administración para hostelería.

REGLAS ESTRICTAS:
1) SOLO respondes sobre el FUNCIONAMIENTO de esta aplicación (pantallas, datos que se guardan en Supabase, roles admin/staff/superadmin, flujos de la app, qué botón hace qué, etc.).
2) NO des recetas de cocina, consejos médicos, política, otros programas, chistes ni conocimiento general fuera de la app.
3) Si la pregunta NO guarda relación con el uso de esta app, responde EXACTAMENTE una sola línea, sin comillas ni markdown:
${OFF_TOPIC_REPLY}
4) Responde en español, claro y breve (párrafos cortos). Si no sabes un detalle concreto de la app, dilo y sugiere revisar la sección Central de Ayuda o al administrador.`;

type ChatMsg = { role?: unknown; content?: unknown };

type RoleMsg = { role: "user" | "assistant"; content: string };

// Gemini desactivado temporalmente para aislar el problema (fallback).

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

async function openAiHelpReply(
  userContent: string,
  openaiKey: string
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    })
  });
  const rawText = await res.text();
  if (!res.ok) {
    console.log("[help/chat] OpenAI error body:", rawText);
  }
  let parsed: OpenAiChatResponse;
  try {
    parsed = JSON.parse(rawText) as OpenAiChatResponse;
  } catch {
    return {
      ok: false,
      error: `OpenAI: respuesta no es JSON. HTTP ${res.status} ${res.statusText}. Fragmento: ${rawText.slice(0, 800)}`
    };
  }
  if (!res.ok) {
    return { ok: false, error: `OpenAI (HTTP ${res.status}):\n${JSON.stringify(parsed, null, 2)}` };
  }
  const reply = String(parsed.choices?.[0]?.message?.content ?? "").trim();
  if (!reply) return { ok: true, reply: "Hola" };
  return { ok: true, reply };
}

export async function POST(req: Request) {
  try {
    console.log(
      "Claves configuradas - Gemini:",
      !!process.env.GOOGLE_API_KEY,
      "OpenAI:",
      !!process.env.OPENAI_API_KEY
    );

    const apiKey = process.env.OPENAI_API_KEY?.trim();

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
    const messages: RoleMsg[] = raw
      .slice(-12)
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(m.content ?? "").slice(0, 4000)
      }))
      .filter((m) => m.content.trim());

    if (!messages.length || messages[messages.length - 1]?.role !== "user") {
      return json({ ok: false, error: "Invalid messages" }, 400);
    }

    if (!apiKey) {
      return json(
        {
          ok: false,
          error:
            "Error de Configuración: falta OPENAI_API_KEY. En Vercel → Settings → Environment Variables define OPENAI_API_KEY (a nivel de proyecto) y redeploy."
        },
        503
      );
    }

    const mensajeUsuario = messages[messages.length - 1].content;

    // Solo OpenAI por ahora (Gemini desactivado temporalmente).
    const oa = await openAiHelpReply(mensajeUsuario, apiKey);
    if (oa.ok) return json({ ok: true, reply: oa.reply });
    return json({ ok: false, error: oa.error }, 502);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
}
