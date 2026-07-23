import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ExtractedFaq {
  question: string;
  answer: string;
}

export interface ExtractFaqsResult {
  pairs: ExtractedFaq[];
  warnings: string[];
}

// Strip WhatsApp export line prefixes like "[12/3/25, 10:04:22] Juan Pérez: hola"
// or "12/3/25 10:04 - Juan Pérez: hola" and remove sender names, keeping only
// the message body. Runs BEFORE sending to the AI so no names ever leave.
function stripWhatsAppMetadata(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  // Match common WhatsApp export formats.
  // Format A (iOS): [DD/MM/YY, HH:MM:SS] Sender: message
  // Format B (Android): DD/MM/YY, HH:MM - Sender: message  (also H:MM a. m.)
  const rxIos = /^\[\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\]\s*([^:]{1,80}?):\s?(.*)$/i;
  const rxAndroid = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\s*[-–—]\s*([^:]{1,80}?):\s?(.*)$/i;
  const rxSystem = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\s*[-–—]\s*/i;

  let currentIsSystem = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { out.push(""); continue; }
    let m = line.match(rxIos) || line.match(rxAndroid);
    if (m) {
      const body = (m[2] ?? "").trim();
      // Drop system lines (encryption notices, media omitted, etc.)
      if (
        !body ||
        /^<Multimedia omitido>$/i.test(body) ||
        /^<Media omitted>$/i.test(body) ||
        /cifrados de extremo/i.test(body) ||
        /end-to-end encrypted/i.test(body) ||
        /created group/i.test(body) ||
        /añadió a/i.test(body)
      ) {
        currentIsSystem = true;
        continue;
      }
      currentIsSystem = false;
      // Anonymize: drop sender name entirely, just keep message.
      out.push(body);
      continue;
    }
    if (rxSystem.test(line)) { currentIsSystem = true; continue; }
    // Continuation of previous line (multi-line message)
    if (!currentIsSystem) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const extractFaqsFromChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = data as { text?: string; branchId?: string };
    if (!d?.text || typeof d.text !== "string") throw new Error("Texto requerido");
    if (!d?.branchId || typeof d.branchId !== "string") throw new Error("Sede requerida");
    // Cap size to keep AI cost bounded (~40k chars).
    return { text: d.text.slice(0, 40000), branchId: d.branchId };
  })
  .handler(async ({ data }): Promise<ExtractFaqsResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY no configurado");

    const cleaned = stripWhatsAppMetadata(data.text);
    if (!cleaned || cleaned.length < 20) {
      return { pairs: [], warnings: ["El archivo no contiene mensajes reconocibles."] };
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
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
      if (resp.status === 429) throw new Error("Servicio de IA saturado, intenta de nuevo en unos segundos");
      if (resp.status === 402) throw new Error("Créditos de IA agotados. Contacta al administrador.");
      throw new Error(`AI error ${resp.status}: ${errText.slice(0, 200)}`);
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
    const pairs: ExtractedFaq[] = [];
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
    return { pairs, warnings };
  });
