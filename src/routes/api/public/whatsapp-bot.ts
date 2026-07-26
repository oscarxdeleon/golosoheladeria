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
  // Fire-and-forget: nunca esperamos por el log. Un log lento no debe
  // demorar la respuesta al cliente. Los errores del RPC se ignoran.
  void callRpc("whatsapp_bot_ai_log_event", {
    _token: token,
    _conversation_id: conversationId,
    _phone: phone,
    _stage: stage,
    _ok: data.ok !== false,
    _duration_ms: typeof data.durationMs === "number" ? data.durationMs : null,
    _error: data.error == null ? null : trimForLog(data.error, 1000),
    _metadata: data.metadata ?? {},
  }).catch(() => {});
}

// Cache in-memory de la porción "sede" del contexto (menú, sabores, FAQs,
// dirección, config). Cambia rara vez y se comparte entre clientes de la
// misma sede. TTL corto para reflejar cambios operativos rápido.
// Clave = token; scope = instancia del worker (best-effort).
type CachedContext = { data: Record<string, unknown>; expiresAt: number };
const CONTEXT_CACHE_TTL_MS = 60_000;
const contextCache = new Map<string, CachedContext>();

function getCachedContext(token: string): Record<string, unknown> | null {
  const hit = contextCache.get(token);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    contextCache.delete(token);
    return null;
  }
  return hit.data;
}

