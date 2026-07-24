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

function makeConversationId(phone: string) {
  const cleanPhone = phone.replace(/\D/g, "");
  const suffix = cleanPhone.slice(-4) || "anon";
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `wa-${Date.now()}-${suffix}-${randomId}`;
}

function elapsedMs(start: number) {
  return Math.max(0, Math.round(performance.now() - start));
}

function trimForLog(value: unknown, max = 800) {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

async function logBotEvent(
  token: string,
  conversationId: string,
  phone: string,
  stage: string,
  data: { ok?: boolean; durationMs?: number; error?: unknown; metadata?: Record<string, unknown> } = {},
) {
  try {
    await callRpc("whatsapp_bot_ai_log_event", {
      _token: token,
      _conversation_id: conversationId,
      _phone: phone,
      _stage: stage,
      _ok: data.ok !== false,
      _duration_ms: typeof data.durationMs === "number" ? data.durationMs : null,
      _error: data.error == null ? null : trimForLog(data.error, 1000),
      _metadata: data.metadata ?? {},
    });
  } catch {
    // Logging must never break a customer conversation.
  }
}

function normalizeHistory(messages: Array<{ role: string; content: string }>) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 1200),
    }));
}

function operationalReply(menuLink: string) {
  return `Con gusto te atiendo. 🍦\n\nPuedes ver el menú actualizado con fotos y precios aquí 👉 ${menuLink}\n\nSi quieres pedir por WhatsApp, dime qué producto te provoca y lo vamos armando paso a paso.`;
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
              const fixedData = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
              const fixedReply = typeof fixedData.reply === "string" ? fixedData.reply.trim() : "";
              if (fixedReply) return json(r.data);

              // Defensa definitiva: versiones antiguas/intermedias del bot local solo
              // leen la respuesta del action "incoming" y no siempre ejecutan el
              // fallback "ai_reply". Si la base de datos indica que este número debe
              // ser atendido por IA, el endpoint genera la respuesta aquí mismo y la
              // devuelve como si fuera una respuesta fija.
              const shouldUseAi = fixedData.use_ai === true && msg.trim().length > 0;
              if (shouldUseAi) {
                const aiFallbackText = operationalReply("https://golosoheladeria.lovable.app/menu");
                try {
                  const aiUrl = new URL("/api/public/whatsapp-bot", request.url);
                  const aiResp = await fetch(aiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "ai_reply",
                      token,
                      from,
                      text: msg,
                    }),
                  });
                  if (aiResp.ok) {
                    const aiData = await aiResp.json().catch(() => null) as Record<string, unknown> | null;
                    const aiReply = typeof aiData?.reply === "string" ? aiData.reply.trim() : "";
                    if (aiReply) {
                      return json({ ...fixedData, ...(aiData ?? {}), reply: aiReply, source: "incoming_ai_fallback" });
                    }
                    return json({ ...fixedData, reply: aiFallbackText, source: "incoming_ai_safety", ai_error: aiData?.error ?? "empty_ai_reply" });
                  }
                  const detail = await aiResp.text().catch(() => "");
                  return json({ ...fixedData, reply: aiFallbackText, source: "incoming_ai_safety", ai_error: `ai_http_${aiResp.status}`, detail: detail.slice(0, 300) });
                } catch (e) {
                  return json({ ...fixedData, reply: aiFallbackText, source: "incoming_ai_safety", ai_error: e instanceof Error ? e.message : String(e) });
                }
              }

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

              const conversationId = makeConversationId(from);
              const requestStarted = performance.now();
              await logBotEvent(token, conversationId, from, "request_received", {
                metadata: { hasText: Boolean(text), hasAudio: Boolean(audioB64), textLength: text.length },
              });

              // 1) Contexto de sede + validación sandbox + rate limit
              const contextStarted = performance.now();
              const ctxRes = await callRpc("whatsapp_bot_ai_context", { _token: token, _phone: from });
              if (!ctxRes.ok) {
                await logBotEvent(token, conversationId, from, "context_rpc_failed", {
                  ok: false,
                  durationMs: elapsedMs(contextStarted),
                  error: ctxRes.data,
                  metadata: { status: ctxRes.status },
                });
                return json({ error: "rpc_failed", detail: ctxRes.data, conversation_id: conversationId }, ctxRes.status);
              }
              const ctx = ctxRes.data as Record<string, unknown> | null;
              if (!ctx || (ctx as { error?: string }).error) {
                const error = (ctx as { error?: string })?.error ?? "context_error";
                await logBotEvent(token, conversationId, from, "context_blocked", {
                  ok: false,
                  durationMs: elapsedMs(contextStarted),
                  error,
                  metadata: { context: ctx ?? null },
                });
                if (error === "rate_limited") {
                  const reply = operationalReply("https://golosoheladeria.lovable.app/menu");
                  return json({ reply, source: "operational", error, conversation_id: conversationId }, 200);
                }
                return json({ error, reply: null, conversation_id: conversationId }, 200);
              }
              await logBotEvent(token, conversationId, from, "context_loaded", {
                durationMs: elapsedMs(contextStarted),
                metadata: {
                  usageToday: ctx.usage_today ?? null,
                  dailyLimit: ctx.daily_limit ?? null,
                  products: Array.isArray(ctx.products) ? ctx.products.length : 0,
                  faqs: Array.isArray(ctx.faqs) ? ctx.faqs.length : 0,
                  flavorGroups: Array.isArray(ctx.flavor_groups) ? ctx.flavor_groups.length : 0,
                },
              });
              const branchName = String(ctx.branch_name ?? "Heladería Goloso");
              const menuLink = String(ctx.menu_link ?? "https://golosoheladeria.lovable.app/menu");
              const onlineOpen = Boolean(ctx.online_open);
              const physicalOpen = Boolean(ctx.physical_open);
              const customPrompt = typeof ctx.system_prompt === "string" ? ctx.system_prompt : "";

              // Sabores AGRUPADOS por grupo de modificador (para no mezclar
              // sabores de helado con sabores de jugo, malteadas, etc.)
              const flavorGroups = Array.isArray(ctx.flavor_groups)
                ? ctx.flavor_groups as Array<{ group_name?: string; flavors?: Array<{ name?: string; extra_price?: number | null }> }>
                : [];
              const products = Array.isArray(ctx.products) ? ctx.products as Array<{ name?: string; price?: number; category?: string | null }> : [];

              const fmtCOP = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");

              const flavorsBlock = flavorGroups.length > 0
                ? "SABORES DISPONIBLES HOY EN ESTA SEDE, AGRUPADOS POR TIPO DE PRODUCTO (usa SOLO los sabores del grupo correcto — NO mezcles sabores de helado con sabores de jugo, malteada u otros):\n" +
                  flavorGroups
                    .filter((g) => Array.isArray(g.flavors) && g.flavors.length > 0)
                    .map((g) => {
                      const items = (g.flavors ?? [])
                        .filter((f) => f && f.name)
                        .map((f) => `  - ${f.name}${f.extra_price ? ` (+${fmtCOP(Number(f.extra_price))})` : ""}`)
                        .join("\n");
                      return `【${g.group_name ?? "Sabores"}】\n${items}`;
                    })
                    .join("\n")
                : "SABORES: no hay lista sincronizada; si preguntan, invita a ver el menú en línea.";

              // Agrupar productos por categoría para que el prompt sea legible
              const productsByCat = new Map<string, Array<{ name: string; price: number }>>();
              for (const p of products) {
                if (!p.name || typeof p.price !== "number") continue;
                const cat = (p.category ?? "Otros").toString();
                if (!productsByCat.has(cat)) productsByCat.set(cat, []);
                const categoryItems = productsByCat.get(cat);
                if (categoryItems) categoryItems.push({ name: String(p.name), price: Number(p.price) });
              }
              const productsBlock = productsByCat.size > 0
                ? "PRODUCTOS Y PRECIOS ACTUALES DE ESTA SEDE, AGRUPADOS POR CATEGORÍA (usa SOLO estos precios reales; respeta la categoría al recomendar):\n" +
                  Array.from(productsByCat.entries())
                    .map(([cat, items]) => `【${cat}】\n` + items.map((i) => `- ${i.name}: ${fmtCOP(i.price)}`).join("\n"))
                    .join("\n")
                : "";

              // FAQs curadas por la sede — Opción 3 (few-shot).
              const faqs = Array.isArray(ctx.faqs) ? ctx.faqs as Array<{ q?: string; a?: string }> : [];
              const faqsBlock = faqs.length > 0
                ? "PREGUNTAS FRECUENTES DE ESTA SEDE (respuestas oficiales — cuando el cliente pregunte algo parecido, usa esta respuesta tal cual, adaptando solo el saludo):\n" +
                  faqs
                    .filter((f) => f.q && f.a)
                    .map((f, i) => `${i + 1}) P: ${String(f.q).trim()}\n   R: ${String(f.a).trim()}`)
                    .join("\n")
                : "";

              const defaultPrompt = [
                `Eres el/la asesor(a) virtual de Heladería Goloso, sede ${branchName}.`,
                "Escribes como una persona real de Cali, Colombia: cercano, cálido, con buena vibra. Puedes usar expresiones locales suaves como 'con gusto', 'listo pues', 'de una', 'qué rico', 'mi amor', 'parce/parcera' (sin abusar). Nunca sonar robótico ni corporativo.",
                "Usa 🍦🍨✨🥤 solo cuando aporten (no en cada frase). Nunca uses inglés innecesario ni tecnicismos.",
                "",
                "ESTILO DE RESPUESTA:",
                "- Frases cortas, WhatsApp-friendly. Usa saltos de línea para separar ideas.",
                "- Cuando pidas varios datos al cliente (dirección, teléfono, etc.), NUNCA los pidas en un párrafo largo. Preséntalos como lista con emojis, por ejemplo:",
                "  📍 Dirección completa",
                "  🏘️ Barrio",
                "  📞 Teléfono de contacto",
                "  💵 ¿Efectivo o transferencia?",
                "- Si el cliente ya te dio parte de la info, no la vuelvas a pedir. Solo lo que falte.",
                "- Al listar productos o precios usa viñetas claras (•) y separa por línea. Nada de párrafos densos.",
                "- Confirma siempre antes de dar por hecho algo (\"¿te confirmo con dos vasos entonces?\").",
                "",
                "PRIORIDAD #1 — MENÚ EN LÍNEA:",
                `- Cuando el cliente salude o pida información general, tu PRIMERA respuesta invita al menú en línea: ${menuLink}`,
                "- Explícalo natural: allí ve todo con fotos, precios reales y pide en un minuto.",
                "- Solo toma el pedido por chat si el cliente dice explícitamente que prefiere por acá.",
                "",
                "REGLAS DE INFORMACIÓN:",
                "- Si la pregunta se parece a una PREGUNTA FRECUENTE listada abajo, usa esa respuesta como base y adáptala al tono de la conversación (no la copies textual como robot).",
                "- Precios, sabores y productos: usa EXCLUSIVAMENTE los listados abajo (vienen en vivo del POS). Nunca inventes.",
                "- Los SABORES vienen agrupados por tipo de producto. Si preguntan sabores de HELADO, responde SOLO con el grupo de helado. Si preguntan de JUGO, SOLO jugos. Nunca mezcles grupos.",
                "- Los PRODUCTOS están agrupados por categoría. Respeta la categoría al recomendar.",
                "- Si un sabor o producto no está listado hoy, dilo con honestidad: 'hoy no lo tenemos en esta sede, pero mira todo lo disponible acá 👉 " + menuLink + "'.",
                "- Para horarios, ubicación, tiempos de entrega o pagos: da info concreta, breve, en líneas separadas.",
                "",
                `Estado ahora: domicilio ${onlineOpen ? "ABIERTO ✅" : "CERRADO ❌"} · tienda física ${physicalOpen ? "ABIERTA ✅" : "CERRADA ❌"}.`,
                "",
                faqsBlock,
                "",
                flavorsBlock,
                "",
                productsBlock,
                "",
                "Responde SIEMPRE en español de Colombia (Cali), tuteando o usando 'usted' según el tono del cliente.",
              ].filter(Boolean).join("\n");

              const customExtras = [
                `Menú en línea de esta sede (compártelo como primera opción): ${menuLink}`,
                "IMPORTANTE: los sabores vienen agrupados por tipo de producto — NO mezcles sabores de helado con sabores de jugo o malteada. Respeta también la categoría del producto al recomendar.",
                "",
                faqsBlock,
                "",
                flavorsBlock,
                "",
                productsBlock,
              ].filter(Boolean).join("\n");

              const systemPrompt = customPrompt && customPrompt.length > 0
                ? [customPrompt, "", customExtras].join("\n")
                : defaultPrompt;

              // 2) Cargar historial reciente (memoria conversacional Fase 2)
              let history: Array<{ role: string; content: string }> = [];
              const historyStarted = performance.now();
              const histRes = await callRpc("whatsapp_bot_ai_history", { _token: token, _phone: from, _limit: 12 });
              if (histRes.ok && histRes.data && typeof histRes.data === "object") {
                const msgs = (histRes.data as { messages?: unknown }).messages;
                if (Array.isArray(msgs)) {
                  history = msgs.filter((m): m is { role: string; content: string } =>
                    !!m && typeof m === "object" && typeof (m as { role?: unknown }).role === "string" && typeof (m as { content?: unknown }).content === "string"
                  );
                }
              }
              history = normalizeHistory(history);
              await logBotEvent(token, conversationId, from, "history_loaded", {
                durationMs: elapsedMs(historyStarted),
                metadata: { messages: history.length, ok: histRes.ok, status: histRes.status },
              });

              // 3) Construir mensaje del turno actual (texto o audio)
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

              // 4) Cargar config de ordering (bot toma pedidos)
              const orderCfgRes = await callRpc("whatsapp_bot_ai_ordering_config", { _token: token });
              const orderCfg = (orderCfgRes.ok ? orderCfgRes.data : null) as {
                ordering_enabled?: boolean; min_amount?: number; delivery_fee?: number;
                zones?: string | null; transfer_info?: string | null; dry_run?: boolean;
              } | null;
              const orderingEnabled = !!(orderCfg?.ordering_enabled);
              const dryRun = !!(orderCfg?.dry_run);

              // Prompt adicional cuando el bot toma pedidos
              const orderingPromptBlock = orderingEnabled ? [
                "",
                "🛒 TOMA DE PEDIDOS (SOLO DOMICILIO):",
                `- Domicilio: ${onlineOpen ? "ABIERTO" : "CERRADO — no aceptes pedidos ahora, invita a volver en horario"}.`,
                `- Monto mínimo del pedido (subtotal antes de domicilio): ${fmtCOP(Number(orderCfg?.min_amount ?? 0))}.`,
                `- Costo de domicilio por defecto: ${fmtCOP(Number(orderCfg?.delivery_fee ?? 0))} (ajústalo si la zona lo requiere).`,
                orderCfg?.zones ? `- Zonas de cobertura: ${orderCfg.zones}` : "",
                orderCfg?.transfer_info ? `- Datos de transferencia (compártelos SOLO si el cliente elige transferir): ${orderCfg.transfer_info}` : "",
                "",
                "PROTOCOLO OBLIGATORIO PARA TOMAR PEDIDOS:",
                "1) Usa search_products para encontrar el producto exacto que pide el cliente (no inventes precios).",
                "2) Si el producto tiene grupos de modificadores (sabores, toppings, etc.), llama get_modifiers y ofrece SOLO las opciones que devuelve.",
                "3) Cuando tengas producto+modificadores+cantidad, llama add_to_cart. Repite hasta armar el pedido completo.",
                "4) Pregunta y guarda con set_delivery_info los datos EN ESTE ORDEN, SIN OMITIR NINGUNO:",
                "   a) NOMBRE del cliente (OBLIGATORIO — SIEMPRE pregunta primero '¿A nombre de quién registro el pedido?' y NO continues con dirección/barrio/pago hasta tenerlo).",
                "   b) Dirección completa.",
                "   c) Barrio.",
                "   d) Método de pago (cash o transfer).",
                "   e) Notas adicionales si aplica.",
                "   ⚠️ NUNCA llames confirm_order si no has capturado el NOMBRE del cliente. Si intentas confirmar sin nombre, el sistema rechazará el pedido.",
                "5) Antes de confirmar, muestra un RESUMEN completo incluyendo NOMBRE del cliente, productos, subtotal, domicilio, total y método de pago; pide confirmación explícita ('¿Confirmas el pedido, [nombre]?').",
                "6) Solo cuando el cliente diga SÍ / CONFIRMO / DALE, llama confirm_order. Devolverá el nº de pedido.",
                "7) Si el cliente cambia de opinión, llama cancel_order.",
                "8) Recuerda: el pedido queda PENDIENTE DE REVISIÓN por el cajero. Dile al cliente: 'Tu pedido quedó registrado con el nº X y será confirmado en unos minutos por nuestro equipo.'",
                dryRun ? "⚠️ MODO PRUEBA ACTIVO: al llamar confirm_order NO se registra pedido real; devuelve un nº simulado. Igual muestra el resumen normal al cliente; internamente sabrás que fue simulado por la respuesta del tool." : "",
                "",
              ].filter(Boolean).join("\n") : "";

              const finalSystemPrompt = systemPrompt + orderingPromptBlock;

              // Herramientas expuestas a la IA (function calling)
              const orderingTools = orderingEnabled ? [
                { type: "function", function: { name: "search_products", description: "Busca productos activos de la sede por nombre. Devuelve id, name, price, modifier_group_ids.", parameters: { type: "object", properties: { query: { type: "string", description: "Palabra clave del producto que busca el cliente." } }, required: ["query"] } } },
                { type: "function", function: { name: "get_modifiers", description: "Obtiene los grupos de modificadores (sabores, toppings) disponibles para un producto.", parameters: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] } } },
                { type: "function", function: { name: "add_to_cart", description: "Agrega un item al carrito del cliente. Los modificadores deben venir con id, name y price obtenidos de get_modifiers.", parameters: { type: "object", properties: { product_id: { type: "string" }, product_name: { type: "string" }, unit_price: { type: "number" }, qty: { type: "number" }, modifiers: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, price: { type: "number" } } } }, notes: { type: "string" } }, required: ["product_name", "unit_price", "qty"] } } },
                { type: "function", function: { name: "set_delivery_info", description: "Guarda los datos de entrega y pago en el carrito.", parameters: { type: "object", properties: { customer_name: { type: "string" }, delivery_address: { type: "string" }, delivery_neighborhood: { type: "string" }, delivery_notes: { type: "string" }, payment_method: { type: "string", description: "'cash' o 'transfer'" }, delivery_fee: { type: "number" } } } } },
                { type: "function", function: { name: "show_cart", description: "Muestra el contenido actual del carrito (útil antes de confirmar).", parameters: { type: "object", properties: {} } } },
                { type: "function", function: { name: "confirm_order", description: "Confirma el pedido y lo envía al POS. Solo llámalo cuando el cliente lo confirme explícitamente.", parameters: { type: "object", properties: {} } } },
                { type: "function", function: { name: "cancel_order", description: "Cancela el carrito en construcción.", parameters: { type: "object", properties: {} } } },
              ] : [];

              // Ejecutor de tools server-side
              const execTool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
                try {
                  switch (name) {
                    case "search_products": {
                      const r = await callRpc("whatsapp_bot_ai_search_products", { _token: token, _query: String(args.query ?? "") });
                      return r.ok ? r.data : { error: "search_failed" };
                    }
                    case "get_modifiers": {
                      const r = await callRpc("whatsapp_bot_ai_get_modifiers", { _token: token, _product_id: String(args.product_id ?? "") });
                      return r.ok ? r.data : { error: "get_modifiers_failed" };
                    }
                    case "add_to_cart": {
                      // Leer carrito actual, agregar item, upsert
                      const cartRes = await callRpc("whatsapp_bot_ai_cart_get", { _token: token, _phone: from });
                      const cart = (cartRes.ok ? cartRes.data : null) as { items?: unknown[] } | null;
                      const items = Array.isArray(cart?.items) ? [...cart!.items] : [];
                      items.push({
                        product_id: args.product_id ?? null,
                        product_name: args.product_name,
                        unit_price: Number(args.unit_price ?? 0),
                        qty: Number(args.qty ?? 1),
                        modifiers: Array.isArray(args.modifiers) ? args.modifiers : [],
                        notes: args.notes ?? null,
                      });
                      const r = await callRpc("whatsapp_bot_ai_cart_upsert", { _token: token, _phone: from, _patch: { items } });
                      return r.ok ? { ok: true, cart: r.data } : { error: "add_failed", detail: r.data };
                    }
                    case "set_delivery_info": {
                      const patch: Record<string, unknown> = {};
                      for (const k of ["customer_name", "delivery_address", "delivery_neighborhood", "delivery_notes", "payment_method"]) {
                        if (typeof args[k] === "string" && (args[k] as string).length > 0) patch[k] = args[k];
                      }
                      if (typeof args.delivery_fee === "number") patch.delivery_fee = args.delivery_fee;
                      else if (orderCfg?.delivery_fee) patch.delivery_fee = Number(orderCfg.delivery_fee);
                      const r = await callRpc("whatsapp_bot_ai_cart_upsert", { _token: token, _phone: from, _patch: patch });
                      return r.ok ? { ok: true, cart: r.data } : { error: "delivery_info_failed", detail: r.data };
                    }
                    case "show_cart": {
                      const r = await callRpc("whatsapp_bot_ai_cart_get", { _token: token, _phone: from });
                      return r.ok ? (r.data ?? { empty: true }) : { error: "cart_read_failed" };
                    }
                    case "confirm_order": {
                      // Guardia dura: exigir customer_name antes de cerrar el pedido
                      const preCart = await callRpc("whatsapp_bot_ai_cart_get", { _token: token, _phone: from });
                      const preData = (preCart.ok ? preCart.data : null) as { customer_name?: string | null } | null;
                      const nameOk = typeof preData?.customer_name === "string" && preData.customer_name.trim().length >= 2;
                      if (!nameOk) {
                        return { error: "missing_customer_name", message: "Falta el NOMBRE del cliente. Pregúntalo primero con set_delivery_info (customer_name) y luego vuelve a confirmar." };
                      }
                      if (dryRun) {
                        await callRpc("whatsapp_bot_ai_cart_cancel", { _token: token, _phone: from });
                        const fakeNumber = "TEST-" + Math.floor(1000 + Math.random() * 9000);
                        return { ok: true, dry_run: true, order: { order_number: fakeNumber, simulated: true } };
                      }
                      const r = await callRpc("whatsapp_bot_ai_cart_confirm", { _token: token, _phone: from });
                      if (r.ok) return { ok: true, order: r.data };
                      const detail = (r.data as { message?: string } | string) ?? "";
                      const msg = typeof detail === "string" ? detail : (detail?.message ?? JSON.stringify(detail));
                      return { error: "confirm_failed", message: msg };
                    }
                    case "cancel_order": {
                      await callRpc("whatsapp_bot_ai_cart_cancel", { _token: token, _phone: from });
                      return { ok: true };
                    }
                    default:
                      return { error: "unknown_tool", name };
                  }
                } catch (e) {
                  return { error: "tool_exception", message: e instanceof Error ? e.message : String(e) };
                }
              };

              // 5) Llamar a la IA: preferir Gemini directo (gratis, sin créditos Lovable) si GEMINI_API_KEY existe.
              const geminiKey = process.env.GEMINI_API_KEY;
              const apiKey = process.env.LOVABLE_API_KEY;
              if (!geminiKey && !apiKey) return json({ error: "ai_not_configured", reply: null }, 200);

              type ChatMsg = { role: string; content?: unknown; tool_call_id?: string; name?: string; tool_calls?: unknown[] };
              const messages: ChatMsg[] = [
                { role: "system", content: finalSystemPrompt },
                ...history.map((m) => ({ role: m.role, content: m.content })),
                { role: "user", content: userContent },
              ];

              // Mapea el nombre "vendor/modelo" al formato que espera cada backend.
              const mapModel = (m: string) => {
                if (geminiKey) return m.replace(/^google\//, "");
                return m;
              };
              const aiUrlBase = geminiKey
                ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
                : "https://ai.gateway.lovable.dev/v1/chat/completions";
              const aiAuthHeader = geminiKey ? `Bearer ${geminiKey}` : `Bearer ${apiKey}`;

              const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
              const callAiOnce = async (model: string) => {
                const bodyReq: Record<string, unknown> = {
                  model: mapModel(model), messages, max_tokens: 2048, temperature: 0.6,
                };
                if (orderingTools.length > 0) {
                  bodyReq.tools = orderingTools;
                  bodyReq.tool_choice = "auto";
                }
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 35_000);
                try {
                  return await fetch(aiUrlBase, {
                    method: "POST",
                    headers: { Authorization: aiAuthHeader, "Content-Type": "application/json" },
                    body: JSON.stringify(bodyReq),
                    signal: controller.signal,
                  });
                } finally {
                  clearTimeout(timer);
                }
              };

              const callAi = async (model: string) => {
                let lastResponse: Response | null = null;
                let lastError: unknown;
                for (let attempt = 0; attempt < 3; attempt += 1) {
                  try {
                    const response = await callAiOnce(model);
                    lastResponse = response;
                    if (response.ok || (response.status !== 429 && response.status < 500)) return response;
                    await pause(500 * (attempt + 1));
                  } catch (error) {
                    lastError = error;
                    await pause(500 * (attempt + 1));
                  }
                }
                if (lastResponse) return lastResponse;
                throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "ai_fetch_failed"));
              };


              // Loop de tool-calling (máx 6 rondas). Detecta truncados por longitud
              // y pide continuación para no cortar la respuesta al cliente.
              let finalReply = "";
              let lastErr: string | null = null;
              let lastFinishReason: string | null = null;
              for (let round = 0; round < 6; round++) {
                const aiStarted = performance.now();
                let aiResp: Response;
                try {
                  aiResp = await callAi("google/gemini-3.6-flash");
                } catch (error) {
                  await logBotEvent(token, conversationId, from, "ai_request_exception", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error,
                    metadata: { round, model: "google/gemini-3.6-flash" },
                  });
                  try {
                    aiResp = await callAi("google/gemini-3.5-flash");
                  } catch (fallbackError) {
                    lastErr = trimForLog(fallbackError, 500);
                    await logBotEvent(token, conversationId, from, "ai_fallback_exception", {
                      ok: false,
                      durationMs: elapsedMs(aiStarted),
                      error: fallbackError,
                    metadata: { round, model: "google/gemini-3.5-flash" },
                    });
                    break;
                  }
                }
                if (!aiResp.ok && (aiResp.status >= 500 || aiResp.status === 404 || aiResp.status === 429)) {
                  await logBotEvent(token, conversationId, from, "ai_primary_failed", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: `HTTP ${aiResp.status}`,
                    metadata: { round, model: "google/gemini-3.6-flash" },
                  });
                  aiResp = await callAi("google/gemini-3.5-flash");
                }
                if (aiResp.status === 429) {
                  lastErr = "ai_rate_limited_after_retries";
                  await logBotEvent(token, conversationId, from, "ai_rate_limited", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: lastErr,
                    metadata: { round },
                  });
                  break;
                }
                if (aiResp.status === 402) {
                  lastErr = "ai_credits_exhausted";
                  await logBotEvent(token, conversationId, from, "ai_credits_exhausted", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: lastErr,
                    metadata: { round },
                  });
                  break;
                }
                if (!aiResp.ok) {
                  const detail = await aiResp.text().catch(() => "");
                  lastErr = detail.slice(0, 500);
                  await logBotEvent(token, conversationId, from, "ai_http_failed", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: lastErr,
                    metadata: { round, status: aiResp.status },
                  });
                  break;
                }
                const aiData = await aiResp.json().catch(() => null) as {
                  choices?: Array<{ finish_reason?: string; message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
                } | null;
                const choice = aiData?.choices?.[0];
                const msg = choice?.message;
                lastFinishReason = choice?.finish_reason ?? null;
                await logBotEvent(token, conversationId, from, "ai_round_completed", {
                  durationMs: elapsedMs(aiStarted),
                  metadata: { round, finishReason: lastFinishReason, hasMessage: Boolean(msg) },
                });
                if (!msg) { lastErr = "empty_response"; break; }

                const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
                if (toolCalls.length === 0) {
                  const chunk = (msg.content ?? "").trim();
                  finalReply = finalReply ? `${finalReply}${chunk ? " " + chunk : ""}` : chunk;
                  // Si el modelo cortó por longitud, pedir continuación una vez más
                  if (chunk && lastFinishReason === "length" && round < 5) {
                    messages.push({ role: "assistant", content: chunk });
                    messages.push({ role: "user", content: "Continúa exactamente desde donde cortaste, sin repetir lo ya dicho, y termina la respuesta." });
                    continue;
                  }
                  break;
                }
                messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
                for (const tc of toolCalls) {
                  let parsedArgs: Record<string, unknown> = {};
                  try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep empty */ }
                  const toolStarted = performance.now();
                  const result = await execTool(tc.function.name, parsedArgs);
                  const toolResult = result && typeof result === "object" ? result as Record<string, unknown> : {};
                  await logBotEvent(token, conversationId, from, `tool_${tc.function.name}`, {
                    ok: !("error" in toolResult),
                    durationMs: elapsedMs(toolStarted),
                    error: toolResult.error,
                    metadata: { round },
                  });
                  messages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    name: tc.function.name,
                    content: JSON.stringify(result).slice(0, 4000),
                  });
                }
              }

              // Reintento defensivo: si quedó vacío, pedir respuesta directa breve sin tools.
              if (!finalReply) {
                try {
                  const retry = await fetch(aiUrlBase, {
                    method: "POST",
                    headers: { Authorization: aiAuthHeader, "Content-Type": "application/json" },
                    body: JSON.stringify({
                      model: mapModel("google/gemini-3.5-flash"),
                      messages: [
                        { role: "system", content: finalSystemPrompt },
                        ...history.map((m) => ({ role: m.role, content: m.content })),
                        { role: "user", content: userContent },
                      ],
                      max_tokens: 1024,
                      temperature: 0.5,
                    }),
                  });
                  if (retry.ok) {
                    const rd = await retry.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
                    finalReply = (rd?.choices?.[0]?.message?.content ?? "").trim();
                  }
                } catch { /* noop */ }
              }


              // Fallback operativo: nunca enviar al cliente el mensaje de error técnico.
              if (!finalReply) {
                finalReply = operationalReply(menuLink);
                lastErr = lastErr ?? `fallback_used(finish=${lastFinishReason ?? "?"})`;
                await logBotEvent(token, conversationId, from, "operational_fallback_used", {
                  ok: false,
                  error: lastErr,
                  metadata: { finishReason: lastFinishReason },
                });
              }

              // 6) Persistir turno del usuario + respuesta del bot en memoria
              const userLog = text && text.length > 0 ? text : "[nota de voz]";
              const persistStarted = performance.now();
              const userSave = await callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "user", _content: userLog });
              const assistantSave = await callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "assistant", _content: finalReply });
              await logBotEvent(token, conversationId, from, "memory_persisted", {
                ok: userSave.ok && assistantSave.ok,
                durationMs: elapsedMs(persistStarted),
                error: !userSave.ok ? userSave.data : !assistantSave.ok ? assistantSave.data : null,
                metadata: { userStatus: userSave.status, assistantStatus: assistantSave.status },
              });

              // 7) Registrar uso para rate limit diario
              const usageStarted = performance.now();
              const usageResult = await callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });
              await logBotEvent(token, conversationId, from, "usage_recorded", {
                ok: usageResult.ok,
                durationMs: elapsedMs(usageStarted),
                error: usageResult.ok ? null : usageResult.data,
                metadata: { status: usageResult.status },
              });

              await logBotEvent(token, conversationId, from, "request_completed", {
                ok: !lastErr,
                durationMs: elapsedMs(requestStarted),
                error: lastErr,
                metadata: { finishReason: lastFinishReason, replyLength: finalReply.length },
              });

              return json({ reply: finalReply, source: lastErr ? "ai_operational" : "ai", finish_reason: lastFinishReason, warning: lastErr, conversation_id: conversationId });
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
