// Respuestas deterministas: saludo operativo, fallbacks y cortocircuitos sin IA.
import { BotIntent, detectIntent, normalizeText, sameReply } from "@/lib/bot/nlu";


export function operationalReply(menuLink: string, takingOrders = false, _branchName?: string) {
  // Nunca exponemos el nombre interno de la sede al cliente en el saludo.
  // El nombre se usa solo internamente para menú/horarios/config.
  if (takingOrders) {
    return `¡Hola! 👋🍦 Bienvenido a Heladería Goloso. Cuéntame qué te provoca y lo pedimos.\n\nMenú 👉 ${menuLink}`;
  }
  return `¡Hola! 👋🍦 Bienvenido a Heladería Goloso. Mira el menú y realiza tu pedido en menos de un minuto 👉 ${menuLink}`;
}

// Dominio público oficial del menú (el que ven los clientes en WhatsApp).
export const PUBLIC_MENU_BASE = "https://golosoheladeria.vercel.app";
export const DEFAULT_MENU_LINK = `${PUBLIC_MENU_BASE}/menu`;

export function normalizeMenuLink(value: unknown, fallback = DEFAULT_MENU_LINK) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return raw
    .replace(/https:\/\/golosoheladeria\.lovable\.app/gi, PUBLIC_MENU_BASE)
    .replace(/https:\/\/id-preview--[a-z0-9-]+\.lovable\.app/gi, PUBLIC_MENU_BASE);
}

export type BranchInfo = {
  menuLink: string;
  address?: string;
  hours?: string;
  maps?: string;
  phone?: string;
};

/**
 * Respuesta de respaldo cuando la IA no pudo contestar. Solo saluda si la
 * conversación es NUEVA; si ya hay contexto, responde según la intención
 * detectada sin repetir bienvenida ni reiniciar el flujo.
 */
export function fallbackOrderReply(
  input: string,
  menuLink: string,
  takingOrders: boolean,
  hasHistory = false,
  branchName?: string,
  info?: BranchInfo,
) {
  if (!hasHistory) return operationalReply(menuLink, takingOrders, branchName);

  const location = info?.address
    ? `📍 Estamos en ${info.address}${info.maps ? `\n🗺️ ${info.maps}` : ""}`
    : null;

  switch (detectIntent(input)) {
    case "menu":
    case "productos":
      return `Claro 😊 aquí tienes todo con fotos y precios actualizados 👉 ${menuLink}`;
    case "precios":
      return "Dime cuál producto te interesa y te confirmo su precio exacto. 🍦";
    case "promociones":
      return `Las promociones vigentes las ves aquí 👉 ${menuLink}`;
    case "sabores":
      return "¿Para cuál producto quieres conocer los sabores disponibles? 🍦";
    case "ingredientes":
      return "Cuéntame de cuál producto quieres saber los ingredientes y te confirmo. 🍦";
    case "horarios":
      return info?.hours
        ? `Nuestro horario de hoy es ${info.hours}. 🍦`
        : "Estamos atendiendo ahora mismo. ¿Lo quieres a domicilio o para recoger?";
    case "pagos":
      return "Recibimos efectivo y transferencia. ¿Cómo prefieres pagar tu pedido?";
    case "sedes":
    case "domicilio":
      return location ?? "Con gusto te ayudo. ¿Prefieres domicilio o recoger en tienda?";
    case "asesor":
      return "Claro, en un momento un asesor de Heladería Goloso continúa contigo por este mismo chat. 🙌";
    case "cancelar":
      return "Listo, cancelé lo que teníamos en curso. Cuando quieras empezamos de nuevo. 🍦";
    case "confirmar":
      return "Perfecto, déjame verificar tu pedido y te confirmo en un momento. ✅";
    case "saludo":
      return "¡Hola de nuevo! 🍦 ¿Qué te provoca hoy?";
    case "pedido":
    case "agregar":
    case "modificar":
    case "eliminar":
      return "Con mucho gusto tomo tu pedido. ¿Qué producto y cuántos?";
    default:
      return "Cuéntame qué necesitas y te ayudo con tu pedido. 🍦";
  }
}

/** Intenciones informativas: NUNCA deben ser tapadas por el estado del pedido. */
export const INFO_INTENTS: BotIntent[] = [
  "saludo", "menu", "productos", "precios", "sabores", "promociones",
  "ingredientes", "horarios", "pagos", "sedes", "asesor",
];

/**
 * Anti-repetición: si el texto calculado ya se envió en alguno de los últimos
 * turnos del asistente, devolvemos una variante para no quedar en bucle.
 */
export function avoidRepeatedReply(
  reply: string,
  history: Array<{ role: string; content: string }>,
  _menuLink: string,
) {
  const lastAssistants = [...history]
    .reverse()
    .filter((m) => m.role === "assistant")
    .slice(0, 3)
    .map((m) => m.content);
  if (!lastAssistants.some((prev) => prev && sameReply(reply, prev))) return reply;
  // Nunca decimos "no te entendí": ofrecemos avanzar la venta con una
  // pregunta útil y variada para no repetir el mismo texto.
  const nudges = [
    "¿Te muestro nuestros helados, malteadas o ensaladas de frutas? 🍦",
    "Cuéntame qué se te antoja y te digo el precio al instante 😊",
    "¿Lo quieres para recoger en la sede o a domicilio?",
    "Puedo recomendarte lo más pedido de hoy, ¿te cuento? 🍨",
  ];
  return nudges[Math.floor(Math.random() * nudges.length)] as string;
}

/**
 * Toma un mensaje de bienvenida configurado por el administrador en Ajustes →
 * WhatsApp Bot y lo devuelve EXACTAMENTE como fue escrito (emojis, saltos de
 * línea y formato incluidos). Si hay varios, elige uno al azar. Solo se agrega
 * el link del menú cuando el mensaje configurado no incluye ningún enlace.
 */
export function pickWelcomeMessage(messages: unknown, menuLink: string): string {
  const list = Array.isArray(messages)
    ? messages.map((m) => String(m ?? "")).filter((m) => m.trim().length > 0)
    : [];
  if (list.length === 0) {
    return `¡Hola! 🍦 Mira el menú y pide en menos de un minuto 👉 ${menuLink}`;
  }
  const chosen = list[Math.floor(Math.random() * list.length)];
  const withLink = chosen.replace(/\{\{?\s*menu(_link)?\s*\}?\}/gi, menuLink);
  return /https?:\/\//i.test(withLink) ? withLink : `${withLink}\n\n👉 ${menuLink}`;
}


export function shortCircuitReply(
  input: string,
  menuLink: string,
  branchName?: string,
  welcomeMessages?: unknown,
): { reply: string; event: string | null } | null {
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

  // Saludos cortos → bienvenida configurada en el POS (aleatoria si hay varias).
  if (/^(hola|holaa|holaaa|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|holi|saludos|que tal|hi|hello)$/.test(normalized)) {
    return {
      reply: pickWelcomeMessage(welcomeMessages, menuLink),
      event: "welcome",
    };
  }

  return null;
}

export function isCancelOrNegativeTurn(input: string) {
  const normalized = normalizeText(input);
  return /\b(cancelar|cancela|borra|borrar|elimina|eliminar|quitar|quita|no era|no quiero|ya no|mejor no|dejalo asi|déjalo así|empezar de nuevo|nuevo pedido)\b/.test(normalized)
    || /^(no|nop|cancelar|cancela)$/i.test(normalized);
}


