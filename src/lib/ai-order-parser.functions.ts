import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { trackGeminiCall } from "@/lib/gemini-quota.server";

export interface ParsedOrderItem {
  product_id: string;
  name: string;
  qty: number;
  notes?: string;
}

export interface ParsedOrder {
  target: { type: "mesa" | "llevar" | "domicilio" | "desconocido"; tableNumber?: number };
  items: ParsedOrderItem[];
  warnings: string[];
}

export const parseOrderWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = data as { text?: string; branchId?: string };
    if (!d?.text || typeof d.text !== "string") throw new Error("Texto requerido");
    if (!d?.branchId || typeof d.branchId !== "string") throw new Error("Sede requerida");
    return { text: d.text.slice(0, 2000), branchId: d.branchId };
  })
  .handler(async ({ data, context }): Promise<ParsedOrder> => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (!geminiKey && !lovableKey) throw new Error("Falta GEMINI_API_KEY o LOVABLE_API_KEY");

    // Cargar catálogo activo de la sede
    const [{ data: products }, { data: mesas }] = await Promise.all([
      context.supabase
        .from("products")
        .select("id,name,available_branch_ids,active")
        .eq("active", true),
      context.supabase
        .from("restaurant_tables")
        .select("number")
        .eq("active", true)
        .eq("branch_id", data.branchId),
    ]);

    const catalog = (products ?? [])
      .filter((p) => {
        const arr = p.available_branch_ids as string[] | null;
        return !arr || arr.length === 0 || arr.includes(data.branchId);
      })
      .map((p) => ({ id: p.id as string, name: p.name as string }));

    const mesaNumbers = (mesas ?? []).map((m) => Number(m.number)).filter(Number.isFinite);

    const systemPrompt = `Eres el asistente de comandas de una heladería. Interpreta la instrucción en español (lenguaje natural, puede tener errores) y devuelve SOLO JSON con esta forma:
{"target":{"type":"mesa|llevar|domicilio|desconocido","tableNumber":number?},"items":[{"product_id":"<id>","qty":number,"notes":"observaciones opcionales"}],"warnings":["..."]}

Reglas:
- Elige SIEMPRE product_id EXACTO desde el catálogo. Si el nombre no coincide claramente con ninguno, NO lo inventes: agrégalo en warnings ("No encontré: X").
- qty entero >= 1.
- notes: junta modificadores/observaciones (sin azúcar, sin crema, extra chocolate, tamaño grande/mediano, sabor específico, "para la persona 2", etc.).
- target.type:
  * "mesa" si menciona una mesa (número) y ese número existe en la lista de mesas activas.
  * "llevar" si dice "para llevar".
  * "domicilio" si dice "domicilio" o "envío".
  * "desconocido" en cualquier otro caso.
- Si la mesa mencionada NO existe, usa "desconocido" y agrega warning.
- Sin texto fuera del JSON.

Catálogo (id | nombre):
${catalog.map((p) => `${p.id} | ${p.name}`).join("\n")}

Mesas activas: ${mesaNumbers.join(", ") || "(ninguna)"}`;

    let content = "{}";
    if (geminiKey) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: data.text }] }],
            generationConfig: { responseMimeType: "application/json" },
          }),
        },
      );
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        if (resp.status === 429) throw new Error("Servicio de IA saturado, intenta de nuevo en unos segundos");
        throw new Error(`Gemini error ${resp.status}: ${errText.slice(0, 200)}`);
      }
      const json = (await resp.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      content = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      void trackGeminiCall("ai_order_parser");
    } else {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: data.text },
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
      content = json?.choices?.[0]?.message?.content ?? "{}";
    }
    let parsed: Partial<ParsedOrder> = {};
    try { parsed = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
    }

    const catalogIds = new Set(catalog.map((c) => c.id));
    const nameById = new Map(catalog.map((c) => [c.id, c.name]));
    const warnings: string[] = Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [];
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items: ParsedOrderItem[] = [];
    for (const it of rawItems) {
      const pid = String((it as ParsedOrderItem)?.product_id ?? "");
      if (!catalogIds.has(pid)) {
        warnings.push(`Producto no reconocido: ${pid}`);
        continue;
      }
      const qty = Math.max(1, Math.floor(Number((it as ParsedOrderItem)?.qty ?? 1)) || 1);
      const notes = ((it as ParsedOrderItem)?.notes ?? "").toString().trim() || undefined;
      items.push({ product_id: pid, name: nameById.get(pid) ?? "", qty, notes });
    }

    const t = (parsed.target?.type ?? "desconocido") as ParsedOrder["target"]["type"];
    const tableNumber = parsed.target?.tableNumber != null ? Number(parsed.target.tableNumber) : undefined;
    const target: ParsedOrder["target"] = {
      type: ["mesa", "llevar", "domicilio", "desconocido"].includes(t) ? t : "desconocido",
      tableNumber: Number.isFinite(tableNumber) ? tableNumber : undefined,
    };

    return { target, items, warnings };
  });
