import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Strip WhatsApp export line prefixes and sender names.
function stripWhatsAppMetadata(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  const rxIos = /^\[\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\]\s*([^:]{1,80}?):\s?(.*)$/i;
  const rxAndroid = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\s*[-–—]\s*([^:]{1,80}?):\s?(.*)$/i;
  const rxSystem = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\s*[-–—]\s*/i;

  let currentIsSystem = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { out.push(""); continue; }
    const m = line.match(rxIos) || line.match(rxAndroid);
    if (m) {
      const body = (m[2] ?? "").trim();
      if (
        !body ||
        /^<Multimedia omitido>$/i.test(body) ||
        /^<Media omitted>$/i.test(body) ||
        /cifrados de extremo/i.test(body) ||
        /end-to-end encrypted/i.test(body) ||
        /created group/i.test(body) ||
        /añadió a/i.test(body)
      ) { currentIsSystem = true; continue; }
      currentIsSystem = false;
      out.push(body);
      continue;
    }
    if (rxSystem.test(line)) { currentIsSystem = true; continue; }
    if (!currentIsSystem) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/public/faq-extract")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("Authorization") ?? "";
          const token = authHeader.replace(/^Bearer\s+/i, "").trim();
          if (!token) {
            return Response.json({ error: "No autenticado" }, { status: 401, headers: CORS });
          }

          // Verify user via anon client + bearer token (RLS as caller).
          const url = process.env.SUPABASE_URL!;
          const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
          const supa = createClient(url, anon, {
            global: {
              fetch: (input, init) => {
                const h = new Headers(init?.headers);
                if (anon.startsWith("sb_") && h.get("Authorization") === `Bearer ${anon}`) h.delete("Authorization");
                h.set("apikey", anon);
                h.set("Authorization", `Bearer ${token}`);
                return fetch(input, { ...init, headers: h });
              },
            },
            auth: { persistSession: false },
          });
          const { data: userRes, error: userErr } = await supa.auth.getUser(token);
          if (userErr || !userRes?.user) {
            return Response.json({ error: "Token inválido" }, { status: 401, headers: CORS });
          }

          const body = (await request.json().catch(() => ({}))) as { text?: string; branchId?: string };
          const text = typeof body.text === "string" ? body.text.slice(0, 40000) : "";
          const branchId = typeof body.branchId === "string" ? body.branchId : "";
          if (!text || !branchId) {
            return Response.json({ error: "Faltan datos (text, branchId)" }, { status: 400, headers: CORS });
          }

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json({ error: "LOVABLE_API_KEY no configurado en este dominio" }, { status: 500, headers: CORS });
          }

          const cleaned = stripWhatsAppMetadata(text);
          if (!cleaned || cleaned.length < 20) {
            return Response.json({ pairs: [], warnings: ["El archivo no contiene mensajes reconocibles."] }, { headers: CORS });
          }

          const systemPrompt = `Eres un extractor de preguntas frecuentes para una heladería.
Recibirás un chat SIN nombres ni fechas (solo mensajes en orden). Debes identificar
las preguntas típicas de clientes y las respuestas oficiales del negocio.

Reglas ESTRICTAS:
- Devuelve SOLO JSON con esta forma: {"pairs":[{"question":"...","answer":"..."}]}
- NO incluyas nombres propios, teléfonos, direcciones exactas de clientes, ni datos personales.
- La "question" debe estar redactada como la haría un cliente cualquiera (genérica, sin nombres, sin "hola Juan").
- La "answer" debe reflejar la respuesta oficial del negocio (precios, horarios, sabores, promos, políticas).
  Reescríbela clara, breve y en la voz del negocio. Sin saludos personales.
- Descarta charla trivial ("hola", "gracias", "ok", "jaja").
- Descarta pedidos individuales concretos ("quiero 2 conos para Juan a las 5") — no son FAQ.
- Consolida preguntas repetidas en una sola.
- Máximo 25 pares. Prioriza las más frecuentes y útiles.
- Si no hay nada útil, devuelve {"pairs":[]}.
- Sin texto fuera del JSON.`;

          const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: cleaned },
              ],
              response_format: { type: "json_object" },
            }),
          });

          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            const msg = resp.status === 429 ? "Servicio de IA saturado, intenta de nuevo en unos segundos"
              : resp.status === 402 ? "Créditos de IA agotados. Contacta al administrador."
              : `AI error ${resp.status}: ${errText.slice(0, 200)}`;
            return Response.json({ error: msg }, { status: 502, headers: CORS });
          }

          const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const content = json?.choices?.[0]?.message?.content ?? "{}";
          let parsed: { pairs?: Array<{ question?: unknown; answer?: unknown }> } = {};
          try { parsed = JSON.parse(content); } catch {
            const m = content.match(/\{[\s\S]*\}/);
            if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
          }

          const rawPairs = Array.isArray(parsed.pairs) ? parsed.pairs : [];
          const seen = new Set<string>();
          const pairs: Array<{ question: string; answer: string }> = [];
          for (const p of rawPairs) {
            const question = String(p?.question ?? "").trim();
            const answer = String(p?.answer ?? "").trim();
            if (!question || !answer) continue;
            if (question.length > 400 || answer.length > 1200) continue;
            const key = question.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            pairs.push({ question, answer });
            if (pairs.length >= 25) break;
          }

          const warnings: string[] = [];
          if (pairs.length === 0) warnings.push("La IA no encontró preguntas frecuentes claras en el chat.");
          return Response.json({ pairs, warnings }, { headers: CORS });
        } catch (err) {
          return Response.json({ error: (err as Error).message }, { status: 500, headers: CORS });
        }
      },
    },
  },
});
