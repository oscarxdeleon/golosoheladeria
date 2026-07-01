import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ParsedMenuItem {
  name: string;
  category: string;
  price: number;
}

export const parseMenuPdfText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = data as { text?: string };
    if (!d?.text || typeof d.text !== "string") throw new Error("Texto requerido");
    const text = d.text.slice(0, 60000); // safety cap
    return { text };
  })
  .handler(async ({ data, context }) => {
    // Verificar rol admin
    const { data: roleRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Solo administradores");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY no configurado");

    const systemPrompt = `Eres un asistente que extrae productos de un menú de restaurante.
Devuelve SOLO JSON válido con la forma: {"items":[{"name":"...","category":"...","price":0}]}.
Reglas:
- name: nombre limpio del producto (sin precios ni descripciones largas).
- category: la sección/categoría a la que pertenece (Bebidas, Postres, Helados, etc.). Si no aparece explícita, deduce una razonable.
- price: número en pesos colombianos sin separadores (ej: 12500). Si aparece "12.500" o "$12,500" devuelve 12500.
- Omite encabezados, direcciones, teléfonos, notas y elementos que no sean productos vendibles.
- No inventes productos que no aparezcan.
- Sin texto adicional fuera del JSON.`;

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
          { role: "user", content: `Extrae los productos del siguiente menú:\n\n${data.text}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`AI Gateway error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const json: unknown = await resp.json();
    const content = (json as { choices?: Array<{ message?: { content?: string } }> })
      ?.choices?.[0]?.message?.content ?? "{}";

    let parsed: { items?: ParsedMenuItem[] } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract JSON blob
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* noop */ }
      }
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const clean: ParsedMenuItem[] = items
      .map((it) => ({
        name: String(it?.name ?? "").trim(),
        category: String(it?.category ?? "").trim() || "General",
        price: Number(it?.price) || 0,
      }))
      .filter((it) => it.name && it.price > 0);

    return { items: clean };
  });
