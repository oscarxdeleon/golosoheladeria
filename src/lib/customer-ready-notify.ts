// Envía notificación de WhatsApp al cliente cuando su pedido está listo.
// Solo aplica a pedidos de Modo Autopedido (source='kiosk') que hayan
// dejado su número de WhatsApp al hacer el pedido.

const NOTIFIED_KEY = "goloso:ready-notified";

function loadNotified(): Set<string> {
  try {
    const raw = sessionStorage.getItem(NOTIFIED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveNotified(set: Set<string>) {
  try {
    sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(Array.from(set).slice(-200)));
  } catch { /* ignore */ }
}

export function buildReadyMessage(customerName: string | null | undefined): string {
  const name = (customerName ?? "").trim() || "Cliente";
  return `Hola! ${name}, *Tu pedido esta listo!!*`;
}

export interface ReadyNotifySale {
  id: string;
  source?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
}

/**
 * Abre WhatsApp con el mensaje "Tu pedido está listo" si el pedido proviene
 * del Modo Autopedido (kiosk) y tiene teléfono. Devuelve true si se disparó.
 * Debe llamarse desde un handler de clic (gesto de usuario) para no ser
 * bloqueado por el navegador.
 */
export function notifyCustomerReady(sale: ReadyNotifySale): boolean {
  if (!sale) return false;
  if ((sale.source ?? "") !== "kiosk") return false;
  const phone = (sale.customer_phone ?? "").replace(/\D/g, "");
  if (!phone || phone.length < 7) return false;

  const notified = loadNotified();
  if (notified.has(sale.id)) return false;

  const msg = buildReadyMessage(sale.customer_name);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  try {
    window.open(url, "_blank", "noopener,noreferrer");
    notified.add(sale.id);
    saveNotified(notified);
    return true;
  } catch {
    return false;
  }
}
