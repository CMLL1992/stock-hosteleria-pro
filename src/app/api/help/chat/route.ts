import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

type RoleMsg = { role: "user" | "assistant"; content: string };

type GeminiGenerateResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; code?: number; status?: string };
};

function replyFromGeminiBody(data: GeminiGenerateResponse): string {
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts?.length) return "";
  return parts
    .map((p) => String(p.text ?? ""))
    .join("")
    .trim();
}

export async function POST(req: Request) {
  try {
    const googleApiKey = String(process.env.GOOGLE_API_KEY ?? "").trim();
    console.log("API KEY EXISTE:", !!googleApiKey);

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

    if (!googleApiKey) {
      return json(
        {
          ok: false,
          error:
            "Error de Configuración: falta GOOGLE_API_KEY en el servidor. En Vercel ve a Project → Settings → Environment Variables, crea GOOGLE_API_KEY con tu clave de Google AI, márcala para Production (y Preview si aplica) y vuelve a desplegar para que el runtime Node la cargue."
        },
        503
      );
    }

    const mensajeUsuario = messages[messages.length - 1].content;
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: SYSTEM + "\n\n" + mensajeUsuario }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(googleApiKey)}`;
    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    let data: GeminiGenerateResponse;
    try {
      data = (await geminiRes.json()) as GeminiGenerateResponse;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return json({ ok: false, error: `Respuesta Gemini no JSON: ${msg}` }, 502);
    }

    if (!geminiRes.ok) {
      const apiMsg = data.error?.message ?? geminiRes.statusText;
      return json({ ok: false, error: apiMsg || `HTTP ${geminiRes.status}` }, geminiRes.status >= 400 && geminiRes.status < 600 ? geminiRes.status : 502);
    }

    const reply = replyFromGeminiBody(data) || OFF_TOPIC_REPLY;
    return json({ ok: true, reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
}
