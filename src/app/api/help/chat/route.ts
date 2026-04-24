import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Frankfurt o Sydney: regiones Vercel que suelen evitar bloqueos de ubicación de la API de Google. */
export const preferredRegion = ["fra1", "syd1"];

// Despliegue con nueva API Key

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

type GeminiContentsPayload = {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  generationConfig: { temperature: number; maxOutputTokens: number };
};

async function geminiGenerateContent(
  modelId: string,
  googleApiKey: string,
  contentsPayload: GeminiContentsPayload,
  apiVersion: "v1" | "v1beta" = "v1"
): Promise<{ res: Response; data: GeminiGenerateResponse; bodyReadError: string | null }> {
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelId}:generateContent?key=${googleApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${modelId}`,
      ...contentsPayload
    })
  });
  const rawText = await res.text();
  if (!rawText.trim()) {
    return {
      res,
      data: {},
      bodyReadError: `Google: cuerpo vacío. HTTP ${res.status} ${res.statusText}`
    };
  }
  try {
    const parsed = JSON.parse(rawText) as GeminiGenerateResponse;
    return { res, data: parsed, bodyReadError: null };
  } catch {
    const preview = rawText.length > 2000 ? `${rawText.slice(0, 2000)}…` : rawText;
    return {
      res,
      data: {},
      bodyReadError: `Google: respuesta no es JSON válido. HTTP ${res.status} ${res.statusText}. Fragmento: ${preview}`
    };
  }
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
    const contentsPayload: GeminiContentsPayload = {
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

    /** gemini-pro ya no existe en v1 para generateContent (404). Orden: v1 flash → v1 2.0 → v1beta flash. */
    const attempts: Array<{ api: "v1" | "v1beta"; model: string }> = [
      { api: "v1", model: "gemini-1.5-flash" },
      { api: "v1", model: "gemini-2.0-flash" },
      { api: "v1beta", model: "gemini-1.5-flash" }
    ];

    let geminiRes!: Response;
    let data!: GeminiGenerateResponse;
    let bodyReadError: string | null = null;

    for (let i = 0; i < attempts.length; i++) {
      const { api, model } = attempts[i];
      const r = await geminiGenerateContent(model, googleApiKey, contentsPayload, api);
      geminiRes = r.res;
      data = r.data;
      bodyReadError = r.bodyReadError;

      if (bodyReadError) {
        console.error("[help/chat] Gemini body parse:", bodyReadError);
        return json({ ok: false, error: bodyReadError }, 502);
      }

      if (geminiRes.ok) break;

      const is404 = geminiRes.status === 404;
      const hasMore = i < attempts.length - 1;
      if (!is404 || !hasMore) {
        const fullGoogle = JSON.stringify(data, null, 2);
        console.error("[help/chat] Gemini HTTP", api, model, geminiRes.status, fullGoogle);
        return json(
          {
            ok: false,
            error: `Google API (${api} / ${model} — HTTP ${geminiRes.status}):\n${fullGoogle}`
          },
          geminiRes.status >= 400 && geminiRes.status < 600 ? geminiRes.status : 502
        );
      }
    }

    if (!geminiRes.ok) {
      const fullGoogle = JSON.stringify(data, null, 2);
      return json({ ok: false, error: `Google API:\n${fullGoogle}` }, 502);
    }

    const reply = replyFromGeminiBody(data) || OFF_TOPIC_REPLY;
    return json({ ok: true, reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
}
