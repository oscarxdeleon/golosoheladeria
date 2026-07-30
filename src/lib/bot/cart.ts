// Estado del pedido (FSM): lectura del carrito, campos faltantes y resúmenes.
import { callRpc } from "@/lib/bot/backend";
import { detectIntent } from "@/lib/bot/nlu";
import { INFO_INTENTS } from "@/lib/bot/replies";


export type CartRecord = Record<string, unknown> | null;

export function cartItems(cart: CartRecord): Array<Record<string, unknown>> {
  const items = cart?.items;
  return Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
}

export function hasCartItems(cart: CartRecord) {
  return cartItems(cart).length > 0;
}

export function fieldText(cart: CartRecord, field: string) {
  return typeof cart?.[field] === "string" ? String(cart[field]).trim() : "";
}

export function effectiveOrderType(cart: CartRecord) {
  const value = fieldText(cart, "order_type").toLowerCase();
  return value === "pickup" ? "pickup" : "delivery";
}

export function missingCartFields(cart: CartRecord) {
  const missing: string[] = [];
  if (!fieldText(cart, "customer_name")) missing.push("nombre");
  if (effectiveOrderType(cart) === "delivery") {
    if (!fieldText(cart, "delivery_address")) missing.push("dirección");
    if (!fieldText(cart, "delivery_neighborhood")) missing.push("barrio");
  }
  if (!fieldText(cart, "payment_method")) missing.push("método de pago");
  return missing;
}

export function hasPendingProduct(cart: CartRecord) {
  const pending = cart?.pending_product;
  return Boolean(pending && typeof pending === "object" && String((pending as Record<string, unknown>).name ?? "").trim());
}

export function hasSessionData(cart: CartRecord) {
  return hasCartItems(cart)
    || hasPendingProduct(cart)
    || Boolean(fieldText(cart, "customer_name"))
    || Boolean(fieldText(cart, "delivery_address"))
    || Boolean(fieldText(cart, "delivery_neighborhood"))
    || Boolean(fieldText(cart, "payment_method"));
}

export function nextFsmState(cart: CartRecord) {
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


export function summarizeCart(cart: Record<string, unknown> | null, fmtCOP: (n: number) => string) {
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

export function buildCartProgressReply(cart: CartRecord, fmtCOP: (n: number) => string, intro?: string) {
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

/**
 * Respaldo cuando hay un pedido realmente en curso. REGLA CLAVE: la intención
 * actual del cliente manda. Si pregunta algo informativo (saludo, menú,
 * horarios, precios...), devolvemos null para responder a eso y NO repetir el
 * estado del pedido. Además, sin productos en el carrito nunca se contesta
 * "me falta X": eso era lo que producía el bucle infinito.
 */
export function buildActiveSessionFallback(cart: CartRecord, fmtCOP: (n: number) => string, input = "") {
  const intent = detectIntent(input);
  if (INFO_INTENTS.includes(intent)) return null;

  if (hasCartItems(cart)) {
    return buildCartProgressReply(cart, fmtCOP, "Sigo con tu pedido en curso.")
      ?? "Sigo con tu pedido en curso. 🍦 ¿Confirmas para registrarlo?";
  }
  if (hasPendingProduct(cart)) {
    const pending = cart?.pending_product as Record<string, unknown>;
    const productName = String(pending?.name ?? "ese producto").trim() || "ese producto";
    return `Sigo con ${productName}. 🍦 ¿Qué sabor, topping o detalle quieres agregarle?`;
  }
  // Sin items no hay pedido que continuar: que responda la intención real.
  return null;
}


export async function persistCartPatch(token: string, phone: string, patch: Record<string, unknown>) {
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
