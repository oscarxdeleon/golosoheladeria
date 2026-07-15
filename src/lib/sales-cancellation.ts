import { supabase } from "@/integrations/supabase/client";

export interface CancelSaleResult {
  ok?: boolean;
  sale_id?: string;
  ticket_number?: number;
  previous_status?: string | null;
  new_status?: string | null;
  already_cancelled?: boolean;
  table_released?: boolean;
}

export async function cancelSaleRequest(input: {
  saleId: string | null | undefined;
  reason: string;
}): Promise<CancelSaleResult> {
  const saleId = String(input.saleId ?? "").trim();
  const reason = String(input.reason ?? "").trim();

  if (!saleId) throw new Error("No hay un pedido activo para cancelar");
  if (reason.length < 3) throw new Error("El motivo debe tener al menos 3 caracteres");

  // Llamar `supabase.rpc(...)` directamente. Si se extrae `rpc` a una
  // constante, el método pierde su contexto interno y falla leyendo `rest`.
  const { data, error } = await supabase.rpc("cancel_sale", {
    _sale_id: saleId,
    _reason: reason,
  });

  if (error) throw new Error(error.message || "No se pudo cancelar el pedido");
  return (data ?? { ok: true, sale_id: saleId }) as CancelSaleResult;
}
