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
                        .map((f) => `  - ${f!.name}${f!.extra_price ? ` (+${fmtCOP(Number(f!.extra_price))})` : ""}`)
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
                productsByCat.get(cat)!.push({ name: String(p.name), price: Number(p.price) });
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
              const histRes = await callRpc("whatsapp_bot_ai_history", { _token: token, _phone: from, _limit: 12 });
              if (histRes.ok && histRes.data && typeof histRes.data === "object") {
                const msgs = (histRes.data as { messages?: unknown }).messages;
                if (Array.isArray(msgs)) {
                  history = msgs.filter((m): m is { role: string; content: string } =>
                    !!m && typeof m === "object" && typeof (m as { role?: unknown }).role === "string" && typeof (m as { content?: unknown }).content === "string"
                  );
                }
              }

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
                "4) Pregunta y guarda con set_delivery_info: nombre, dirección completa, barrio, método de pago (cash o transfer), notas si aplica.",
                "5) Antes de confirmar, muestra un RESUMEN completo con productos, subtotal, domicilio, total, y método de pago, y pide confirmación explícita ('¿confirmas el pedido?').",
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
                      if (dryRun) {
                        // Modo prueba: no insertar en sales. Cancelar carrito para dejarlo limpio.
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

              // 5) Llamar Lovable AI Gateway con system + historial + turno actual + tools
              const apiKey = process.env.LOVABLE_API_KEY;
              if (!apiKey) return json({ error: "ai_not_configured", reply: null }, 200);

              type ChatMsg = { role: string; content?: unknown; tool_call_id?: string; name?: string; tool_calls?: unknown[] };
              const messages: ChatMsg[] = [
                { role: "system", content: finalSystemPrompt },
                ...history.map((m) => ({ role: m.role, content: m.content })),
                { role: "user", content: userContent },
              ];

              const callAi = async (model: string) => {
                const bodyReq: Record<string, unknown> = {
                  model, messages, max_tokens: 800, temperature: 0.7,
                };
                if (orderingTools.length > 0) {
                  bodyReq.tools = orderingTools;
                  bodyReq.tool_choice = "auto";
                }
                return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify(bodyReq),
                });
              };

              // Loop de tool-calling (máx 6 rondas)
              let finalReply = "";
              let lastErr: string | null = null;
              for (let round = 0; round < 6; round++) {
                let aiResp = await callAi("google/gemini-3.6-flash");
                if (!aiResp.ok && (aiResp.status >= 500 || aiResp.status === 404)) {
                  aiResp = await callAi("google/gemini-2.5-flash");
                }
                if (aiResp.status === 429) return json({ error: "ai_rate_limited", reply: null }, 200);
                if (aiResp.status === 402) return json({ error: "ai_credits_exhausted", reply: null }, 200);
                if (!aiResp.ok) {
                  const detail = await aiResp.text().catch(() => "");
                  lastErr = detail.slice(0, 500);
                  return json({ error: "ai_failed", status: aiResp.status, detail: lastErr, reply: null }, 200);
                }
                const aiData = await aiResp.json().catch(() => null) as {
                  choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
                } | null;
                const msg = aiData?.choices?.[0]?.message;
                if (!msg) { lastErr = "empty_response"; break; }

                const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
                if (toolCalls.length === 0) {
                  finalReply = (msg.content ?? "").trim();
                  break;
                }
                // Encolar assistant con tool_calls
                messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
                // Ejecutar cada tool y encolar el resultado
                for (const tc of toolCalls) {
                  let parsedArgs: Record<string, unknown> = {};
                  try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep empty */ }
                  const result = await execTool(tc.function.name, parsedArgs);
                  messages.push({
                    role: "tool",
                    tool_call_id: tc.id,
                    name: tc.function.name,
                    content: JSON.stringify(result).slice(0, 4000),
                  });
                }
              }

              if (!finalReply) {
                return json({ error: "ai_empty", detail: lastErr, reply: null }, 200);
              }

              // 6) Persistir turno del usuario + respuesta del bot en memoria
              const userLog = text && text.length > 0 ? text : "[nota de voz]";
              await callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "user", _content: userLog });
              await callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "assistant", _content: finalReply });

              // 7) Registrar uso para rate limit diario
              await callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });

              return json({ reply: finalReply, source: "ai" });
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
