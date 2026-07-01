import { formatMoney } from "@/lib/format";

interface Sale {
  ticket_number: number;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  total: number;
  payment_method: string;
  payment_details?: Record<string, unknown> | null;
  notes?: string | null;
}

interface Business {
  name?: string | null;
  nequi_number?: string | null;
  bancolombia_account?: string | null;
}

/**
 * Build a WhatsApp text message for the courier with all the info they need
 * to deliver: customer, address, phone and payment instructions.
 */
export function buildCourierMessage(sale: Sale, business?: Business): string {
  const method = (sale.payment_method || "").toLowerCase();
  const details = (sale.payment_details ?? {}) as Record<string, unknown>;
  const cashReceived = Number(details.cash_received ?? 0);
  const change = cashReceived > sale.total ? cashReceived - sale.total : 0;

  const lines: string[] = [];
  lines.push(`🛵 *NUEVO DOMICILIO* #${sale.ticket_number}`);
  if (business?.name) lines.push(`_${business.name}_`);
  lines.push("");
  lines.push(`👤 *${(sale.customer_name || "Sin nombre").toUpperCase()}*`);
  if (sale.customer_phone) lines.push(`📞 ${sale.customer_phone}`);
  const address = [sale.delivery_address, sale.delivery_neighborhood].filter(Boolean).join(" · ");
  if (address) lines.push(`📍 ${address.toUpperCase()}`);
  lines.push("");
  lines.push(`💵 *TOTAL:* ${formatMoney(sale.total)}`);
  lines.push(`💳 *PAGO:* ${(sale.payment_method || "").toUpperCase()}`);

  if (method.includes("efectivo")) {
    if (cashReceived > 0) {
      lines.push(`   Paga con: ${formatMoney(cashReceived)}`);
      lines.push(`   *DEVUELTA:* ${formatMoney(change)}`);
    } else {
      lines.push(`   ⚠️ Cobrar ${formatMoney(sale.total)} en efectivo`);
    }
  } else if (method.includes("nequi")) {
    lines.push(`   ✅ Pagado por Nequi${business?.nequi_number ? ` (${business.nequi_number})` : ""}`);
  } else if (method.includes("bancolombia") || method.includes("transfer")) {
    lines.push(`   ✅ Pagado por Bancolombia${business?.bancolombia_account ? ` (${business.bancolombia_account})` : ""}`);
  } else if (method.toLowerCase() === "pendiente") {
    lines.push(`   ⚠️ COBRAR EN LA ENTREGA`);
  }

  if (sale.notes) {
    lines.push("");
    lines.push(`📝 ${sale.notes}`);
  }

  lines.push("");
  lines.push("_Enviado desde Goloso POS_");
  return lines.join("\n");
}

/**
 * Opens WhatsApp (web or app) with the message pre-filled for the given phone.
 */
export function openWhatsAppTo(phone: string, message: string) {
  const clean = phone.replace(/\D/g, "");
  const url = `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
