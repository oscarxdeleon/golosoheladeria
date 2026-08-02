// Opciones interactivas (botones / listas) para las conversaciones de WhatsApp.
//
// WhatsApp, a través de Evolution API (Baileys), soporta botones y listas,
// pero NO todos los dispositivos los renderizan. Por eso el envío siempre es
// progresivo: se intenta botones → lista → texto numerado. El cliente siempre
// ve las opciones, aunque su WhatsApp no soporte mensajes interactivos.

import { normalizeText } from "@/lib/bot/nlu";

export type QuickOption = { id: string; label: string };
export type QuickReplySet = { options: QuickOption[]; footer?: string };

const ORDER_TYPE: QuickOption[] = [
  { id: "pickup", label: "🛍️ Para llevar" },
  { id: "delivery", label: "🛵 A domicilio" },
  { id: "menu", label: "🍨 Ver menú" },
];

const PAYMENT: QuickOption[] = [
  { id: "efectivo", label: "💵 Efectivo" },
  { id: "tarjeta", label: "💳 Tarjeta" },
  { id: "nequi", label: "📱 Nequi" },
  { id: "bancolombia", label: "🏦 Bancolombia" },
];

const CATEGORIES: QuickOption[] = [
  { id: "helados", label: "🍦 Helados" },
  { id: "malteadas", label: "🥤 Malteadas" },
  { id: "ensaladas", label: "🍓 Ensaladas" },
  { id: "postres", label: "🍰 Postres" },
  { id: "bebidas", label: "🥤 Bebidas" },
];

const CONFIRM: QuickOption[] = [
  { id: "confirmar", label: "✅ Confirmar pedido" },
  { id: "agregar", label: "➕ Agregar algo más" },
  { id: "cancelar", label: "❌ Cancelar" },
];

const HELP: QuickOption[] = [
  { id: "menu", label: "🍨 Ver menú" },
  { id: "pedido", label: "🛵 Hacer pedido" },
  { id: "info", label: "📍 Información" },
];

/**
 * Deduce, a partir del texto que el asistente va a enviar, qué opciones
 * cliqueables tienen sentido. Nunca cambia el texto: solo lo acompaña.
 */
export function deriveQuickOptions(reply: string, branchOptions?: QuickOption[]): QuickReplySet | null {
  const t = normalizeText(reply);
  if (!t) return null;

  if (/(domicilio o (para )?(recoger|llevar))|como (deseas|quieres) recibir|recoges o te lo enviamos/.test(t)) {
    return { options: ORDER_TYPE };
  }
  if (/(como (prefieres|vas a|deseas) pagar)|(metodo|medio) de pago|forma de pago/.test(t)) {
    return { options: PAYMENT };
  }
  if (/(que (categoria|tipo)|que te provoca|que se te antoja|que deseas pedir)/.test(t)) {
    return { options: CATEGORIES };
  }
  if (/(confirmo (tu|el) pedido|confirmas|deseas confirmar|algo mas para tu pedido)/.test(t)) {
    return { options: CONFIRM };
  }
  if (/(cual sede|en que sede|a que sede)/.test(t) && branchOptions?.length) {
    return { options: branchOptions };
  }
  if (/(en que te puedo (ayudar|colaborar)|como te puedo ayudar|bienvenido a heladeria goloso)/.test(t)) {
    return { options: HELP };
  }
  return null;
}

/** Texto de respaldo con las opciones numeradas (WhatsApp sin interactivos). */
export function optionsAsText(reply: string, set: QuickReplySet) {
  const list = set.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  return `${reply}\n\n${list}\n\n_Responde con el número o el nombre de la opción._`;
}

/**
 * Traduce una respuesta corta del cliente ("2", "a domicilio", "💵 Efectivo")
 * al texto de la opción elegida, para que el motor la entienda como si la
 * hubiera escrito.
 */
export function resolveOptionReply(input: string, set: QuickReplySet | null) {
  if (!set) return null;
  const raw = input.trim();
  const asNumber = Number(raw.replace(/[^\d]/g, ""));
  if (/^\s*\d\s*[.)-]?\s*$/.test(raw) && asNumber >= 1 && asNumber <= set.options.length) {
    return set.options[asNumber - 1].label;
  }
  const norm = normalizeText(raw);
  const hit = set.options.find((o) => normalizeText(o.label) === norm || o.id === norm);
  return hit ? hit.label : null;
}
