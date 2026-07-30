// NLU determinista: normalización, detección de intención y extracción de entidades.
import { isCancelOrNegativeTurn } from "@/lib/bot/replies";


export function textTokens(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

export function relevanceScore(value: string, words: string[]) {
  const normalized = ` ${textTokens(value).join(" ")} `;
  return words.reduce((score, word) => score + (normalized.includes(` ${word} `) ? 2 : normalized.includes(word) ? 1 : 0), 0);
}

export function selectRelevantFaqs<T extends { q?: string; a?: string }>(faqs: T[], input: string, limit = 35) {
  const words = textTokens(input).slice(0, 16);
  return faqs
    .map((faq, index) => ({ faq, index, score: relevanceScore(`${faq.q ?? ""} ${faq.a ?? ""}`, words) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((item) => item.faq);
}

export function selectRelevantProducts<T extends { name?: string; category?: string | null; is_favorite?: boolean }>(products: T[], input: string, limit = 60) {
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


/**
 * Detección ligera de intención (determinista, sin IA). Sirve para dos cosas:
 * 1) Nunca volver a saludar cuando la conversación ya empezó.
 * 2) Dar un fallback coherente con lo que el cliente pidió si la IA falla.
 */
export type BotIntent =
  | "saludo" | "menu" | "productos" | "sabores" | "precios" | "promociones"
  | "ingredientes" | "horarios" | "pagos" | "sedes" | "domicilio"
  | "pedido" | "agregar" | "modificar" | "eliminar" | "confirmar" | "cancelar"
  | "asesor" | "otro";

export function detectIntent(input: string): BotIntent {
  const n = normalizeText(input);
  if (!n) return "otro";
  if (/\b(asesor|humano|persona real|hablar con alguien|agente)\b/.test(n)) return "asesor";
  if (/\b(cancelar|cancela|anular|ya no quiero|olvidalo)\b/.test(n)) return "cancelar";
  if (/\b(confirmo|confirmar|confirmado|listo asi|asi esta bien|dale pues|si confirmo)\b/.test(n)) return "confirmar";
  if (/\b(quita|quitar|elimina|eliminar|borra|borrar|sin ese)\b/.test(n)) return "eliminar";
  if (/\b(cambia|cambiar|modificar|modifica|en vez de|mejor)\b/.test(n)) return "modificar";
  if (/\b(agrega|agregar|añade|anade|suma|tambien quiero|y ademas)\b/.test(n)) return "agregar";
  if (/\b(pedido|pedir|quiero|deme|dame|comprar|orden|llevar|domicilio|envio|envío)\b/.test(n)) return "pedido";
  if (/\b(horario|hora|abren|cierran|abierto|cerrado)\b/.test(n)) return "horarios";
  if (/\b(pago|pagar|nequi|daviplata|transferencia|efectivo|tarjeta|datafono)\b/.test(n)) return "pagos";
  if (/\b(sede|sedes|sucursal|direccion|ubicacion|donde quedan|donde estan)\b/.test(n)) return "sedes";
  if (/\b(promocion|promo|descuento|oferta|combo|2x1)\b/.test(n)) return "promociones";
  if (/\b(ingrediente|ingredientes|contiene|lleva|azucar|lactosa|gluten)\b/.test(n)) return "ingredientes";
  if (/\b(sabor|sabores)\b/.test(n)) return "sabores";
  if (/\b(precio|precios|cuanto vale|cuanto cuesta|valor)\b/.test(n)) return "precios";
  if (/\b(menu|carta|catalogo|lista)\b/.test(n)) return "menu";
  if (/\b(producto|productos|tienen|venden|helado|malteada|jugo|waffle|copa|cono|banana|brownie|cholado)\b/.test(n)) return "productos";
  if (/^(hola|holaa|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|holi|saludos|que tal|hi|hello)\b/.test(n)) return "saludo";
  return "otro";
}

/** Datos reales de la sede para que las respuestas deterministas no sean vagas. */


export function sameReply(a: string, b: string) {
  return normalizeText(a).replace(/\s+/g, " ") === normalizeText(b).replace(/\s+/g, " ");
}

export function isAlreadyOrderedTurn(input: string) {
  const normalized = normalizeText(input);
  return /\b(ya pedi|ya hice el pedido|ya realice el pedido|ya ordene|ya esta pedido|ya lo pedi|ya lo hice)\b/.test(normalized);
}

export type ProductLite = {
  id?: string;
  name?: string;
  price?: number;
  category?: string | null;
  is_favorite?: boolean;
  modifier_group_ids?: unknown;
};

export type OrderConfigLite = {
  ordering_enabled?: boolean;
  min_amount?: number;
  delivery_fee?: number;
  zones?: string | null;
  transfer_info?: string | null;
  dry_run?: boolean;
} | null;

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s#.,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseQuantity(input: string) {
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

export function detectOrderType(input: string) {
  const normalized = normalizeText(input);
  if (/\b(recoger|recojo|paso por|pasaria|pasaría|para llevar|retiro|heladeria|heladeria)\b/.test(normalized)) return "pickup";
  if (/\b(domicilio|direccion|dirección|enviar|envio|envío|mandar|llevar|barrio)\b/.test(normalized)) return "delivery";
  return null;
}

export function detectPayment(input: string) {
  const normalized = normalizeText(input);
  if (/\b(efectivo|cash)\b/.test(normalized)) return "cash";
  if (/\b(transferencia|transferir|nequi|bancolombia|daviplata|qr)\b/.test(normalized)) return "transfer";
  return null;
}

export function extractField(input: string, labels: string[]) {
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

export function extractCustomerName(input: string) {
  const explicit = extractField(input, ["nombre", "a nombre de", "mi nombre es", "me llamo", "soy"]);
  if (!explicit) return null;
  return explicit.replace(/\b(direccion|dirección|barrio|pago|efectivo|transferencia).*$/i, "").trim();
}

export function looksLikeBareCustomerName(input: string) {
  const raw = input.trim().replace(/\s+/g, " ");
  if (raw.length < 3 || raw.length > 60) return false;
  const normalized = normalizeText(raw);
  if (!normalized || isConfirmation(raw) || isCancelOrNegativeTurn(raw) || isAlreadyOrderedTurn(raw)) return false;
  // Un saludo o una cortesía NUNCA es un nombre de cliente. Esto evitaba que
  // "Hola" o "Buenas noches" quedaran guardados como nombre y dejaran la
  // sesión pegada pidiendo datos para siempre.
  if (/\b(hola|holi|holaa|buenas|buenos|dias|días|tardes|noches|hey|hello|hi|saludos|que tal|qué tal|gracias|ok|okay|listo|si|sí|no|bien|nada|jaja|jeje|ya|hola buenas)\b/.test(normalized)) return false;
  if (detectOrderType(raw) || detectPayment(raw) || extractAddress(raw) || extractNeighborhood(raw)) return false;
  if (/[#@0-9]/.test(raw)) return false;
  if (/\b(quiero|dame|deme|pedido|pedir|producto|helado|malteada|ensalada|vaso|cono|copa|sabor|topping|domicilio|direccion|dirección|barrio|pago|efectivo|transferencia|nequi|bancolombia|menu|menú|precio|cuanto|cuánto|ya|hice|pedi|pedí)\b/.test(normalized)) return false;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  return words.every((word) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.-]{2,}$/.test(word));
}

export function extractAddress(input: string) {
  return extractField(input, ["direccion", "dirección", "dir", "address"]);
}

export function looksLikeBareAddress(input: string) {
  const normalized = normalizeText(input);
  return /\b(calle|callejon|carrera|cra|cl|kr|avenida|av|diagonal|transversal|mz|manzana|casa|apartamento|apto|edificio|torre|via|kilometro|km)\b/.test(normalized)
    || /#|\b\d{1,3}\s*[a-z]?\s*(?:-|#)\s*\d{1,3}\b/i.test(input);
}

export function extractNeighborhood(input: string) {
  return extractField(input, ["barrio", "sector"]);
}

export function looksLikeBareNeighborhood(input: string) {
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
export function extractAllEntitiesFromText(input: string): Record<string, string> {
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

export function isConfirmation(input: string) {
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

export function productScore(product: ProductLite, input: string) {
  const haystack = normalizeText(`${product.name ?? ""} ${product.category ?? ""}`);
  const query = normalizeText(input);
  if (!product.name || !query) return 0;
  if (query.includes(haystack) || haystack.includes(query)) return 100;
  const words = textTokens(String(product.name)).filter((word) => word.length >= 3);
  return words.reduce((score, word) => score + (query.includes(word) ? 12 : 0), 0) + (product.is_favorite ? 2 : 0);
}

export function findRequestedProduct(products: ProductLite[], input: string) {
  return products
    .map((product) => ({ product, score: productScore(product, input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name ?? "").localeCompare(String(b.product.name ?? "")))[0]?.product ?? null;
}

export function hasCurrentTurnProductEvidence(input: string, productName: string) {
  const normalized = normalizeText(input);
  const productWords = textTokens(productName)
    .filter((word) => word.length >= 4 && !["sabor", "sabores", "helado", "helados", "goloso"].includes(word));
  const hasSpecificProductWord = productWords.some((word) => normalized.includes(word));
  const hasGenericOrderWord = /\b(cono|vaso|copa|estrella|malteada|jugo|banana|ensalada|brownie|waffle|cholado|fresas|crema|cremas|litro|medio|paleta|gelatina)\b/.test(normalized);
  const hasOrderVerb = /\b(quiero|dame|deme|pedir|pedido|comprar|agrega|agregar|añade|añadir|anota|llevar|domicilio|recoger)\b/.test(normalized);
  return (hasSpecificProductWord || hasGenericOrderWord) && hasOrderVerb;
}

export function hasRecentProductEvidence(input: string, productName: string) {
  const normalized = normalizeText(input);
  const productWords = textTokens(productName)
    .filter((word) => word.length >= 4 && !["sabor", "sabores", "helado", "helados", "goloso"].includes(word));
  const hasSpecificProductWord = productWords.some((word) => normalized.includes(word));
  const hasGenericOrderWord = /\b(cono|vaso|copa|estrella|malteada|jugo|banana|ensalada|brownie|waffle|cholado|fresas|crema|cremas|litro|medio|paleta|gelatina)\b/.test(normalized);
  const hasOrderVerb = /\b(quiero|dame|deme|pedir|pedido|comprar|agrega|agregar|añade|añadir|anota|llevar|domicilio|recoger)\b/.test(normalized);
  return hasCurrentTurnProductEvidence(input, productName) || ((hasSpecificProductWord || hasGenericOrderWord) && hasOrderVerb);
}

export function isGeneralHelpTurn(input: string) {
  const normalized = normalizeText(input);
  return /\b(hola|buenas|buenos dias|buenas tardes|buenas noches|menu|menú|carta|catalogo|catálogo|precio|precios|horario|abren|cierran|ubicacion|ubicación|direccion|dirección|domicilio|domicilios|foto|fotos|cremas|pagar|pago|transferencia|efectivo|nequi|bancolombia)\b/.test(normalized)
    && !/\b(confirmo|confirmar|si|sí|dale|listo|agrega|agregar|añade|añadir|quita|quitar|cancela|cancelar|nombre|barrio)\b/.test(normalized);
}
