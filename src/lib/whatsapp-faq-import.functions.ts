import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseFaqText, stripWhatsAppMetadata, chunkText } from "./faq-parser";

export interface ExtractedFaq {
  question: string;
  answer: string;
}

export interface ExtractFaqsResult {
  pairs: ExtractedFaq[];
  warnings: string[];
  stats: {
    totalDetected: number;
    imported: number;
    errors: Array<{ index: number; reason: string; snippet: string }>;
    source: "deterministic" | "ai" | "mixed";
    chunks?: number;
  };
}

async function callGeminiForChunk(apiKey: string, chunk: string, maxPairs: number): Promise<Array<{ question: string; answer: string }>> {
  const systemPrompt = `Eres un extractor de preguntas frecuentes para una heladería.
Recibirás texto SIN nombres ni fechas. Identifica pares Pregunta/Respuesta útiles.

Reglas ESTRICTAS:
- Devuelve SOLO JSON: {"pairs":[{"question":"...","answer":"..."}]}
- NO incluyas nombres propios, teléfonos, ni datos personales.
- La "question" debe estar redactada de forma genérica.
- La "answer" en voz oficial del negocio, breve y clara.
- Descarta charla trivial ("hola", "gracias", "ok").
- Descarta pedidos individuales concretos.
- Consolida repetidas en una sola.
- Máximo ${maxPairs} pares en esta respuesta. Prioriza los más frecuentes.
- Sin texto fuera del JSON.`;

  // Prefer direct Google AI Studio (GEMINI_API_KEY) to avoid Lovable AI credits.
  const geminiKey = process.env.GEMINI_API_KEY;
  const useGeminiDirect = Boolean(geminiKey);
  const url = useGeminiDirect
    ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const headers: Record<string, string> = useGeminiDirect
    ? { "Content-Type": "application/json", Authorization: `Bearer ${geminiKey}` }
    : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  const model = useGeminiDirect ? "gemini-2.5-flash" : "google/gemini-2.5-flash";

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: chunk },
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
  const raw = Array.isArray(parsed.pairs) ? parsed.pairs : [];
  return raw
    .map((p) => ({ question: String(p?.question ?? "").trim(), answer: String(p?.answer ?? "").trim() }))
    .filter((p) => p.question && p.answer);
}

/**
 * Estrategia:
 *  1. Intento parser determinista (formato Pregunta/Respuesta explícito). Sin cap.
 *  2. Si detecta <3 pares, asumo que es un chat: quito metadatos, troceo y llamo IA por chunks.
 *  3. Dedupe por pregunta normalizada.
 */
export async function extractFaqs(text: string): Promise<ExtractFaqsResult> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.LOVABLE_API_KEY;
  const warnings: string[] = [];

  // Paso 1: parser determinista
  const deterministic = parseFaqText(text);
  if (deterministic.pairs.length >= 3) {
    const seen = new Set<string>();
    const pairs: ExtractedFaq[] = [];
    for (const p of deterministic.pairs) {
      const key = p.question.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ question: p.question, answer: p.answer });
    }
    if (pairs.length < deterministic.pairs.length) {
      warnings.push(`${deterministic.pairs.length - pairs.length} duplicados exactos consolidados.`);
    }
    return {
      pairs,
      warnings,
      stats: {
        totalDetected: deterministic.totalDetected,
        imported: pairs.length,
        errors: deterministic.errors,
        source: "deterministic",
      },
    };
  }

  // Paso 2: chat de WhatsApp o texto no estructurado → IA por chunks
  if (!apiKey) throw new Error("LOVABLE_API_KEY no configurado");
  const cleaned = stripWhatsAppMetadata(text);
  if (!cleaned || cleaned.length < 20) {
    return {
      pairs: [],
      warnings: ["El archivo no contiene mensajes reconocibles."],
      stats: { totalDetected: 0, imported: 0, errors: [], source: "ai", chunks: 0 },
    };
  }

  const chunks = chunkText(cleaned, 12000);
  const perChunkCap = chunks.length === 1 ? 100 : Math.max(30, Math.floor(200 / chunks.length));
  const collected: ExtractedFaq[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < chunks.length; i++) {
    try {
      const batch = await callGeminiForChunk(apiKey, chunks[i], perChunkCap);
      for (const p of batch) {
        if (p.question.length > 500 || p.answer.length > 2000) continue;
        const key = p.question.toLowerCase().replace(/\s+/g, " ").trim();
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(p);
      }
    } catch (err) {
      warnings.push(`Chunk ${i + 1}/${chunks.length} falló: ${(err as Error).message}`);
    }
  }

  if (collected.length === 0) warnings.unshift("La IA no encontró preguntas frecuentes claras en el chat.");

  return {
    pairs: collected,
    warnings,
    stats: {
      totalDetected: collected.length,
      imported: collected.length,
      errors: [],
      source: "ai",
      chunks: chunks.length,
    },
  };
}

export const extractFaqsFromChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = data as { text?: string; branchId?: string };
    if (!d?.text || typeof d.text !== "string") throw new Error("Texto requerido");
    if (!d?.branchId || typeof d.branchId !== "string") throw new Error("Sede requerida");
    // Cap grande (200 KB) para permitir archivos con 200+ pares
    return { text: d.text.slice(0, 200_000), branchId: d.branchId };
  })
  .handler(async ({ data }): Promise<ExtractFaqsResult> => {
    return extractFaqs(data.text);
  });