function setCachedContext(token: string, data: Record<string, unknown>) {
  contextCache.set(token, { data, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
  // Cap para no crecer sin límite
  if (contextCache.size > 32) {
    const oldestKey = contextCache.keys().next().value;
    if (oldestKey) contextCache.delete(oldestKey);
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

function operationalReply(menuLink: string, takingOrders = false, _branchName?: string) {
  // Nunca exponemos el nombre interno de la sede al cliente en el saludo.
  // El nombre se usa solo internamente para menú/horarios/config.
  if (takingOrders) {
    return `¡Hola! 👋🍦 Bienvenido a Heladería Goloso. Cuéntame qué te provoca y lo pedimos.\n\nMenú 👉 ${menuLink}`;
  }
  return `¡Hola! 👋🍦 Bienvenido a Heladería Goloso. Mira el menú y realiza tu pedido en menos de un minuto 👉 ${menuLink}`;
}

const PUBLIC_MENU_BASE = "https://golosoheladeria.vercel.app";
const DEFAULT_MENU_LINK = `${PUBLIC_MENU_BASE}/menu`;

function normalizeMenuLink(value: unknown, fallback = DEFAULT_MENU_LINK) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return raw
    .replace(/https:\/\/golosoheladeria\.lovable\.app/gi, PUBLIC_MENU_BASE)
    .replace(/https:\/\/id-preview--[a-z0-9-]+\.lovable\.app/gi, PUBLIC_MENU_BASE);
}

function fallbackOrderReply(input: string, menuLink: string, takingOrders: boolean, hasHistory = false, branchName?: string) {
  if (!takingOrders) return operationalReply(menuLink, false, branchName);
  if (hasHistory) {
    // Durante conversación activa NUNCA reiniciamos con "¿Qué te provoca pedir?".
    // Damos una respuesta neutra que invita al cliente a repetir su último punto.
    return `Perdona, se me trabó un segundo. 🍦 ¿Me repites lo último para continuar tu pedido?`;
  }
  return operationalReply(menuLink, true, branchName);
}

type CartRecord = Record<string, unknown> | null;

function cartItems(cart: CartRecord): Array<Record<string, unknown>> {
  const items = cart?.items;
  return Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
}

function hasCartItems(cart: CartRecord) {
  return cartItems(cart).length > 0;
}

function fieldText(cart: CartRecord, field: string) {
  return typeof cart?.[field] === "string" ? String(cart[field]).trim() : "";
}

function effectiveOrderType(cart: CartRecord) {
  const value = fieldText(cart, "order_type").toLowerCase();
  return value === "pickup" ? "pickup" : "delivery";
}

function missingCartFields(cart: CartRecord) {
  const missing: string[] = [];
  if (!fieldText(cart, "customer_name")) missing.push("nombre");
  if (effectiveOrderType(cart) === "delivery") {
    if (!fieldText(cart, "delivery_address")) missing.push("dirección");
    if (!fieldText(cart, "delivery_neighborhood")) missing.push("barrio");
  }
  if (!fieldText(cart, "payment_method")) missing.push("método de pago");
  return missing;
}

function hasPendingProduct(cart: CartRecord) {
  const pending = cart?.pending_product;
  return Boolean(pending && typeof pending === "object" && String((pending as Record<string, unknown>).name ?? "").trim());
}

function hasSessionData(cart: CartRecord) {
  return hasCartItems(cart)
    || hasPendingProduct(cart)
    || Boolean(fieldText(cart, "customer_name"))
    || Boolean(fieldText(cart, "delivery_address"))
    || Boolean(fieldText(cart, "delivery_neighborhood"))
    || Boolean(fieldText(cart, "payment_method"));
}

function nextFsmState(cart: CartRecord) {
  if (!cart || !hasSessionData(cart)) return "GREETING";
  if (hasPendingProduct(cart) && !hasCartItems(cart)) return "CONFIGURING_PRODUCT";
  if (!hasCartItems(cart)) return "SELECTING_PRODUCT";
  const missing = missingCartFields(cart);
  if (missing.includes("nombre")) return "COLLECTING_NAME";
  if (missing.includes("dirección")) return "COLLECTING_ADDRESS";
  if (missing.includes("barrio")) return "COLLECTING_NEIGHBORHOOD";
  if (missing.includes("método de pago")) return "COLLECTING_PAYMENT";
  return "AWAITING_CONFIRMATION";
}

function sameReply(a: string, b: string) {
  return normalizeText(a).replace(/\s+/g, " ") === normalizeText(b).replace(/\s+/g, " ");
}

function isAlreadyOrderedTurn(input: string) {
  const normalized = normalizeText(input);
  return /\b(ya pedi|ya hice el pedido|ya realice el pedido|ya ordene|ya esta pedido|ya lo pedi|ya lo hice)\b/.test(normalized);
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

function looksLikeBareCustomerName(input: string) {
  const raw = input.trim().replace(/\s+/g, " ");
  if (raw.length < 3 || raw.length > 60) return false;
  const normalized = normalizeText(raw);
  if (!normalized || isConfirmation(raw) || isCancelOrNegativeTurn(raw) || isAlreadyOrderedTurn(raw)) return false;
  if (detectOrderType(raw) || detectPayment(raw) || extractAddress(raw) || extractNeighborhood(raw)) return false;
  if (/[#@0-9]/.test(raw)) return false;
  if (/\b(quiero|dame|deme|pedido|pedir|producto|helado|malteada|ensalada|vaso|cono|copa|sabor|topping|domicilio|direccion|dirección|barrio|pago|efectivo|transferencia|nequi|bancolombia|menu|menú|precio|cuanto|cuánto|ya|hice|pedi|pedí)\b/.test(normalized)) return false;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  return words.every((word) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.-]{2,}$/.test(word));
}

function extractAddress(input: string) {
  return extractField(input, ["direccion", "dirección", "dir", "address"]);
}

function looksLikeBareAddress(input: string) {
  const normalized = normalizeText(input);
  return /\b(calle|callejon|carrera|cra|cl|kr|avenida|av|diagonal|transversal|mz|manzana|casa|apartamento|apto|edificio|torre|via|kilometro|km)\b/.test(normalized)
    || /#|\b\d{1,3}\s*[a-z]?\s*(?:-|#)\s*\d{1,3}\b/i.test(input);
}

function extractNeighborhood(input: string) {
  return extractField(input, ["barrio", "sector"]);
}

function looksLikeBareNeighborhood(input: string) {
  const raw = input.trim().replace(/\s+/g, " ");
  if (raw.length < 3 || raw.length > 45) return false;
  const normalized = normalizeText(raw);
  if (!normalized || isConfirmation(raw) || isCancelOrNegativeTurn(raw) || isAlreadyOrderedTurn(raw)) return false;
  if (detectPayment(raw) || detectOrderType(raw) || looksLikeBareAddress(raw)) return false;
  if (/\b(quiero|dame|deme|pedido|pedir|producto|helado|malteada|ensalada|vaso|cono|copa|sabor|topping|menu|menú|precio|cuanto|cuánto|nombre|direccion|dirección|pago|efectivo|transferencia|nequi|bancolombia)\b/.test(normalized)) return false;
  return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'.\-\s]+$/.test(raw);
}

/**
 * Extractor multi-entidad determinístico.
 * Toma un mensaje completo (posiblemente con varios datos separados por
 * coma / salto de línea / punto y coma) y devuelve TODOS los campos
 * capturables en un solo pase. Elimina el bucle "para registrarlo me falta
 * dirección, barrio" cuando el cliente ya envió todo junto.
 */
function extractAllEntitiesFromText(input: string): Record<string, string> {
  const patch: Record<string, string> = {};
  if (!input) return patch;

  // 1) Detectores globales sobre el texto completo
  const orderTypeAll = detectOrderType(input);
  if (orderTypeAll) patch.order_type = orderTypeAll;
  const paymentAll = detectPayment(input);
  if (paymentAll) patch.payment_method = paymentAll;

  // 2) Etiquetados explícitos (nombre:, dirección:, barrio:)
  const nameLabeled = extractCustomerName(input);
  if (nameLabeled && nameLabeled.length >= 2) patch.customer_name = nameLabeled.replace(/\s+/g, " ").trim();
  const addrLabeled = extractAddress(input);
  if (addrLabeled && addrLabeled.length >= 3) patch.delivery_address = addrLabeled.replace(/\s+/g, " ").trim();
  const nbhLabeled = extractNeighborhood(input);
  if (nbhLabeled && nbhLabeled.length >= 2) patch.delivery_neighborhood = nbhLabeled.replace(/\s+/g, " ").trim();

  // 3) Segmentar por comas / saltos / punto y coma y aplicar heurísticas
  //    "bare" a cada segmento por separado. Así "Oscar, Calle 9 #14-59,
  //    Bello Horizonte, Nequi" captura nombre + dirección + barrio + pago
  //    en un solo turno.
  const segments = input
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const seg of segments) {
    // dirección
    if (!patch.delivery_address && looksLikeBareAddress(seg)) {
      patch.delivery_address = seg.replace(/\s+/g, " ").trim();
      continue;
    }
    // pago (por si vino como palabra suelta en un segmento)
    if (!patch.payment_method) {
      const p = detectPayment(seg);
      if (p) { patch.payment_method = p; continue; }
    }
    // tipo pedido
    if (!patch.order_type) {
      const ot = detectOrderType(seg);
      if (ot) { patch.order_type = ot; continue; }
    }
    // barrio (después de descartar dirección/pago)
    if (!patch.delivery_neighborhood && looksLikeBareNeighborhood(seg)) {
      patch.delivery_neighborhood = seg.replace(/\s+/g, " ").trim();
      continue;
    }
    // nombre (solo si aún no lo tenemos y parece un nombre)
    if (!patch.customer_name && looksLikeBareCustomerName(seg)) {
      patch.customer_name = seg.replace(/\s+/g, " ").trim();
      continue;
    }
  }

  return patch;
}

function isConfirmation(input: string) {
  // FSM Fase 1: confirmación estricta. Solo turnos CORTOS de puro asentimiento
  // cuentan como confirmación. Frases largas ("necesito saber si abren")
  // ya no disparan el cierre por accidente.
  const normalized = normalizeText(input).trim();
  if (!normalized) return false;
  if (normalized.length > 40) return false;
  if (/[?¿]/.test(input)) return false;
  const pure = /^(si|sí|si por favor|si porfa|si porfis|sip|sipi|claro|claro que si|confirmo|confirmar|dale|listo|listo confirmo|correcto|esta bien|está bien|todo bien|ok|okay|okey|perfecto|hagale|hágale|de una|va|vale|listo dale|confirmado|confirmalo|confírmalo)$/i;
  return pure.test(normalized);
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

function hasCurrentTurnProductEvidence(input: string, productName: string) {
  const normalized = normalizeText(input);
  const productWords = textTokens(productName)
    .filter((word) => word.length >= 4 && !["sabor", "sabores", "helado", "helados", "goloso"].includes(word));
  const hasSpecificProductWord = productWords.some((word) => normalized.includes(word));
  const hasGenericOrderWord = /\b(cono|vaso|copa|estrella|malteada|jugo|banana|ensalada|brownie|waffle|cholado|fresas|crema|cremas|litro|medio|paleta|gelatina)\b/.test(normalized);
  const hasOrderVerb = /\b(quiero|dame|deme|pedir|pedido|comprar|agrega|agregar|añade|añadir|anota|llevar|domicilio|recoger)\b/.test(normalized);
  return (hasSpecificProductWord || hasGenericOrderWord) && hasOrderVerb;
}

function hasRecentProductEvidence(input: string, productName: string) {
  const normalized = normalizeText(input);
  const productWords = textTokens(productName)
    .filter((word) => word.length >= 4 && !["sabor", "sabores", "helado", "helados", "goloso"].includes(word));
  const hasSpecificProductWord = productWords.some((word) => normalized.includes(word));
  const hasGenericOrderWord = /\b(cono|vaso|copa|estrella|malteada|jugo|banana|ensalada|brownie|waffle|cholado|fresas|crema|cremas|litro|medio|paleta|gelatina)\b/.test(normalized);
  const hasOrderVerb = /\b(quiero|dame|deme|pedir|pedido|comprar|agrega|agregar|añade|añadir|anota|llevar|domicilio|recoger)\b/.test(normalized);
  return hasCurrentTurnProductEvidence(input, productName) || ((hasSpecificProductWord || hasGenericOrderWord) && hasOrderVerb);
}

function isGeneralHelpTurn(input: string) {
  const normalized = normalizeText(input);
  return /\b(hola|buenas|buenos dias|buenas tardes|buenas noches|menu|menú|carta|catalogo|catálogo|precio|precios|horario|abren|cierran|ubicacion|ubicación|direccion|dirección|domicilio|domicilios|foto|fotos|cremas|pagar|pago|transferencia|efectivo|nequi|bancolombia)\b/.test(normalized)
    && !/\b(confirmo|confirmar|si|sí|dale|listo|agrega|agregar|añade|añadir|quita|quitar|cancela|cancelar|nombre|barrio)\b/.test(normalized);
}

function summarizeCart(cart: Record<string, unknown> | null, fmtCOP: (n: number) => string) {
  const items = cartItems(cart);
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

function buildCartProgressReply(cart: CartRecord, fmtCOP: (n: number) => string, intro?: string) {
  if (!hasCartItems(cart)) return null;
  const name = fieldText(cart, "customer_name");
  const missing = missingCartFields(cart);
  const summary = summarizeCart(cart, fmtCOP);
  const prefix = intro ? `${intro}\n\n` : "";

  if (missing.includes("nombre")) {
    return `${prefix}Ya tengo tu pedido en curso. 🍦\n\n${summary}\n\n¿A nombre de quién lo registro?`;
  }
  if (missing.includes("dirección")) {
    return `${prefix}${name ? `Gracias, ${name}.` : "Perfecto."} ¿Cuál es la dirección completa para el domicilio?`;
  }
  if (missing.includes("barrio")) {
    return `${prefix}${name ? `${name}, ` : ""}¿en qué barrio queda?`;
  }
  if (missing.includes("método de pago")) {
    return `${prefix}${name ? `${name}, ` : ""}¿pagas en efectivo o transferencia?`;
  }
  return `${prefix}${summary}\n\n${name ? `${name}, ` : ""}¿confirmas el pedido?`;
}

function buildActiveSessionFallback(cart: CartRecord, fmtCOP: (n: number) => string) {
  if (hasCartItems(cart)) {
    return buildCartProgressReply(cart, fmtCOP, "Sigo con tu pedido en curso.")
      ?? "Sigo con tu pedido en curso. 🍦 ¿Confirmas para registrarlo?";
  }
  if (hasPendingProduct(cart)) {
    const pending = cart?.pending_product as Record<string, unknown>;
    const productName = String(pending?.name ?? "ese producto").trim() || "ese producto";
    return `Sigo con ${productName}. 🍦 ¿Qué sabor, topping o detalle quieres agregarle?`;
  }
  if (hasSessionData(cart)) {
    const missing = missingCartFields(cart);
    if (missing.length > 0) return `Sigo con tu pedido. 🍦 Me falta ${missing[0]}.`;
    return "Sigo con tu pedido. 🍦 Dime qué producto deseas agregar.";
  }
  return null;
}

async function persistCartPatch(token: string, phone: string, patch: Record<string, unknown>) {
  const first = await callRpc("whatsapp_bot_ai_cart_upsert", { _token: token, _phone: phone, _patch: patch });
  if (!first.ok || !first.data || typeof first.data !== "object") return first;
  const cart = first.data as Record<string, unknown>;
  const inferredState = nextFsmState(cart);
  if (String(cart.fsm_state ?? "") === inferredState) return first;
  const second = await callRpc("whatsapp_bot_ai_cart_upsert", {
    _token: token,
    _phone: phone,
    _patch: { fsm_state: inferredState },
  });
  return second.ok ? second : first;
}

const AI_TOTAL_BUDGET_MS = 20_000;
const AI_CALL_TIMEOUT_MS = 6_000;
const AI_MAX_TOOL_ROUNDS = 3;

function hasAiBudget(startedAt: number, reserveMs = 2_500) {
  return elapsedMs(startedAt) < AI_TOTAL_BUDGET_MS - reserveMs;
}

function remainingAiBudget(startedAt: number, reserveMs = 2_500) {
  return Math.max(0, AI_TOTAL_BUDGET_MS - elapsedMs(startedAt) - reserveMs);
}

/**
 * Cortocircuito de ahorro de créditos. Detecta mensajes triviales
 * (agradecimientos, "ok", emojis, saludos cortos, pedidos de menú)
 * y devuelve una respuesta determinista SIN llamar al modelo de IA.
 * Cada llamada evitada ahorra ~13.000 tokens de entrada.
 */
function shortCircuitReply(input: string, menuLink: string, branchName?: string): { reply: string; event: string | null } | null {
  const raw = input.trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:()"']/g, "")
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 4) return null;

  const onlyEmojis = /^[\p{Emoji}\p{Extended_Pictographic}\s❤️👍👌🙏✨🍦🍨🥤]+$/u.test(raw);
  if (onlyEmojis) return { reply: "", event: null };

  if (/\b(gracias|thanks|thank|agradezco|muy amable|mil gracias|dios te pague)\b/.test(normalized)) {
    return { reply: "¡Con gusto! 🍦", event: "thanks" };
  }

  if (/^(ok|okay|listo|dale|vale|bueno|si|sii|siii|no|nop|va|bien|perfecto|entendido|👍|👌|🙏)$/.test(normalized)) {
    return { reply: "", event: null };
  }

  // El nombre de la sede es interno; nunca se muestra al cliente.

  // Pedido de menú → link directo.
  if (/\b(menu|menú|carta|catalogo|catálogo|precios|lista)\b/.test(normalized)) {
    return {
      reply: `Aquí lo tienes 👉 ${menuLink}`,
      event: "menu",
    };
  }

  // Saludos cortos → bienvenida breve.
  if (/^(hola|holaa|holaaa|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|holi|saludos|que tal|hi|hello)$/.test(normalized)) {
    return {
      reply: `¡Hola! 👋🍦 Bienvenido a Heladería Goloso. Mira el menú y realiza tu pedido en menos de un minuto 👉 ${menuLink}`,
      event: "welcome",
    };
  }

  return null;
}

function isCancelOrNegativeTurn(input: string) {
  const normalized = normalizeText(input);
  return /\b(cancelar|cancela|borra|borrar|elimina|eliminar|quitar|quita|no era|no quiero|ya no|mejor no|dejalo asi|déjalo así|empezar de nuevo|nuevo pedido)\b/.test(normalized)
    || /^(no|nop|cancelar|cancela)$/i.test(normalized);
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

              // 1) Bootstrap: contexto + carrito + historial + ordering en UNA sola RPC.
              // Reemplaza 4 round-trips seriales a Supabase (~800-1200 ms) por 1.
              // Además, cacheamos in-memory la porción "sede" (menú/FAQs/sabores)
              // por 60 s, reutilizando datos que cambian rara vez entre clientes.
              const contextStarted = performance.now();
              const bootstrapRes = await callRpc("whatsapp_bot_ai_bootstrap", {
                _token: token, _phone: from, _limit: 12,
              });
              if (!bootstrapRes.ok) {
                void logBotEvent(token, conversationId, from, "context_rpc_failed", {
                  ok: false, durationMs: elapsedMs(contextStarted),
                  error: bootstrapRes.data, metadata: { status: bootstrapRes.status },
                });
                return json({ error: "rpc_failed", detail: bootstrapRes.data, conversation_id: conversationId }, bootstrapRes.status);
              }
              const bootstrap = (bootstrapRes.data as Record<string, unknown> | null) ?? {};
              const ctxRaw = (bootstrap.context as Record<string, unknown> | null) ?? null;
              const preloadedCart = (bootstrap.cart as Record<string, unknown> | null) ?? null;
              const preloadedHistoryPayload = (bootstrap.history as { messages?: unknown } | null) ?? null;
              const preloadedOrdering = (bootstrap.ordering as {
                ordering_enabled?: boolean; min_amount?: number; delivery_fee?: number;
                zones?: string | null; transfer_info?: string | null; dry_run?: boolean;
              } | null) ?? null;

              // Fusionar con cache de sede para evitar recargar partes pesadas
              // (menú/FAQs/sabores) en cada mensaje. usage_today/rate_limit vienen
              // siempre frescos del RPC.
              let ctx = ctxRaw;
              if (ctx && !(ctx as { error?: string }).error) {
                const cached = getCachedContext(token);
                if (cached) {
                  // Preservamos campos por-cliente y de estado en vivo desde ctxRaw
                  const liveKeys = ["usage_today", "daily_limit", "online_open", "physical_open"];
                  const merged: Record<string, unknown> = { ...cached, ...ctx };
                  for (const k of liveKeys) if (k in ctx) merged[k] = (ctx as Record<string, unknown>)[k];
                  ctx = merged;
                } else {
                  setCachedContext(token, ctx as Record<string, unknown>);
                }
              }

              if (!ctx || (ctx as { error?: string }).error) {
                const error = (ctx as { error?: string })?.error ?? "context_error";
                void logBotEvent(token, conversationId, from, "context_blocked", {
                  ok: false, durationMs: elapsedMs(contextStarted), error,
                  metadata: { context: ctx ?? null },
                });
                if (error === "rate_limited") {
                  const rateLimitTakesOrders = Boolean(preloadedOrdering?.ordering_enabled);
                  const reply = fallbackOrderReply(text, DEFAULT_MENU_LINK, rateLimitTakesOrders);
                  return json({ reply, source: "operational", error, conversation_id: conversationId }, 200);
                }
                const fallbackReply = fallbackOrderReply(text, DEFAULT_MENU_LINK, true);
                return json({ error, reply: fallbackReply, source: "operational", conversation_id: conversationId }, 200);
              }
              void logBotEvent(token, conversationId, from, "context_loaded", {
                durationMs: elapsedMs(contextStarted),
                metadata: {
                  usageToday: ctx.usage_today ?? null,
                  dailyLimit: ctx.daily_limit ?? null,
                  products: Array.isArray(ctx.products) ? ctx.products.length : 0,
                  faqs: Array.isArray(ctx.faqs) ? ctx.faqs.length : 0,
                  flavorGroups: Array.isArray(ctx.flavor_groups) ? ctx.flavor_groups.length : 0,
                  cachedContext: getCachedContext(token) === ctx,
                },
              });
              const branchName = String(ctx.branch_name ?? "Heladería Goloso");
              const menuLink = normalizeMenuLink(ctx.menu_link, DEFAULT_MENU_LINK);
              const onlineOpen = Boolean(ctx.online_open);
              const physicalOpen = Boolean(ctx.physical_open);
              const customPrompt = typeof ctx.system_prompt === "string" ? ctx.system_prompt : "";
              const branchAddress = typeof ctx.branch_address === "string" ? ctx.branch_address.trim() : "";
              const branchNeighborhood = typeof ctx.branch_neighborhood === "string" ? ctx.branch_neighborhood.trim() : "";
              const branchCity = typeof ctx.branch_city === "string" ? ctx.branch_city.trim() : "";
              const branchPhone = typeof ctx.branch_phone === "string" ? ctx.branch_phone.trim() : "";
              const branchFullAddress = typeof ctx.branch_full_address === "string" ? ctx.branch_full_address.trim() : "";
              const branchMapsLink = typeof ctx.branch_maps_link === "string" ? ctx.branch_maps_link.trim() : "";
              const locationBlock = branchFullAddress
                ? [
                    `UBICACIÓN OFICIAL DE ESTA SEDE (${branchName}) — usa SIEMPRE esta información cuando el cliente pregunte por dirección, ubicación, cómo llegar, dónde quedan, dónde están, envíame la ubicación, etc. NUNCA inventes ni mezcles con otra sede:`,
                    `- Dirección: ${branchAddress || "(no configurada)"}`,
                    branchNeighborhood ? `- Barrio: ${branchNeighborhood}` : "",
                    branchCity ? `- Ciudad: ${branchCity}` : "",
                    branchPhone ? `- Teléfono de contacto: ${branchPhone}` : "",
                    branchMapsLink ? `- Google Maps: ${branchMapsLink}` : "",
                    "Cuando respondas la ubicación, entrega la dirección completa en líneas separadas y, si hay enlace de Google Maps, inclúyelo al final. Ejemplo:",
                    `📍 Nuestra sede ${branchName} está ubicada en:`,
                    branchAddress || "(dirección)",
                    [branchNeighborhood, branchCity].filter(Boolean).join(", "),
                    branchMapsLink ? `🗺️ ${branchMapsLink}` : "",
                    "¡Te esperamos! 🍦",
                  ].filter(Boolean).join("\n")
                : "";

              // Carrito activo viene del bootstrap: cero round-trips extra.
              const activeCartHasItems = Array.isArray(preloadedCart?.items) && (preloadedCart.items as unknown[]).length > 0;
              const activeSessionHasState = hasSessionData(preloadedCart);



              // Historial ya viene del bootstrap. Cero round-trips extra.
              let history: Array<{ role: string; content: string }> = [];
              if (preloadedHistoryPayload && Array.isArray(preloadedHistoryPayload.messages)) {
                history = (preloadedHistoryPayload.messages as unknown[]).filter(
                  (m): m is { role: string; content: string } =>
                    !!m && typeof m === "object"
                    && typeof (m as { role?: unknown }).role === "string"
                    && typeof (m as { content?: unknown }).content === "string"
                );
              }
              history = normalizeHistory(history);
              void logBotEvent(token, conversationId, from, "history_loaded", {
                metadata: { messages: history.length, source: "bootstrap" },
              });

              // 🛡️ CORTOCIRCUITO DE AHORRO DE CRÉDITOS
              // Antes de invocar el modelo (que consume ~13k tokens de input),
              // detectamos mensajes triviales y respondemos deterministamente.
              const shortCircuit = activeSessionHasState || history.length > 0 ? null : shortCircuitReply(text, menuLink, branchName);
              if (shortCircuit) {
                void logBotEvent(token, conversationId, from, "short_circuit_hit", {
                  durationMs: elapsedMs(requestStarted),
                  metadata: { event: shortCircuit.event, replyLength: shortCircuit.reply.length },
                });
                // Fire-and-forget: no bloqueamos la respuesta esperando por las
                // escrituras de mensajes (~200-400 ms cada una).
                void callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "user", _content: text || "[mensaje corto]" });
                if (!shortCircuit.reply) {
                  return json({ reply: null, source: "short_circuit_silent", conversation_id: conversationId }, 200);
                }
                void callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "assistant", _content: shortCircuit.reply });
                void callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });
                return json({
                  reply: shortCircuit.reply,
                  source: "short_circuit",
                  conversation_id: conversationId,
                }, 200);
              }


              // Sabores AGRUPADOS por grupo de modificador (para no mezclar
              // sabores de helado con sabores de jugo, malteadas, etc.)
              const flavorGroups = Array.isArray(ctx.flavor_groups)
                ? ctx.flavor_groups as Array<{ group_name?: string; flavors?: Array<{ name?: string; extra_price?: number | null }> }>
                : [];
              const allProducts = Array.isArray(ctx.products) ? ctx.products as ProductLite[] : [];
              // Reducido de 60 → 20: recorta ~4-6k tokens por request sin afectar precisión.
              const products = selectRelevantProducts(allProducts, text, 12);

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
              const faqs = selectRelevantFaqs(allFaqs, text, 5);
              const faqsBlock = faqs.length > 0
                ? "PREGUNTAS FRECUENTES DE ESTA SEDE (respuestas oficiales — cuando el cliente pregunte algo parecido, usa esta respuesta tal cual, adaptando solo el saludo):\n" +
                  faqs
                    .filter((f) => f.q && f.a)
                    .map((f, i) => `${i + 1}) P: ${String(f.q).trim()}\n   R: ${String(f.a).trim()}`)
                    .join("\n")
                : "";

              const defaultPrompt = [
                `Eres Golosito, el asistente oficial de Heladería Goloso (sede ${branchName}).`,
                "IDENTIDAD: te llamas Golosito. Preséntate SOLO en el primer mensaje ('soy Golosito, tu asistente'). No repitas tu nombre ni el de la heladería en cada respuesta. NUNCA digas 'asistente virtual', 'bot', 'IA', 'chatbot'.",
                "TONO: amable, cercano, cálido y profesional. Español neutro ('con gusto', 'perfecto', 'claro'). PROHIBIDO regionalismos: 'parcero', 'parce', 'pues', 'de una', 'bacano', 'chévere', 'bro', 'mi amor', 'mi rey', 'mijo', 'hágale'.",
                "Usa emojis 🍦🍨✨ con mesura (1 por mensaje máximo, no en cada frase).",
                "",
                "ESTILO — BREVEDAD OBLIGATORIA:",
                "- Respuestas MUY cortas: idealmente 1-3 líneas. Máximo 4 líneas salvo que el cliente pida detalle o sea un resumen de pedido.",
                "- Frases cortas y directas. Nada de párrafos largos ni explicaciones que el cliente no pidió.",
                "- UNA sola pregunta a la vez cuando necesites datos.",
                "- No repitas información ya dada en mensajes previos.",
                "- No saludes ni te presentes en cada mensaje: solo la primera vez.",
                "- No incluyas el link del menú si ya lo enviaste antes en esta conversación.",
                "- Al pedir varios datos (dirección, pago, etc.), usa lista breve con emojis, una línea cada uno.",
                "- Si el cliente ya te dio parte de la info, pide SOLO lo que falte.",
                "- Confirma antes de asumir ('¿te confirmo con dos vasos?').",
                "",
                "PRIORIDAD #1 — MENÚ EN LÍNEA:",
                `- Primera respuesta a un saludo/pregunta general: da la bienvenida de forma cálida SIN mencionar el nombre interno de la sede e invita al menú en una línea. Ejemplo: '¡Hola! 👋🍦 Bienvenido a Heladería Goloso. Mira el menú y realiza tu pedido en menos de un minuto 👉 ${menuLink}'. NUNCA escribas el nombre técnico de la sede (por ejemplo 'GOLOSO SANTA', 'goloso-parque') al cliente.`,
                "- No repitas el enlace en mensajes siguientes.",
                "- Toma pedido por chat solo si el cliente lo pide explícitamente.",
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
                locationBlock,
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
                locationBlock,
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

              // 4) Config de ordering ya viene del bootstrap. Cero round-trips.
              const orderCfg = preloadedOrdering;
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
                "🛑 REGLAS DURAS ANTIRRIESGO (violarlas rechaza la venta):",
                "- NO registres, agregues ni asumas NINGÚN producto por iniciativa propia. Solo agregas al carrito lo que el cliente pidió con palabras claras.",
                "- NO uses add_to_cart hasta que el cliente diga QUÉ producto quiere Y hayas confirmado con él TODOS los modificadores obligatorios (sabor, tamaño, toppings requeridos). Si el producto tiene grupos requeridos y no tienes las opciones elegidas por el cliente, get_modifiers primero y pregúntale con lista clara: 'Para el/la X, ¿qué [sabor/tamaño] eliges? Tenemos: A, B, C'.",
                "- NUNCA elijas un modificador por el cliente. Si duda, ofrece las opciones y espera su respuesta.",
                "- Si el cliente solo saluda, pregunta precios o pide el menú, NO llames add_to_cart. Responde y espera a que él pida.",
                "- Un mensaje ambiguo (\"quiero algo rico\", \"lo de siempre\", \"un helado\") NO es un pedido: pide especificación antes de tocar el carrito.",
                "- Solo llama confirm_order cuando el cliente diga explícitamente SÍ/CONFIRMO/DALE tras ver el resumen completo. Un simple \"ok\" o \"listo\" a media conversación NO confirma.",
                "",
                "PROTOCOLO OBLIGATORIO PARA TOMAR PEDIDOS:",
                "1) Usa search_products para encontrar el producto exacto que pide el cliente (no inventes precios).",
                "2) Si el producto tiene grupos de modificadores, llama get_modifiers, muéstrale al cliente SOLO esas opciones y espera su elección. NO asumas ni pongas por defecto.",
                "3) Cuando tengas producto+modificadores CONFIRMADOS por el cliente+cantidad, llama add_to_cart. Si el servidor responde 'missing_required_modifiers', significa que faltó preguntar: hazlo y vuelve a intentar.",
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

              // 🧠 BLOQUE DE ESTADO CONVERSACIONAL: si hay carrito activo,
              // inyectamos su estado exacto en el system prompt. Esto elimina
              // la causa raíz de "no me figura ningún pedido" y del reinicio
              // del flujo: la IA ve items, datos capturados y qué falta.
              const cartStateBlock = (() => {
                if (!preloadedCart) return "";
                const items = cartItems(preloadedCart);
                const fsmState = String(preloadedCart.fsm_state ?? nextFsmState(preloadedCart));
                const name = fieldText(preloadedCart, "customer_name");
                const addr = fieldText(preloadedCart, "delivery_address");
                const nbh = fieldText(preloadedCart, "delivery_neighborhood");
                const pay = fieldText(preloadedCart, "payment_method");
                const notes = fieldText(preloadedCart, "delivery_notes");
                const otype = effectiveOrderType(preloadedCart);
                const missing = missingCartFields(preloadedCart);
                const hasAny = items.length > 0 || name || addr || nbh || pay;
                if (!hasAny) return "";
                const lines: string[] = [
                  "",
                  "════════ ESTADO ACTUAL DEL PEDIDO EN CURSO (memoria del cliente) ════════",
                  "USA ESTA INFORMACIÓN COMO VERDAD ABSOLUTA. NO vuelvas a saludar. NO envíes el link del menú. NO reinicies el flujo. NO preguntes datos ya listados abajo. NO digas 'no tengo pedido registrado'.",
                  `- Estado FSM actual: ${fsmState}`,
                  `- Tipo: ${otype === "pickup" ? "recoger en tienda" : "domicilio"}`,
                ];
                if (items.length > 0) {
                  lines.push("- Productos en el carrito:");
                  for (const it of items) {
                    const qty = Number(it.qty ?? 1);
                    const nm = String(it.product_name ?? it.name ?? "Producto");
                    const up = Number(it.unit_price ?? 0);
                    const mods = Array.isArray(it.modifiers)
                      ? (it.modifiers as Array<Record<string, unknown>>).map((m) => String(m?.name ?? "")).filter(Boolean).join(", ")
                      : "";
                    const iNotes = String(it.notes ?? "").trim();
                    lines.push(`  • ${qty} × ${nm} — ${fmtCOP(qty * up)}${mods ? ` [${mods}]` : ""}${iNotes ? ` (notas: ${iNotes})` : ""}`);
                  }
                  lines.push(`- Subtotal: ${fmtCOP(Number(preloadedCart.subtotal ?? 0))}`);
                  if (Number(preloadedCart.delivery_fee ?? 0) > 0) lines.push(`- Domicilio: ${fmtCOP(Number(preloadedCart.delivery_fee))}`);
                  lines.push(`- Total: ${fmtCOP(Number(preloadedCart.total ?? 0))}`);
                } else {
                  lines.push("- Productos: (aún sin items — el cliente ya nos dio datos y estamos armando el pedido)");
                }
                if (name) lines.push(`- Nombre: ${name}`);
                if (addr) lines.push(`- Dirección: ${addr}`);
                if (nbh)  lines.push(`- Barrio: ${nbh}`);
                if (pay)  lines.push(`- Pago: ${pay}`);
                if (notes) lines.push(`- Notas: ${notes}`);
                if (missing.length > 0) {
                  lines.push(`- FALTA por capturar: ${missing.join(", ")}. Pregunta SOLO lo que falta, UNA cosa a la vez. NO repitas lo que ya está arriba.`);
                } else if (items.length > 0) {
                    lines.push("- Datos completos. Muestra RESUMEN y pide confirmación explícita antes de llamar confirm_order. Si el cliente acaba de decir sí/confirmo, el servidor confirmará de forma determinística.");
                }
                lines.push("════════════════════════════════════════════════════════════");
                return lines.join("\n");
              })();

              // 🔒 BLOQUE DE PRODUCTO ACTIVO EN CONFIGURACIÓN
              // Si el cliente ya eligió un producto y estamos preguntando sus
              // modificadores (sabores/toppings/tamaño), el modelo DEBE
              // continuar con ESE producto y NO ofrecer alternativas ni
              // cambiar a otra línea (ej.: "Copa Queso" → NO ofrecer "Cono/Vaso").
              const pendingProductBlock = (() => {
                const pp = (preloadedCart && typeof preloadedCart === "object")
                  ? (preloadedCart as Record<string, unknown>).pending_product as { id?: string; name?: string; price?: number } | null | undefined
                  : null;
                if (!pp || !pp.name) return "";
                return [
                  "",
                  "════════ PRODUCTO ACTIVO EN CONFIGURACIÓN ════════",
                  `El cliente YA eligió: "${pp.name}". Estás preguntando/confirmando sus modificadores (sabores, toppings, tamaño, cantidad).`,
                  "REGLAS DURAS:",
                  `- NO cambies el producto. Sigue siempre con "${pp.name}" hasta que se agregue al carrito o el cliente lo cancele explícitamente.`,
                  "- NO ofrezcas presentaciones ni productos alternativos (por ejemplo NO preguntes '¿Cono o Vaso?' si el producto activo es una Copa/Ensalada/Banana Split/Malteada específica).",
                  "- Interpreta las respuestas del cliente (sabores, toppings, cantidades, notas) SIEMPRE como parte de la configuración de ESTE producto.",
                  "- Pregunta ÚNICAMENTE los modificadores obligatorios pendientes de ESTE producto, uno a la vez.",
                  "- Cuando tengas todos los modificadores obligatorios elegidos por el cliente, llama add_to_cart con este product_id exacto.",
                  `- product_id activo: ${pp.id ?? "(desconocido)"} · precio base: $${Math.round(Number(pp.price ?? 0)).toLocaleString("es-CO")}`,
                  "════════════════════════════════════════════════════════════",
                ].join("\n");
              })();

              const finalSystemPrompt = systemPrompt + orderingPromptBlock + cartStateBlock + pendingProductBlock;

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
                      const pid = String(args.product_id ?? "");
                      const r = await callRpc("whatsapp_bot_ai_get_modifiers", { _token: token, _product_id: pid });
                      // 🔒 Persistimos el "producto en configuración" para que
                      // el próximo turno del modelo sepa que el cliente ya
                      // eligió ESE producto y NO ofrezca alternativas
                      // (por ejemplo, no cambiar "Copa Queso" por "Cono/Vaso"
                      // al preguntar sabores).
                      if (r.ok && pid) {
                        const prod = allProducts.find((p) => String(p.id ?? "") === pid);
                        if (prod?.name) {
                          void persistCartPatch(token, from, { pending_product: { id: pid, name: String(prod.name), price: Number(prod.price ?? 0) } });
                        }
                      }
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

                      // Evidencia acumulada de los últimos turnos del cliente:
                      // el flujo real de pedidos es multi-turno (el cliente pide
                      // "un cono de vainilla", el bot pregunta sabores, el cliente
                      // responde "vainilla" y luego "sí"). Si solo miramos el
                      // texto del turno actual, add_to_cart se bloquea en la
                      // confirmación y la conversación se congela. Consolidamos
                      // hasta 6 últimos mensajes del usuario + el texto actual.
                      const recentUserTurns = history
                        .filter((m) => m.role === "user")
                        .slice(-6)
                        .map((m) => m.content)
                        .join(" \n ");
                      const evidenceText = `${recentUserTurns}\n${text}`;
                      if (!productName || !hasRecentProductEvidence(evidenceText, productName)) {
                        return {
                          error: "product_not_requested_recently",
                          message: "El cliente no ha pedido este producto en la conversación reciente. Pregúntale antes de agregarlo.",
                          product_name: productName,
                        };
                      }

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
                      const r = await persistCartPatch(token, from, { items });
                      // Producto agregado con éxito → limpiamos el "producto en
                      // configuración" para no bloquear la siguiente elección
                      // del cliente.
                      if (r.ok) {
                        void persistCartPatch(token, from, { pending_product: null });
                      }
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
                      const r = await persistCartPatch(token, from, patch);
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

                const currentCartRes = await callRpc("whatsapp_bot_ai_cart_get", { _token: token, _phone: from });
                const currentCart = (currentCartRes.ok ? currentCartRes.data : null) as Record<string, unknown> | null;
                const currentItems = cartItems(currentCart);

                if (currentItems.length > 0 && isCancelOrNegativeTurn(text)) {
                  await callRpc("whatsapp_bot_ai_cart_cancel", { _token: token, _phone: from });
                  return `Entendido, cancelé ese pedido en preparación. 🍦\n\nSi quieres, empezamos de nuevo: dime qué producto deseas y lo armamos paso a paso.`;
                }

                // 🎯 FSM Fase 1 — Confirmación DETERMINISTA (sin LLM).
                // Causa raíz del fallo histórico: el modelo, al recibir "sí" o
                // "confirmo" con carrito completo, a veces respondía en texto en
                // lugar de disparar la tool `confirm_order`. Resultado: bucle
                // infinito de "confírmame para registrar". Aquí cerramos el
                // pedido directamente contra el RPC cuando:
                //   - hay items en el carrito,
                //   - no faltan datos (nombre + dirección/barrio si delivery + pago),
                //   - y el turno del cliente ES una confirmación pura.
                if (
                  currentItems.length > 0 &&
                  missingCartFields(currentCart).length === 0 &&
                  isConfirmation(text)
                ) {
                  const confirmRes = await callRpc("whatsapp_bot_ai_cart_confirm", { _token: token, _phone: from });
                  if (confirmRes.ok) {
                    const orderData = (confirmRes.data ?? {}) as Record<string, unknown>;
                    const orderNumber =
                      (orderData.order_number as string | number | undefined) ??
                      (orderData.ticket_number as string | number | undefined) ??
                      null;
                    void logBotEvent(token, conversationId, from, "fsm_deterministic_confirm", {
                      metadata: { orderNumber: orderNumber ?? null },
                    });
                    return orderNumber
                      ? `Tu pedido quedó registrado con el nº ${orderNumber}. 🍦\n\nNuestro equipo lo revisará y te confirmará en unos minutos.`
                      : "Tu pedido quedó registrado. 🍦\n\nNuestro equipo lo revisará y te confirmará en unos minutos.";
                  }
                  // Si falló el RPC, dejamos caer al flujo normal para que la IA
                  // maneje el error con contexto (p.ej. minimum_amount).
                  void logBotEvent(token, conversationId, from, "fsm_deterministic_confirm_failed", {
                    ok: false,
                    metadata: { detail: confirmRes.data },
                  });
                }

                // 🔥 EXTRACTOR MULTI-ENTIDAD: en un solo pase captura TODO lo
                // que el cliente envió junto ("Oscar, Calle 9 #14-59, Bello
                // Horizonte, Nequi" → nombre + dirección + barrio + pago).
                // Antes se procesaba una entidad por turno con else if y por
                // eso el bot volvía a pedir dirección/barrio/pago aunque ya
                // los tuviera. Ahora los detectores corren en paralelo sobre
                // el texto completo Y sobre cada segmento separado por
                // comas/saltos.
                const extracted = extractAllEntitiesFromText(text);
                const patch: Record<string, unknown> = { ...extracted };
                const currentMissing = missingCartFields(currentCart);

                // Si hay carrito activo y el cliente responde con UN dato
                // pelado que responde a lo que estábamos preguntando (nombre,
                // dirección o barrio), el extractor multi-entidad ya lo captó.
                // Solo faltaría el caso extremo en que la respuesta corta no
                // pasó ninguna heurística pero sí lo estábamos preguntando:
                // aquí caemos a asumir que es respuesta directa al último
                // hueco pendiente.
                if (currentItems.length > 0 && !patch.customer_name && !patch.delivery_address && !patch.delivery_neighborhood) {
                  const t = text.trim().replace(/\s+/g, " ");
                  if (currentMissing[0] === "nombre" && looksLikeBareCustomerName(t)) {
                    patch.customer_name = t;
                  } else if (currentMissing[0] === "dirección" && looksLikeBareAddress(t)) {
                    patch.delivery_address = t;
                  } else if (currentMissing[0] === "barrio" && looksLikeBareNeighborhood(t)) {
                    patch.delivery_neighborhood = t;
                  }
                }

                const finalOrderType = String(patch.order_type ?? currentCart?.order_type ?? "delivery");
                if (finalOrderType === "delivery") {
                  patch.delivery_fee = Number(orderCfg?.delivery_fee ?? currentCart?.delivery_fee ?? 0);
                }



                // IMPORTANTE: NO agregamos productos al carrito desde esta
                // ruta operativa. Un match por texto no basta: los productos
                // pueden tener sabores/modificadores obligatorios y el cliente
                // debe elegirlos. Los productos SOLO entran al carrito vía
                // add_to_cart llamado por la IA tras validar modificadores.

                const hasPatch = Object.keys(patch).length > 0;
                const hasCart = currentItems.length > 0;

                // 🧠 MEMORIA CONVERSACIONAL: aunque no exista carrito, si el
                // cliente ya nos dio datos de contacto/entrega, los persistimos
                // en un carrito "vacío" (sin items) para que en el próximo turno
                // la IA los vea y no vuelva a preguntarlos. Esto elimina el
                // bucle "para registrarlo me falta dirección, barrio y pago".
                if (hasPatch && !hasCart) {
                  await callRpc("whatsapp_bot_ai_cart_upsert", { _token: token, _phone: from, _patch: patch });
                  // No devolvemos respuesta: dejamos que la IA continúe con
                  // el contexto enriquecido en el próximo turno o en este mismo.
                  return null;
                }

                const looksLikeOrderTurn = hasPatch || hasCart;
                if (!looksLikeOrderTurn) return null;

                if (hasCart && isAlreadyOrderedTurn(text)) {
                  return buildCartProgressReply(currentCart, fmtCOP, "Todavía no lo veo confirmado. Sigamos con los datos pendientes:");
                }

                if (hasCart && !hasPatch && isGeneralHelpTurn(text)) {
                  return null;
                }

                let cart = currentCart;
                if (hasPatch) {
                  const upsert = await callRpc("whatsapp_bot_ai_cart_upsert", { _token: token, _phone: from, _patch: patch });
                  if (upsert.ok && upsert.data && typeof upsert.data === "object") cart = upsert.data as Record<string, unknown>;
                }

                const items = cartItems(cart);
                // Sin items no hay pedido para resumir/confirmar: dejamos que la
                // IA guíe al cliente (search_products → get_modifiers → add_to_cart).
                if (items.length === 0) return null;

                const missing = missingCartFields(cart);

                // La confirmación SIEMPRE pasa por la IA (tool confirm_order),
                // que aplica guardias completas (nombre, modificadores, etc.).
                // Aquí solo mostramos avance/resumen si falta info.
                if (missing.length > 0) {
                  const hasNewInfo = hasPatch;
                  const shouldLetAiHandle = !hasNewInfo && /[?¿]|\b(cuanto|cuánto|precio|vale|cambiar|cambio|agregar|añadir|poner|quitar)\b/i.test(text);
                  if (shouldLetAiHandle) return null;
                  return buildCartProgressReply(cart, fmtCOP, hasNewInfo ? "Voy actualizando tu pedido." : undefined);
                }
                return null; // datos completos: la IA cierra con el cliente
              };

              const operationalOrderReply = await buildOperationalOrderReply();
              if (operationalOrderReply) {
                // Fire-and-forget: la respuesta al cliente no espera por escrituras.
                void callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "user", _content: text || "[nota de voz]" });
                void callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "assistant", _content: operationalOrderReply });
                void callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });
                void logBotEvent(token, conversationId, from, "operational_order_flow", {
                  durationMs: elapsedMs(requestStarted),
                  metadata: { replyLength: operationalOrderReply.length },
                });
                return json({ reply: operationalOrderReply, source: "operational_order_flow", conversation_id: conversationId }, 200);
              }


              // 5) Llamar a la IA. Ruta preferida: Lovable AI Gateway (créditos de
              // la cuenta, sin límite gratuito diario). Si Lovable no está
              // configurado o falla, caemos a Gemini directo con la GEMINI_API_KEY
              // personal (cuota gratuita) como respaldo. Esto elimina el bloqueo
              // por HTTP 429 que dejaba al bot respondiendo siempre el fallback
              // genérico "Sigo contigo".
              const lovableKey = process.env.LOVABLE_API_KEY;
              const geminiKey = process.env.GEMINI_API_KEY;
              if (!lovableKey && !geminiKey) {
                const reply = fallbackOrderReply(text, menuLink, orderingEnabled, false, branchName);
                await logBotEvent(token, conversationId, from, "ai_not_configured_operational", {
                  ok: false,
                  metadata: { orderingEnabled },
                });
                return json({ error: "ai_not_configured", reply, source: "operational_no_ai_key", conversation_id: conversationId }, 200);
              }

              // Preflight de cuota Gemini SOLO cuando no hay Lovable: si vamos a
              // depender exclusivamente de la key personal de Gemini y su cuota
              // gratuita ya se agotó, evitamos la llamada y contestamos operativo.
              if (!lovableKey && geminiKey) {
                const q = await callRpc("gemini_quota_status", {});
                const qData = Array.isArray(q.data) ? q.data[0] : q.data;
                const exhausted = Boolean((qData as { exhausted?: boolean } | null)?.exhausted);
                if (exhausted) {
                  const reply = fallbackOrderReply(text, menuLink, orderingEnabled, false, branchName);
                  await logBotEvent(token, conversationId, from, "gemini_quota_exhausted_skip_ai", {
                    ok: false,
                    metadata: qData ?? null,
                  });
                  void callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "user", _content: text || "[nota de voz]" });
                  void callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "assistant", _content: reply });
                  void callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });
                  return json({
                    reply,
                    source: "quota_exhausted_operational_no_lovable_credits",
                    warning: "gemini_quota_exhausted",
                    conversation_id: conversationId,
                  });
                }
              }

              type AiProvider = {
                name: "lovable" | "gemini_direct";
                url: string;
                headers: Record<string, string>;
                primaryModel: string;
                fallbackModel: string;
              };
              const providers: AiProvider[] = [];
              if (lovableKey) {
                providers.push({
                  name: "lovable",
                  url: "https://ai.gateway.lovable.dev/v1/chat/completions",
                  headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
                  primaryModel: "google/gemini-3.6-flash",
                  fallbackModel: "google/gemini-3.1-flash-lite",
                });
              }
              if (geminiKey) {
                providers.push({
                  name: "gemini_direct",
                  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                  headers: { Authorization: `Bearer ${geminiKey}`, "Content-Type": "application/json" },
                  primaryModel: "gemini-2.0-flash",
                  fallbackModel: "gemini-2.0-flash-lite",
                });
              }

              type ChatMsg = { role: string; content?: unknown; tool_call_id?: string; name?: string; tool_calls?: unknown[] };
              const messages: ChatMsg[] = [
                { role: "system", content: finalSystemPrompt },
                ...history.map((m) => ({ role: m.role, content: m.content })),
                { role: "user", content: userContent },
              ];

              const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
              const callAiOnce = async (provider: AiProvider, model: string, timeoutMs = AI_CALL_TIMEOUT_MS) => {
                const bodyReq: Record<string, unknown> = {
                  model, messages, max_tokens: 800, temperature: 0.6,
                };
                if (orderingTools.length > 0) {
                  bodyReq.tools = orderingTools;
                  bodyReq.tool_choice = "auto";
                }
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                  return await fetch(provider.url, {
                    method: "POST",
                    headers: provider.headers,
                    body: JSON.stringify(bodyReq),
                    signal: controller.signal,
                  });
                } finally {
                  clearTimeout(timer);
                }
              };

              // Intenta primario+fallback dentro del mismo provider. Devuelve OK inmediato,
              // o la última Response si todos los intentos fallan.
              const callAiWithProvider = async (provider: AiProvider) => {
                const models = [provider.primaryModel, provider.fallbackModel];
                const backoffs = [200, 500];
                let lastResponse: Response | null = null;
                let lastError: unknown;
                for (let m = 0; m < models.length; m += 1) {
                  const model = models[m];
                  for (let attempt = 0; attempt < 2; attempt += 1) {
                    const remaining = remainingAiBudget(requestStarted, 3_000);
                    if (remaining < 2_500) {
                      if (lastResponse) return lastResponse;
                      throw lastError instanceof Error ? lastError : new Error("ai_budget_exhausted");
                    }
                    try {
                      const response = await callAiOnce(provider, model, Math.min(AI_CALL_TIMEOUT_MS, remaining));
                      lastResponse = response;
                      if (response.ok) return response;
                      if (response.status === 404) break; // modelo no disponible → siguiente
                      if (response.status !== 429 && response.status < 500) return response;
                      await pause(backoffs[attempt] ?? 1500);
                    } catch (error) {
                      lastError = error;
                      await pause(backoffs[attempt] ?? 1500);
                    }
                  }
                }
                if (lastResponse) return lastResponse;
                throw lastError instanceof Error ? lastError : new Error("ai_fetch_failed");
              };

              // Failover cruzado entre providers: si Lovable Gateway se satura o
              // devuelve 429/402/5xx, intenta Gemini directo (y viceversa).
              const callAi = async () => {
                let lastResponse: Response | null = null;
                let lastError: unknown;
                let lastProvider: AiProvider | null = null;
                for (const provider of providers) {
                  try {
                    const response = await callAiWithProvider(provider);
                    lastProvider = provider;
                    if (response.ok) return { response, provider };
                    if (response.status === 429 || response.status === 402 || response.status >= 500) {
                      lastResponse = response;
                      await logBotEvent(token, conversationId, from, "ai_provider_failover", {
                        ok: false,
                        error: `HTTP ${response.status}`,
                        metadata: { provider: provider.name },
                      });
                      continue;
                    }
                    return { response, provider };
                  } catch (error) {
                    lastError = error;
                    await logBotEvent(token, conversationId, from, "ai_provider_exception", {
                      ok: false,
                      error,
                      metadata: { provider: provider.name },
                    });
                  }
                }
                if (lastResponse) {
                  return { response: lastResponse, provider: lastProvider ?? providers[providers.length - 1] };
                }
                throw lastError instanceof Error ? lastError : new Error("ai_all_providers_failed");
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
                let usedProvider: AiProvider;
                try {
                  const attempt = await callAi();
                  aiResp = attempt.response;
                  usedProvider = attempt.provider;
                } catch (error) {
                  lastErr = trimForLog(error, 500);
                  await logBotEvent(token, conversationId, from, "ai_request_exception", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error,
                    metadata: { round, providers: providers.map((p) => p.name) },
                  });
                  break;
                }
                if (aiResp.status === 429) {
                  lastErr = "ai_rate_limited_after_retries";
                  await logBotEvent(token, conversationId, from, "ai_rate_limited", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: lastErr,
                    metadata: { round, provider: usedProvider.name },
                  });
                  break;
                }
                if (aiResp.status === 402) {
                  lastErr = "ai_credits_exhausted";
                  await logBotEvent(token, conversationId, from, "ai_credits_exhausted", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: lastErr,
                    metadata: { round, provider: usedProvider.name },
                  });
                  break;
                }
                if (!aiResp.ok) {
                  const detail = await aiResp.text().catch(() => "");
                  lastErr = detail.slice(0, 500) || `HTTP ${aiResp.status}`;
                  await logBotEvent(token, conversationId, from, "ai_http_failed", {
                    ok: false,
                    durationMs: elapsedMs(aiStarted),
                    error: lastErr,
                    metadata: { round, status: aiResp.status, provider: usedProvider.name },
                  });
                  break;
                }
                const aiData = await aiResp.json().catch(() => null) as {
                  choices?: Array<{ finish_reason?: string; message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
                } | null;
                if (usedProvider.name === "gemini_direct") void trackGeminiCall("whatsapp_bot");

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
                const progressReply = await buildOperationalOrderReply();
                finalReply = progressReply ?? fallbackOrderReply(text, menuLink, orderingEnabled, history.length > 0, branchName);
                lastErr = lastErr ?? `fallback_used(finish=${lastFinishReason ?? "?"})`;
                await logBotEvent(token, conversationId, from, "operational_fallback_used", {
                  ok: false,
                  error: lastErr,
                  metadata: { finishReason: lastFinishReason },
                });
              } else if (sameReply(finalReply, fallbackOrderReply(text, menuLink, orderingEnabled, true, branchName))) {
                const progressReply = await buildOperationalOrderReply();
                if (progressReply) {
                  finalReply = progressReply;
                  lastErr = lastErr ?? "generic_reply_replaced_with_cart_progress";
                  await logBotEvent(token, conversationId, from, "generic_reply_replaced_with_cart_progress", {
                    metadata: { finishReason: lastFinishReason },
                  });
                }
              }

              // 6-7) Persistir turno + registrar uso. Fire-and-forget: ninguna
              // de estas escrituras afecta el texto que ve el cliente.
              const userLog = text && text.length > 0 ? text : "[nota de voz]";
              void callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "user", _content: userLog });
              void callRpc("whatsapp_bot_ai_save_message", { _token: token, _phone: from, _role: "assistant", _content: finalReply });
              void callRpc("whatsapp_bot_ai_record_reply", { _token: token, _phone: from });

              void logBotEvent(token, conversationId, from, "request_completed", {
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
          const action = typeof body?.action === "string" ? body.action : "unknown";
          if (action === "ai_reply" || action === "incoming") {
            return json({
              error: "server_error",
              detail: message,
              reply: fallbackOrderReply(String(body?.text ?? body?.message ?? ""), DEFAULT_MENU_LINK, true),
              source: "operational_error_fallback",
            }, 200);
          }
          return json({ error: "server_error", detail: message }, 500);
        }
      },
    },
  },
});
