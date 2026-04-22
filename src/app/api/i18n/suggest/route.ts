import { NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { term?: unknown; lang?: unknown };
    const term = String(body?.term ?? "").trim();
    const lang = String(body?.lang ?? "").trim().toLowerCase();

    if (!term) return NextResponse.json({ translation: "" }, { status: 400 });
    if (lang !== "en" && lang !== "ca") return NextResponse.json({ translation: term }, { status: 200 });

    if (!OPENAI_API_KEY) {
      // Sin API key -> sin traducción dinámica
      return NextResponse.json({ translation: term }, { status: 200 });
    }

    const target = lang === "en" ? "English" : "Catalan";
    const system =
      "You are a precise professional translator for a hospitality stock management app. " +
      "Return only the translated text, no quotes, no extra punctuation, no explanations.";
    const user = `Translate to ${target}: ${term}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!resp.ok) {
      return NextResponse.json({ translation: term }, { status: 200 });
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const translation = String(json.choices?.[0]?.message?.content ?? "").trim() || term;
    return NextResponse.json({ translation }, { status: 200 });
  } catch {
    return NextResponse.json({ translation: "" }, { status: 400 });
  }
}

