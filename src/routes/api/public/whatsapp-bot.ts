import { createFileRoute } from "@tanstack/react-router";

// Endpoint público consumido por el bot local (`whatsapp-bot/`) que corre
// en el PC de cada sede. Se autentica con el `device_token` de la sede
// (único e irrevocable desde el panel POS). No usa sesión de usuario ni
// clave service_role: llama a RPCs SECURITY DEFINER en Postgres que
// validan el token internamente.

function isNewKey(k: string) {
  return k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function backend() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("backend_unavailable");
  return { url: url.replace(/\/$/, ""), key };
}

async function callRpc(name: string, params: Record<string, unknown>) {
  const { url, key } = backend();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (!isNewKey(key)) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep as text */ }
  return { ok: res.ok, status: res.status, data };
}

export const Route = createFileRoute("/api/public/whatsapp-bot")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }),
      POST: async ({ request }) => {
        let body: {
          action?: string;
          token?: string;
          status?: string;
          qr?: string;
          phone?: string;
          from?: string;
          message?: string;
          sent?: string[];
          failed?: string[];
          error?: string;
          version?: string;
          pollStatus?: string;
          pollCount?: number;
          // Asistente IA (Fase 1)
          text?: string;
          audio_b64?: string;
          audio_mime?: string;
        } | null = null;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

        const token = String(body.token ?? "").trim();
        if (!token || token.length < 16) return json({ error: "invalid_token" }, 400);

        try {
          switch (body.action) {
            case "config": {
              const r = await callRpc("whatsapp_bot_get_config", { _token: token });
              if (!r.ok) return json({ error: "rpc_failed", detail: r.data }, r.status);
              return json(r.data);
            }
            case "status": {
              const status = String(body.status ?? "").trim();
              if (!status) return json({ error: "missing_status" }, 400);
              const r = await callRpc("whatsapp_bot_report_status", {
                _token: token,
                _status: status,
                _qr: body.qr ?? null,
                _phone: body.phone ?? null,
              });
              if (!r.ok) return json({ error: "rpc_failed", detail: r.data }, r.status);
              return json(r.data);
            }
            case "incoming": {
              const from = String(body.from ?? "").trim();
              const msg = String(body.message ?? "");
              if (!from) return json({ error: "missing_from" }, 400);
              const r = await callRpc("whatsapp_bot_handle_incoming", {
                _token: token,
                _from: from,
                _body: msg,
              });
              if (!r.ok) return json({ error: "rpc_failed", detail: r.data }, r.status);
              return json(r.data);
            }
            case "pending": {
              const r = await callRpc("whatsapp_bot_get_pending", { _token: token });
              if (!r.ok) return json({ error: "rpc_failed", detail: r.data }, r.status);
              return json(r.data);
            }
            case "poll_status": {
              const r = await callRpc("whatsapp_bot_report_outbound_poll", {
                _token: token,
                _version: body.version ?? null,
                _poll_status: body.pollStatus ?? "ok",
                _poll_count: typeof body.pollCount === "number" ? body.pollCount : 0,
                _error: body.error ?? null,
              });
              if (!r.ok) return json({ error: "rpc_failed", detail: r.data }, r.status);
              return json(r.data);
            }
            case "ack": {
              const r = await callRpc("whatsapp_bot_ack_outbound", {
                _token: token,
                _sent: Array.isArray(body.sent) ? body.sent : [],
                _failed: Array.isArray(body.failed) ? body.failed : [],
                _error: body.error ?? null,
              });
              if (!r.ok) return json({ error: "rpc_failed", detail: r.data }, r.status);
              return json(r.data);
            }
            case "command_ack": {
              const cmd = String((body as { command?: string }).command ?? "").trim();
              if (!cmd) return json({ error: "missing_command" }, 400);
              const r = await callRpc("whatsapp_bot_ack_command", { _token: token, _command: cmd });
              if (!r.ok) return json({ error: "rpc_failed", detail: r.data }, r.status);
              return json(r.data);
            }
            case "ai_reply": {
              // Asistente IA (Fase 1 MVP). Recibe texto o audio (base64 del OGG de WhatsApp)
              // y devuelve una respuesta corta lista para enviar por WhatsApp.
              const from = String(body.from ?? "").trim();
              if (!from) return json({ error: "missing_from" }, 400);
              const text = typeof body.text === "string" ? body.text.trim() : "";
              const audioB64 = typeof body.audio_b64 === "string" ? body.audio_b64.trim() : "";
              if (!text && !audioB64) return json({ error: "missing_input" }, 400);

              // 1) Contexto de sede + validación sandbox + rate limit
              const ctxRes = await callRpc("whatsapp_bot_ai_context", { _token: token, _phone: from });
              if (!ctxRes.ok) return json({ error: "rpc_failed", detail: ctxRes.data }, ctxRes.status);
              const ctx = ctxRes.data as Record<string, unknown> | null;
              if (!ctx || (ctx as { error?: string }).error) {
                return json({ error: (ctx as { error?: string })?.error ?? "context_error", reply: null }, 200);
              }
              const branchName = String(ctx.branch_name ?? "Heladería Goloso");
              const menuLink = String(ctx.menu_link ?? "https://golosoheladeria.vercel.app/menu");
              const onlineOpen = Boolean(ctx.online_open);
              const physicalOpen = Boolean(ctx.physical_open);
              const customPrompt = typeof ctx.system_prompt === "string" ? ctx.system_prompt : "";

              // Sabores y productos disponibles en la sede (leídos del POS)
              const flavors = Array.isArray(ctx.flavors) ? ctx.flavors as Array<{ name?: string; extra_price?: number | null }> : [];
              const products = Array.isArray(ctx.products) ? ctx.products as Array<{ name?: string; price?: number; category?: string | null }> : [];

              const fmtCOP = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");

              const flavorsBlock = flavors.length > 0
                ? "SABORES DISPONIBLES HOY EN ESTA SEDE (usa SOLO estos, no inventes otros):\n" +
                  flavors.map((f) => `- ${f.name}${f.extra_price ? ` (+${fmtCOP(Number(f.extra_price))})` : ""}`).join("\n")
                : "SABORES: no hay lista sincronizada; si preguntan, invita a ver el menú en línea.";

              // Agrupar productos por categoría para que el prompt sea legible
              const productsByCat = new Map<string, Array<{ name: string; price: number }>>();
              for (const p of products) {
                if (!p.name || typeof p.price !== "number") continue;
                const cat = (p.category ?? "Otros").toString();
                if (!productsByCat.has(cat)) productsByCat.set(cat, []);
                productsByCat.get(cat)!.push({ name: String(p.name), price: Number(p.price) });
              }
              const productsBlock = productsByCat.size > 0
                ? "PRODUCTOS Y PRECIOS ACTUALES DE ESTA SEDE (usa SOLO estos precios reales):\n" +
                  Array.from(productsByCat.entries())
                    .map(([cat, items]) => `【${cat}】\n` + items.map((i) => `- ${i.name}: ${fmtCOP(i.price)}`).join("\n"))
                    .join("\n")
                : "";

              const defaultPrompt = [
                `Eres el asistente virtual de Heladería Goloso, sede ${branchName}.`,
                "Tono cercano, cálido y juvenil, con emojis de helado 🍦🍨 cuando aporten.",
                "REGLAS DE RESPUESTA:",
                "- Responde SIEMPRE de forma directa y COMPLETA a lo que el cliente pregunta.",
                "- Si preguntan por sabores, productos o precios: usa EXCLUSIVAMENTE la información de esta sede listada más abajo. NO inventes sabores, productos ni precios.",
                "- Si un sabor o producto no aparece listado, di con honestidad que hoy no está disponible en esta sede.",
                "- Si preguntan por promociones, horarios, ubicación, tiempos de entrega o formas de pago: da la información concreta que tengas del contexto.",
                "- NO redirijas al menú a menos que el cliente pida ver el menú completo, pedir en línea, o pregunte algo que no está en tu contexto.",
                "- Usa varias líneas si es necesario. Mejor una respuesta clara de 5 líneas que una vaga de 1.",
                "",
                `Menú y pedidos en línea: ${menuLink}`,
                `Estado ahora: domicilio ${onlineOpen ? "ABIERTO ✅" : "CERRADO ❌"} · tienda física ${physicalOpen ? "ABIERTA ✅" : "CERRADA ❌"}.`,
                "",
                flavorsBlock,
                "",
                productsBlock,
                "",
                "Si el cliente quiere hacer un pedido en línea, envíale el link del menú.",
                "Responde SIEMPRE en español de Colombia.",
              ].filter(Boolean).join("\n");

              // Si hay prompt personalizado por sede, se le concatenan sabores/productos
              // para que la sede pueda personalizar tono pero la IA nunca invente productos.
              const systemPrompt = customPrompt && customPrompt.length > 0
                ? [customPrompt, "", flavorsBlock, "", productsBlock].filter(Boolean).join("\n")
                : defaultPrompt;

              // 2) Construir mensaje del usuario (texto o audio)
              const userContent: Array<Record<string, unknown>> = [];
              if (text) {
                userContent.push({ type: "text", text });
              }
              if (audioB64) {
                const mime = String(body.audio_mime ?? "audio/ogg").toLowerCase();
                let format = "ogg";
                if (mime.includes("mp3") || mime.includes("mpeg")) format = "mp3";
                else if (mime.includes("wav")) format = "wav";
                else if (mime.includes("m4a") || mime.includes("mp4")) format = "m4a";
                else if (mime.includes("webm")) format = "webm";
                if (!text) userContent.push({ type: "text", text: "(El cliente envió una nota de voz, transcríbela mentalmente y responde a lo que pide.)" });
                userContent.push({ type: "input_audio", input_audio: { data: audioB64, format } });
              }

              // 3) Llamar Lovable AI Gateway (Gemini 3.6 Flash acepta audio OGG nativo)
              const apiKey = process.env.LOVABLE_API_KEY;
              if (!apiKey) return json({ error: "ai_not_configured", reply: null }, 200);

              const callAi = async (model: string) => {
                return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    model,
                    messages: [
                      { role: "system", content: systemPrompt },
                      { role: "user", content: userContent },
                    ],
                    max_tokens: 800,
                    temperature: 0.7,
                  }),
                });
              };


              let aiResp = await callAi("google/gemini-3.6-flash");
              // Fallback a Gemini 2.5 Flash si el primero falla (transitorio)
              if (!aiResp.ok && (aiResp.status >= 500 || aiResp.status === 404)) {
                aiResp = await callAi("google/gemini-2.5-flash");
              }
              if (aiResp.status === 429) return json({ error: "ai_rate_limited", reply: null }, 200);
              if (aiResp.status === 402) return json({ error: "ai_credits_exhausted", reply: null }, 200);
              if (!aiResp.ok) {
                const detail = await aiResp.text().catch(() => "");
                return json({ error: "ai_failed", status: aiResp.status, detail: detail.slice(0, 500), reply: null }, 200);
              }

              const aiData = await aiResp.json().catch(() => null) as
                | { choices?: Array<{ message?: { content?: string } }> }
                | null;
              const reply = aiData?.choices?.[0]?.message?.content?.trim() ?? "";
              if (!reply) return json({ error: "ai_empty", reply: null }, 200);

              // 4) Registrar uso (rate limit) y guardar mensaje saliente
              await callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });

              return json({ reply, source: "ai" });
            }
            default:
              return json({ error: "unknown_action" }, 400);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: "server_error", detail: message }, 500);
        }
      },
    },
  },
});
