import { supabase } from "@/integrations/supabase/client";

export type CancelReasonCode =
  | "arrepentimiento"
  | "sin_dinero"
  | "cambio_producto"
  | "demora"
  | "cambio_pago"
  | "otro";

export interface CancelReasonOption {
  code: CancelReasonCode;
  label: string;
  emoji: string;
}

export const CANCEL_REASON_OPTIONS: CancelReasonOption[] = [
  { code: "arrepentimiento", label: "Cliente se arrepintió", emoji: "🙅" },
  { code: "sin_dinero",       label: "Cliente sin dinero suficiente", emoji: "💸" },
  { code: "cambio_producto",  label: "Cliente cambió de producto", emoji: "🔄" },
  { code: "demora",           label: "Demora en preparación", emoji: "⏱️" },
  { code: "cambio_pago",      label: "Cambio de método de pago", emoji: "💳" },
  { code: "otro",             label: "Otro motivo", emoji: "📝" },
];

export interface CancelSaleResult {
  ok?: boolean;
  sale_id?: string;
  ticket_number?: number;
  previous_status?: string | null;
  new_status?: string | null;
  reason_code?: string | null;
  already_cancelled?: boolean;
  table_released?: boolean;
}

export async function cancelSaleRequest(input: {
  saleId: string | null | undefined;
  reason: string;
  reasonCode?: CancelReasonCode | null;
}): Promise<CancelSaleResult> {
  const saleId = String(input.saleId ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  const reasonCode = input.reasonCode ?? null;

  if (!saleId) throw new Error("No hay un pedido activo para cancelar");
  if (reason.length < 3) throw new Error("El motivo debe tener al menos 3 caracteres");

  const { data, error } = await supabase.rpc("cancel_sale", {
    _sale_id: saleId,
    _reason: reason,
    _reason_code: reasonCode,
  });

  if (error) throw new Error(error.message || "No se pudo anular el pedido");
  return (data ?? { ok: true, sale_id: saleId }) as CancelSaleResult;
}
