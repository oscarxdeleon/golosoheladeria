import { createFileRoute } from "@tanstack/react-router";
import { trackGeminiCall } from "@/lib/gemini-quota.server";

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

function textTokens(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

function relevanceScore(value: string, words: string[]) {
  const normalized = ` ${textTokens(value).join(" ")} `;
  return words.reduce((score, word) => score + (normalized.includes(` ${word} `) ? 2 : normalized.includes(word) ? 1 : 0), 0);
}

function selectRelevantFaqs<T extends { q?: string; a?: string }>(faqs: T[], input: string, limit = 35) {
  const words = textTokens(input).slice(0, 16);
  return faqs
    .map((faq, index) => ({ faq, index, score: relevanceScore(`${faq.q ?? ""} ${faq.a ?? ""}`, words) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((item) => item.faq);
}

function selectRelevantProducts<T extends { name?: string; category?: string | null; is_favorite?: boolean }>(products: T[], input: string, limit = 60) {
  const words = textTokens(input).slice(0, 16);
  return products
    .map((product, index) => ({
      product,
      index,
      score: relevanceScore(`${product.name ?? ""} ${product.category ?? ""}`, words) + (product.is_favorite ? 1 : 0),
    }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((item) => item.product);
}

function operationalReply(menuLink: string, takingOrders = false) {
  if (takingOrders) {
    return `¡Perfecto! Soy Golosito y te tomo el pedido por aquí. 🍦\n\nPara avanzarlo, dime en un solo mensaje:\n• Producto y sabor\n• Cantidad\n• Nombre\n• Dirección y barrio\n• Pago: efectivo o transferencia\n\nSi quieres mirar fotos y precios, también está el menú aquí 👉 ${menuLink}`;
  }
  return `¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦\n\nPuedes ver el menú actualizado con fotos y precios aquí 👉 ${menuLink}\n\nSi quieres pedir por WhatsApp, dime qué producto te provoca y lo vamos armando paso a paso.`;
}

const PUBLIC_MENU_BASE = "https://golosoheladeria.vercel.app";
const DEFAULT_MENU_LINK = `${PUBLIC_MENU_BASE}/menu`;

function normalizeMenuLink(value: unknown, fallback = DEFAULT_MENU_LINK) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return raw
    .replace(/https:\/\/golosoheladeria\.lovable\.app/gi, PUBLIC_MENU_BASE)
    .replace(/https:\/\/id-preview--[a-z0-9-]+\.lovable\.app/gi, PUBLIC_MENU_BASE);
}

function fallbackOrderReply(input: string, menuLink: string, takingOrders: boolean, hasHistory = false) {
  if (!takingOrders) return operationalReply(menuLink, false);
  // IMPORTANTE: NO afirmamos que un producto "quedó anotado" solo por detectar
  // una palabra clave. El pedido solo existe cuando la IA lo agrega vía tools
  // con modificadores y el cliente confirma explícitamente.
  if (hasHistory) {
    return `Sigo contigo. 🍦\n\nPara armar tu pedido, cuéntame:\n• Qué producto quieres y cuántos\n• Sabor o presentación (si aplica)\n• Nombre\n• Dirección y barrio, o si prefieres recoger\n• Pago: efectivo o transferencia\n\nMenú con fotos y precios 👉 ${menuLink}`;
  }
  return operationalReply(menuLink, true);
}

type ProductLite = {
  id?: string;
  name?: string;
  price?: number;
  category?: string | null;
  is_favorite?: boolean;
  modifier_group_ids?: unknown;
};

type OrderConfigLite = {
  ordering_enabled?: boolean;
  min_amount?: number;
  delivery_fee?: number;
  zones?: string | null;
  transfer_info?: string | null;
  dry_run?: boolean;
} | null;

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s#.,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQuantity(input: string) {
  const normalized = normalizeText(input);
  const words: Record<string, number> = {
    un: 1, una: 1, uno: 1,
    dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  };
  for (const [word, qty] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return qty;
  }
  const digit = normalized.match(/(?:^|\s)(\d{1,2})(?:\s+(?:x|de|unidad|unidades|vaso|vasos|copa|copas|cono|conos|helado|helados|malteada|malteadas|jugo|jugos|banana|ensalada|brownie)\b)/)?.[1];
  if (digit) return Math.max(1, Math.min(20, Number(digit)));
  return 1;
}

function detectOrderType(input: string) {
  const normalized = normalizeText(input);
  if (/\b(recoger|recojo|paso por|pasaria|pasaría|para llevar|retiro|heladeria|heladeria)\b/.test(normalized)) return "pickup";
  if (/\b(domicilio|direccion|dirección|enviar|envio|envío|mandar|llevar|barrio)\b/.test(normalized)) return "delivery";
  return null;
}

function detectPayment(input: string) {
  const normalized = normalizeText(input);
  if (/\b(efectivo|cash)\b/.test(normalized)) return "cash";
  if (/\b(transferencia|transferir|nequi|bancolombia|daviplata|qr)\b/.test(normalized)) return "transfer";
  return null;
}

function extractField(input: string, labels: string[]) {
  const lines = input.split(/[\n;]+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const normalizedLine = normalizeText(line);
    for (const label of labels) {
      const normalizedLabel = normalizeText(label);
      if (normalizedLine.startsWith(normalizedLabel)) {
        return line.replace(new RegExp(`^\\s*${label}\\s*[:#-]?\\s*`, "i"), "").trim();
      }
    }
  }
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = input.match(new RegExp(`(?:${escaped})\\s*[:#-]?\\s*([^\n;,.]+(?:[#\wÁÉÍÓÚáéíóúÑñ\s-]*))`, "i"));
  return match?.[1]?.trim() ?? null;
}

function extractCustomerName(input: string) {
  const explicit = extractField(input, ["nombre", "a nombre de", "mi nombre es", "me llamo", "soy"]);
  if (!explicit) return null;
  return explicit.replace(/\b(direccion|dirección|barrio|pago|efectivo|transferencia).*$/i, "").trim();
}

function extractAddress(input: string) {
  return extractField(input, ["direccion", "dirección", "dir", "address"]);
}

function extractNeighborhood(input: string) {
  return extractField(input, ["barrio", "sector"]);
}

function isConfirmation(input: string) {
  return /\b(si|sí|confirmo|confirmar|dale|listo|correcto|esta bien|está bien|ok|perfecto|hagale|hágale)\b/i.test(input);
}

function productScore(product: ProductLite, input: string) {
  const haystack = normalizeText(`${product.name ?? ""} ${product.category ?? ""}`);
  const query = normalizeText(input);
  if (!product.name || !query) return 0;
  if (query.includes(haystack) || haystack.includes(query)) return 100;
  const words = textTokens(String(product.name)).filter((word) => word.length >= 3);
  return words.reduce((score, word) => score + (query.includes(word) ? 12 : 0), 0) + (product.is_favorite ? 2 : 0);
}

function findRequestedProduct(products: ProductLite[], input: string) {
  return products
    .map((product) => ({ product, score: productScore(product, input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name ?? "").localeCompare(String(b.product.name ?? "")))[0]?.product ?? null;
}

function summarizeCart(cart: Record<string, unknown> | null, fmtCOP: (n: number) => string) {
  const items = Array.isArray(cart?.items) ? cart.items as Array<Record<string, unknown>> : [];
  const lines = items.map((item) => {
    const qty = Number(item.qty ?? 1);
    const name = String(item.product_name ?? item.name ?? "Producto");
    const unit = Number(item.unit_price ?? 0);
    return `• ${qty} x ${name} — ${fmtCOP(qty * unit)}`;
  });
  const subtotal = Number(cart?.subtotal ?? 0);
  const fee = Number(cart?.delivery_fee ?? 0);
  const total = Number(cart?.total ?? subtotal + fee);
  return [
    ...lines,
    `Subtotal: ${fmtCOP(subtotal)}`,
    fee > 0 ? `Domicilio: ${fmtCOP(fee)}` : null,
    `Total: ${fmtCOP(total)}`,
  ].filter(Boolean).join("\n");
}

const AI_TOTAL_BUDGET_MS = 28_000;
const AI_CALL_TIMEOUT_MS = 14_000;
const AI_MAX_TOOL_ROUNDS = 3;

function hasAiBudget(startedAt: number, reserveMs = 2_500) {
  return elapsedMs(startedAt) < AI_TOTAL_BUDGET_MS - reserveMs;
}

/**
 * Cortocircuito de ahorro de créditos. Detecta mensajes triviales
 * (agradecimientos, "ok", emojis, saludos cortos, pedidos de menú)
 * y devuelve una respuesta determinista SIN llamar al modelo de IA.
 * Cada llamada evitada ahorra ~13.000 tokens de entrada.
 */
function shortCircuitReply(input: string, menuLink: string): { reply: string; event: string | null } | null {
  const raw = input.trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:()"']/g, "")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  // Solo evaluamos mensajes cortos para no atrapar preguntas reales.
  if (words.length > 4) return null;

  // Solo emojis / stickers / signos → no responder (0 créditos, evita ruido).
  const onlyEmojis = /^[\p{Emoji}\p{Extended_Pictographic}\s❤️👍👌🙏✨🍦🍨🥤]+$/u.test(raw);
  if (onlyEmojis) return { reply: "", event: null };

  // Agradecimientos → respuesta breve + sticker de gracias.
  if (/\b(gracias|thanks|thank|agradezco|muy amable|mil gracias|dios te pague)\b/.test(normalized)) {
    return { reply: "¡Con mucho gusto! 🍦 Estamos para servirte cuando quieras.", event: "thanks" };
  }

  // Confirmaciones triviales → no ameritan respuesta (o breve).
  if (/^(ok|okay|listo|dale|vale|bueno|si|sii|siii|no|nop|va|bien|perfecto|entendido|👍|👌|🙏)$/.test(normalized)) {
    return { reply: "", event: null };
  }

  // Pedido de menú → link directo, sin IA.
  if (/\b(menu|menú|carta|catalogo|catálogo|precios|lista)\b/.test(normalized)) {
    return {
      reply: `Aquí está nuestro menú con fotos y precios actualizados 👉 ${menuLink}\n\nSi quieres pedir por aquí, dime qué te provoca. 🍦`,
      event: "menu",
    };
  }

  // Saludos cortos sin más contexto → bienvenida breve + link.
  if (/^(hola|holaa|holaaa|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|holi|saludos|que tal|hi|hello)$/.test(normalized)) {
    return {
      reply: `¡Hola! Soy Golosito, tu asistente de Heladería Goloso. 🍦\n\nTe comparto el menú con fotos y precios 👉 ${menuLink}\n\nDime en qué te ayudo.`,
      event: "welcome",
    };
  }

  return null;
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
          instance_id?: string;
          started_at?: string;
          pollStatus?: string;
          pollCount?: number;
          to?: string;
          body?: string;
          purpose?: string;
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
            case "stickers": {
              // Funcionalidad eliminada: siempre devolvemos lista vacía para
              // mantener compatibilidad con versiones antiguas del bot local.
              return json({ stickers: [] });
            }
            case "status": {
              const status = String(body.status ?? "").trim();
              if (!status) return json({ error: "missing_status" }, 400);
              const r = await callRpc("whatsapp_bot_report_status", {
                _token: token,
                _status: status,
                _qr: body.qr ?? null,
                _phone: body.phone ?? null,
                _version: body.version ?? null,
                _instance_id: body.instance_id ?? null,
                _started_at: body.started_at ?? null,
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
              if (fixedReply) {
                return json(r.data);
              }

              // El bot local es quien debe pedir `ai_reply` cuando `use_ai=true`.
              // Antes se hacía un fetch recursivo a este mismo endpoint desde aquí,
              // duplicando latencia y dejando mensajes sin respuesta cuando la IA
              // tardaba. Ahora `incoming` solo resuelve reglas fijas y devuelve la
              // instrucción para que el bot haga la llamada separada con fallback local.
              const shouldUseAi = fixedData.use_ai === true && msg.trim().length > 0;
              if (shouldUseAi) {
                return json({ ...fixedData, reply: null, use_ai: true, source: "incoming_rules_only" });
              }

              return json(r.data);
            }
            case "enqueue_reply": {
              const to = String(body.to ?? "").trim();
              const replyBody = String(body.body ?? "").trim();
              const purpose = String(body.purpose ?? "chatbot_reply").trim() || "chatbot_reply";
              if (!to) return json({ error: "missing_to" }, 400);
              if (!replyBody) return json({ error: "missing_body" }, 400);
              const r = await callRpc("whatsapp_bot_enqueue_reply", {
                _token: token,
                _to: to,
                _body: replyBody,
                _purpose: purpose,
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
                  const orderCfgRes = await callRpc("whatsapp_bot_ai_ordering_config", { _token: token });
                  const rateLimitTakesOrders = orderCfgRes.ok && Boolean((orderCfgRes.data as { ordering_enabled?: boolean } | null)?.ordering_enabled);
                  const reply = fallbackOrderReply(text, DEFAULT_MENU_LINK, rateLimitTakesOrders);
                  return json({ reply, source: "operational", error, conversation_id: conversationId }, 200);
                }
                const fallbackReply = fallbackOrderReply(text, DEFAULT_MENU_LINK, true);
                return json({ error, reply: fallbackReply, source: "operational", conversation_id: conversationId }, 200);
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
              const menuLink = normalizeMenuLink(ctx.menu_link, DEFAULT_MENU_LINK);
              const onlineOpen = Boolean(ctx.online_open);
              const physicalOpen = Boolean(ctx.physical_open);
              const customPrompt = typeof ctx.system_prompt === "string" ? ctx.system_prompt : "";

              // Antes de silenciar mensajes cortos como "sí", "ok" o emojis,
              // verificamos si el cliente tiene un carrito activo. En una toma de
              // pedido, esos mensajes pueden ser confirmaciones reales y deben
              // pasar al flujo operativo/IA, no al ahorro de créditos.
              let activeCartHasItems = false;
              try {
                const cartProbe = await callRpc("whatsapp_bot_ai_cart_get", { _token: token, _phone: from });
                const cartProbeData = (cartProbe.ok ? cartProbe.data : null) as Record<string, unknown> | null;
                activeCartHasItems = Array.isArray(cartProbeData?.items) && cartProbeData.items.length > 0;
              } catch {
                activeCartHasItems = false;
              }

              // 🛡️ CORTOCIRCUITO DE AHORRO DE CRÉDITOS
              // Antes de invocar el modelo (que consume ~13k tokens de input),
              // detectamos mensajes triviales y respondemos deterministamente.
              const shortCircuit = activeCartHasItems ? null : shortCircuitReply(text, menuLink);
              if (shortCircuit) {
                await logBotEvent(token, conversationId, from, "short_circuit_hit", {
                  durationMs: elapsedMs(requestStarted),
                  metadata: { event: shortCircuit.event, replyLength: shortCircuit.reply.length },
                });
                if (!shortCircuit.reply) {
                  return json({ reply: null, source: "short_circuit_silent", conversation_id: conversationId }, 200);
                }
                const payload: Record<string, unknown> = {
                  reply: shortCircuit.reply,
                  source: "short_circuit",
                  conversation_id: conversationId,
                };
                return json(payload, 200);
              }

              // Sabores AGRUPADOS por grupo de modificador (para no mezclar
              // sabores de helado con sabores de jugo, malteadas, etc.)
              const flavorGroups = Array.isArray(ctx.flavor_groups)
                ? ctx.flavor_groups as Array<{ group_name?: string; flavors?: Array<{ name?: string; extra_price?: number | null }> }>
                : [];
              const allProducts = Array.isArray(ctx.products) ? ctx.products as ProductLite[] : [];
              // Reducido de 60 → 20: recorta ~4-6k tokens por request sin afectar precisión.
              const products = selectRelevantProducts(allProducts, text, 20);

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
              const productsByCat = new Map<string, Array<{ id?: string; name: string; price: number }>>();
              for (const p of products) {
                if (!p.name || typeof p.price !== "number") continue;
                const cat = (p.category ?? "Otros").toString();
                if (!productsByCat.has(cat)) productsByCat.set(cat, []);
                const categoryItems = productsByCat.get(cat);
                if (categoryItems) categoryItems.push({ id: p.id, name: String(p.name), price: Number(p.price) });
              }
              const productsBlock = productsByCat.size > 0
                ? "PRODUCTOS Y PRECIOS ACTUALES DE ESTA SEDE, AGRUPADOS POR CATEGORÍA (usa SOLO estos precios reales; respeta la categoría al recomendar):\n" +
                  Array.from(productsByCat.entries())
                    .map(([cat, items]) => `【${cat}】\n` + items.map((i) => `- ${i.name}: ${fmtCOP(i.price)}${i.id ? ` (id:${i.id})` : ""}`).join("\n"))
                    .join("\n")
                : "";

              // FAQs curadas por la sede — Opción 3 (few-shot).
              const allFaqs = Array.isArray(ctx.faqs) ? ctx.faqs as Array<{ q?: string; a?: string }> : [];
              // Reducido de 35 → 8: las FAQ menos relevantes rara vez aplican y consumen ~3k tokens.
              const faqs = selectRelevantFaqs(allFaqs, text, 8);
              const faqsBlock = faqs.length > 0
                ? "PREGUNTAS FRECUENTES DE ESTA SEDE (respuestas oficiales — cuando el cliente pregunte algo parecido, usa esta respuesta tal cual, adaptando solo el saludo):\n" +
                  faqs
                    .filter((f) => f.q && f.a)
                    .map((f, i) => `${i + 1}) P: ${String(f.q).trim()}\n   R: ${String(f.a).trim()}`)
                    .join("\n")
                : "";

              const defaultPrompt = [
                `Eres Golosito, el asistente oficial de Heladería Goloso (sede ${branchName}).`,
                "IDENTIDAD: tu nombre es Golosito. Cuando te presentes, di únicamente 'soy Golosito, tu asistente'. NUNCA uses la expresión 'asistente virtual', 'bot', 'IA', 'inteligencia artificial', 'chatbot' ni 'asesor virtual'. Preséntate SOLO al inicio de la conversación (primer mensaje) y no repitas tu nombre en cada respuesta: mantén una conversación fluida y natural.",
                "TONO: amable, cercano, cálido, alegre, respetuoso y profesional. Español neutro y universal ('con gusto', '¡perfecto!', '¡excelente!', '¡claro que sí!', 'por supuesto'). PROHIBIDO usar regionalismos o modismos como 'parcero', 'parce', 'parcera', 'pues', 'de una', 'bacano', 'chévere', 'bro', 'amigo', 'mi amor', 'mi rey', 'mi reina', 'mijo', 'mija', 'hágale', 'listo pues'. Nunca suenes robótico ni corporativo; transmite calidez y calidad, acorde a la imagen de Heladería Goloso.",
                "Usa 🍦🍨✨🥤 con mesura, solo cuando aporten (no en cada frase, no en cada mensaje). Nunca uses inglés innecesario ni tecnicismos.",
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
                "- REGLA SUPERIOR: si el cliente dice que quiere pedir, menciona un producto, una cantidad, un sabor, dirección o pago, NO respondas solo con el link del menú. Atiéndelo por WhatsApp y avanza el pedido paso a paso usando las herramientas.",
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
                { type: "function", function: { name: "set_delivery_info", description: "Guarda los datos de entrega, tipo de pedido y pago en el carrito.", parameters: { type: "object", properties: { order_type: { type: "string", description: "'delivery' para domicilio o 'pickup' para recoger" }, customer_name: { type: "string" }, delivery_address: { type: "string" }, delivery_neighborhood: { type: "string" }, delivery_notes: { type: "string" }, payment_method: { type: "string", description: "'cash' o 'transfer'" }, delivery_fee: { type: "number" } } } } },
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
                      // Leer carrito actual, agregar item (o reemplazar si ya existe la
                      // misma línea) y persistir. Dedupe defensiva: si el modelo llama
                      // add_to_cart varias veces con el MISMO producto+modificadores
                      // (misma "clave"), tratamos la última llamada como el estado
                      // deseado y no acumulamos duplicados. Esto evita que 1 ensalada
                      // termine registrada 2 o 3 veces por reintentos o alucinaciones
                      // del tool-calling.
                      const cartRes = await callRpc("whatsapp_bot_ai_cart_get", { _token: token, _phone: from });
                      const cart = (cartRes.ok ? cartRes.data : null) as { items?: unknown[] } | null;
                      const items = Array.isArray(cart?.items) ? [...cart.items] : [];
                      const productName = String(args.product_name ?? "").trim();
                      const productIdRaw = args.product_id != null ? String(args.product_id).trim() : "";
                      const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productIdRaw);
                      const modifiersArr = Array.isArray(args.modifiers) ? (args.modifiers as Array<Record<string, unknown>>) : [];

                      // 🛡️ GUARDIA DURA DE MODIFICADORES OBLIGATORIOS.
                      // Si el producto tiene grupos de modificadores REQUERIDOS
                      // (sabores, tamaños, toppings obligatorios) y la IA no
                      // envió al menos min_select opciones por grupo, rechazamos
                      // el add_to_cart y forzamos a la IA a preguntar al cliente.
                      // Esto evita que se registren productos "asumidos" sin
                      // sabor/tamaño confirmado por el cliente.
                      if (isValidUuid) {
                        const modsRes = await callRpc("whatsapp_bot_ai_get_modifiers", { _token: token, _product_id: productIdRaw });
                        const modGroups = Array.isArray(modsRes.data) ? (modsRes.data as Array<Record<string, unknown>>) : [];
                        const requiredGroups = modGroups.filter((g) => g && (g.required === true || Number(g.min_select ?? 0) > 0));
                        if (requiredGroups.length > 0) {
                          const providedNames = new Set(
                            modifiersArr
                              .map((m) => String(m?.name ?? "").trim().toLowerCase())
                              .filter(Boolean)
                          );
                          const missingGroups: Array<{ group_name: string; min_select: number; options: string[] }> = [];
                          for (const g of requiredGroups) {
                            const opts = Array.isArray(g.options) ? (g.options as Array<Record<string, unknown>>) : [];
                            const optNames = opts.map((o) => String(o?.name ?? "").trim()).filter(Boolean);
                            const minSel = Math.max(1, Number(g.min_select ?? 1) || 1);
                            const matched = optNames.filter((n) => providedNames.has(n.toLowerCase())).length;
                            if (matched < minSel) {
                              missingGroups.push({
                                group_name: String(g.group_name ?? "Modificador"),
                                min_select: minSel,
                                options: optNames,
                              });
                            }
                          }
                          if (missingGroups.length > 0) {
                            return {
                              error: "missing_required_modifiers",
                              message: "No agregues este producto todavía. Primero pregúntale al cliente qué elige en cada grupo obligatorio y llama add_to_cart con esas opciones en 'modifiers'. NO inventes ni asumas opciones.",
                              product_name: productName,
                              required_groups: missingGroups,
                            };
                          }
                        }
                      }

                      const modKey = modifiersArr
                        .map((m) => String(m?.id ?? m?.name ?? "").trim().toUpperCase())
                        .filter(Boolean)
                        .sort()
                        .join("|");
                      const productKey = (isValidUuid ? productIdRaw.toLowerCase() : productName.toUpperCase());
                      const itemKey = `${productKey}::${modKey}`;

                      const keyOf = (it: unknown): string => {
                        const rec = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
                        const pid = rec.product_id != null ? String(rec.product_id).trim() : "";
                        const pidIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid);
                        const pname = String(rec.product_name ?? "").trim().toUpperCase();
                        const pk = pidIsUuid ? pid.toLowerCase() : pname;
                        const mods = Array.isArray(rec.modifiers) ? (rec.modifiers as Array<Record<string, unknown>>) : [];
                        const mk = mods
                          .map((m) => String(m?.id ?? m?.name ?? "").trim().toUpperCase())
                          .filter(Boolean)
                          .sort()
                          .join("|");
                        return `${pk}::${mk}`;
                      };

                      const newItem = {
                        product_id: isValidUuid ? productIdRaw : null,
                        product_name: productName,
                        unit_price: Number(args.unit_price ?? 0),
                        qty: Math.max(1, Math.floor(Number(args.qty ?? 1)) || 1),
                        modifiers: modifiersArr,
                        notes: args.notes ?? null,
                      };

                      const existingIdx = items.findIndex((it) => keyOf(it) === itemKey);
                      if (existingIdx >= 0) {
                        // Reemplazar: la llamada más reciente define la cantidad
                        // deseada. Si el cliente quiere realmente más unidades, la
                        // IA debe llamar add_to_cart con qty mayor, no repetir.
                        items[existingIdx] = newItem;
                      } else {
                        items.push(newItem);
                      }
                      const r = await callRpc("whatsapp_bot_ai_cart_upsert", { _token: token, _phone: from, _patch: { items } });
                      return r.ok
                        ? { ok: true, deduped: existingIdx >= 0, cart: r.data }
                        : { error: "add_failed", detail: r.data };
                    }
                    case "set_delivery_info": {
                      const patch: Record<string, unknown> = {};
                      for (const k of ["order_type", "customer_name", "delivery_address", "delivery_neighborhood", "delivery_notes", "payment_method"]) {
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
                      if (r.ok) {
                        orderConfirmed = true;
                        return { ok: true, order: r.data };
                      }
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

              const buildOperationalOrderReply = async () => {
                if (!orderingEnabled || !text) return null;

                const normalized = normalizeText(text);
                const currentCartRes = await callRpc("whatsapp_bot_ai_cart_get", { _token: token, _phone: from });
                const currentCart = (currentCartRes.ok ? currentCartRes.data : null) as Record<string, unknown> | null;
                const currentItems = Array.isArray(currentCart?.items) ? currentCart.items as Array<Record<string, unknown>> : [];
                const patch: Record<string, unknown> = {};
                const orderType = detectOrderType(text);
                const payment = detectPayment(text);
                const customerName = extractCustomerName(text);
                const address = extractAddress(text);
                const neighborhood = extractNeighborhood(text);

                if (orderType) patch.order_type = orderType;
                if (payment) patch.payment_method = payment;
                if (customerName && customerName.length >= 2) patch.customer_name = customerName;
                if (address && address.length >= 3) patch.delivery_address = address;
                if (neighborhood && neighborhood.length >= 2) patch.delivery_neighborhood = neighborhood;
                if (orderType === "delivery" || (!orderType && (currentCart?.order_type ?? "delivery") === "delivery")) {
                  patch.delivery_fee = Number(orderCfg?.delivery_fee ?? currentCart?.delivery_fee ?? 0);
                }

                // IMPORTANTE: NO agregamos productos al carrito desde esta
                // ruta operativa. Un match por texto no basta: los productos
                // pueden tener sabores/modificadores obligatorios y el cliente
                // debe elegirlos. Los productos SOLO entran al carrito vía
                // add_to_cart llamado por la IA tras validar modificadores.

                const hasPatch = Object.keys(patch).length > 0;
                const hasCart = currentItems.length > 0;
                const looksLikeOrderTurn = hasPatch || hasCart;
                if (!looksLikeOrderTurn) return null;

                let cart = currentCart;
                if (hasPatch) {
                  const upsert = await callRpc("whatsapp_bot_ai_cart_upsert", { _token: token, _phone: from, _patch: patch });
                  if (upsert.ok && upsert.data && typeof upsert.data === "object") cart = upsert.data as Record<string, unknown>;
                }

                const items = Array.isArray(cart?.items) ? cart.items as Array<Record<string, unknown>> : [];
                // Sin items no hay pedido para resumir/confirmar: dejamos que la
                // IA guíe al cliente (search_products → get_modifiers → add_to_cart).
                if (items.length === 0) return null;

                const effectiveOrderType = String(cart?.order_type ?? patch.order_type ?? "delivery");
                const missing: string[] = [];
                if (!String(cart?.customer_name ?? "").trim()) missing.push("nombre");
                if (effectiveOrderType === "delivery") {
                  if (!String(cart?.delivery_address ?? "").trim()) missing.push("dirección");
                  if (!String(cart?.delivery_neighborhood ?? "").trim()) missing.push("barrio");
                }
                if (!String(cart?.payment_method ?? "").trim()) missing.push("método de pago");

                // La confirmación SIEMPRE pasa por la IA (tool confirm_order),
                // que aplica guardias completas (nombre, modificadores, etc.).
                // Aquí solo mostramos avance/resumen si falta info.
                if (missing.length > 0) {
                  const summary = summarizeCart(cart, fmtCOP);
                  return `Voy armando tu pedido. 🍦\n\n${summary}\n\nPara registrarlo me falta: ${missing.join(", ")}.`;
                }
                return null; // datos completos: la IA cierra con el cliente
              };

              const operationalOrderReply = await buildOperationalOrderReply();
              if (operationalOrderReply) {
                await callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "user", _content: text || "[nota de voz]" });
                await callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "assistant", _content: operationalOrderReply });
                await callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });
                await logBotEvent(token, conversationId, from, "operational_order_flow", {
                  durationMs: elapsedMs(requestStarted),
                  metadata: { replyLength: operationalOrderReply.length },
                });
                return json({ reply: operationalOrderReply, source: "operational_order_flow", conversation_id: conversationId }, 200);
              }

              // 5) Llamar a la IA. En producción priorizamos Google AI Studio directo
              // para no consumir créditos de Lovable. Si un modelo deja de estar
              // disponible para la clave actual, pasamos a un modelo estable distinto.
              const geminiKey = process.env.GEMINI_API_KEY;
              if (!geminiKey) {
                const reply = fallbackOrderReply(text, menuLink, orderingEnabled);
                await logBotEvent(token, conversationId, from, "ai_not_configured_operational", {
                  ok: false,
                  metadata: { orderingEnabled },
                });
                return json({ error: "gemini_not_configured", reply, source: "operational_no_lovable_credits", conversation_id: conversationId }, 200);
              }

              // Preflight cuota Gemini: si la cuota gratuita diaria ya se agotó,
              // evitamos llamar Lovable AI para no consumir créditos de la cuenta.
              // y contestamos directamente con una respuesta operativa sin IA.
              const q = await callRpc("gemini_quota_status", {});
              const qData = Array.isArray(q.data) ? q.data[0] : q.data;
              const exhausted = Boolean((qData as { exhausted?: boolean } | null)?.exhausted);
              if (exhausted) {
                const reply = fallbackOrderReply(text, menuLink, orderingEnabled);
                await logBotEvent(token, conversationId, from, "gemini_quota_exhausted_skip_ai", {
                  ok: false,
                  metadata: qData ?? null,
                });
                await callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "user", _content: text || "[nota de voz]" });
                await callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "assistant", _content: reply });
                await callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });
                return json({
                  reply,
                  source: "quota_exhausted_operational_no_lovable_credits",
                  warning: "gemini_quota_exhausted",
                  conversation_id: conversationId,
                });
              }

              const useGeminiDirect = true;
              const primaryModel = "gemini-2.0-flash";
              const fallbackModel = "gemini-2.0-flash-lite";

              type ChatMsg = { role: string; content?: unknown; tool_call_id?: string; name?: string; tool_calls?: unknown[] };
              const messages: ChatMsg[] = [
                { role: "system", content: finalSystemPrompt },
                ...history.map((m) => ({ role: m.role, content: m.content })),
                { role: "user", content: userContent },
              ];

              const aiUrlBase = useGeminiDirect
                ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
                : "https://ai.gateway.lovable.dev/v1/chat/completions";
              const aiHeaders: Record<string, string> = useGeminiDirect
                ? { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" }
                : { "Content-Type": "application/json" };

              const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
              const callAiOnce = async (model: string) => {
                const bodyReq: Record<string, unknown> = {
                  model, messages, max_tokens: 800, temperature: 0.6,
                };
                if (orderingTools.length > 0) {
                  bodyReq.tools = orderingTools;
                  bodyReq.tool_choice = "auto";
                }
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), AI_CALL_TIMEOUT_MS);
                try {
                  return await fetch(aiUrlBase, {
                    method: "POST",
                    headers: aiHeaders,
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
                // Backoff exponencial: 500, 1500, 3000 ms. 3 intentos totales.
                const backoffs = [500, 1500, 3000];
                for (let attempt = 0; attempt < 3; attempt += 1) {
                  try {
                    const response = await callAiOnce(model);
                    lastResponse = response;
                    if (response.ok || (response.status !== 429 && response.status < 500)) return response;
                    await pause(backoffs[attempt] ?? 3000);
                  } catch (error) {
                    lastError = error;
                    await pause(backoffs[attempt] ?? 3000);
                  }
                }
                if (lastResponse) return lastResponse;
                throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "ai_fetch_failed"));
              };

              // Loop de tool-calling con presupuesto global: evita que una conversación
              // bloquee al bot local hasta agotar su timeout de WhatsApp.
              // y pide continuación para no cortar la respuesta al cliente.
              let finalReply = "";
              let lastErr: string | null = null;
              let lastFinishReason: string | null = null;
              let orderConfirmed = false;
              let confirmedOrderNumber: string | null = null;
              for (let round = 0; round < AI_MAX_TOOL_ROUNDS; round++) {
                if (!hasAiBudget(requestStarted)) {
                  lastErr = "ai_budget_exhausted";
                  await logBotEvent(token, conversationId, from, "ai_budget_exhausted", {
                    ok: false,
                    durationMs: elapsedMs(requestStarted),
                    metadata: { round },
                  });
                  break;
                }
                const aiStarted = performance.now();
                let aiResp: Response;
                try {
                  aiResp = await callAi(primaryModel);
                } catch (error) {
                  await logBotEvent(token, conversationId, from, "ai_request_exception", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error,
                    metadata: { round, model: primaryModel },
                  });
                  try {
                    aiResp = await callAi(fallbackModel);
                  } catch (fallbackError) {
                    lastErr = trimForLog(fallbackError, 500);
                    await logBotEvent(token, conversationId, from, "ai_fallback_exception", {
                      ok: false,
                      durationMs: elapsedMs(aiStarted),
                      error: fallbackError,
                      metadata: { round, model: fallbackModel },
                    });
                    break;
                  }
                }
                if (!aiResp.ok && (aiResp.status >= 500 || aiResp.status === 404 || aiResp.status === 429)) {
                  await logBotEvent(token, conversationId, from, "ai_primary_failed", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: `HTTP ${aiResp.status}`,
                    metadata: { round, model: primaryModel },
                  });
                  try {
                    aiResp = await callAi(fallbackModel);
                  } catch (fallbackError) {
                    lastErr = trimForLog(fallbackError, 500);
                    await logBotEvent(token, conversationId, from, "ai_fallback_exception", {
                      ok: false,
                      durationMs: elapsedMs(aiStarted),
                      error: fallbackError,
                      metadata: { round, model: fallbackModel },
                    });
                    break;
                  }
                }
                if (!aiResp.ok && aiResp.status === 404 && useGeminiDirect) {
                  const detail = await aiResp.text().catch(() => "");
                  lastErr = detail.slice(0, 500) || "gemini_model_not_available";
                  await logBotEvent(token, conversationId, from, "ai_model_not_available_operational", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: lastErr,
                    metadata: { round, model: fallbackModel },
                  });
                  break;
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
                if (useGeminiDirect) void trackGeminiCall("whatsapp_bot");
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
                  // Si el modelo cortó por longitud, pedir continuación una sola vez y solo si hay presupuesto.
                  if (chunk && lastFinishReason === "length" && round < 1 && hasAiBudget(requestStarted, 8_000)) {
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
                  if (tc.function.name === "confirm_order" && toolResult.ok === true) {
                    const order = toolResult.order && typeof toolResult.order === "object" ? toolResult.order as Record<string, unknown> : {};
                    confirmedOrderNumber = String(order.order_number ?? order.ticket_number ?? "").trim() || null;
                  }
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

              if (!finalReply && orderConfirmed) {
                finalReply = confirmedOrderNumber
                  ? `Tu pedido quedó registrado con el nº ${confirmedOrderNumber}. 🍦\n\nNuestro equipo lo revisará y te confirmará en unos minutos.`
                  : "Tu pedido quedó registrado. 🍦\n\nNuestro equipo lo revisará y te confirmará en unos minutos.";
              }


              // Fallback operativo: nunca enviar al cliente el mensaje de error técnico.
              if (!finalReply) {
                finalReply = fallbackOrderReply(text, menuLink, orderingEnabled, history.length > 0);
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

              return json({
                reply: finalReply || null,
                source: lastErr ? "ai_operational" : "ai",
                finish_reason: lastFinishReason,
                warning: lastErr,
                conversation_id: conversationId,
              });
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
