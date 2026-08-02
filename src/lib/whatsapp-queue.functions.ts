import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Entrega los mensajes de WhatsApp pendientes de una sede (reportes, pruebas). */
export const flushWhatsappQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string }) => d)
  .handler(async ({ data, context }) => {
    const { flushBranchQueue } = await import("@/lib/whatsapp-queue.server");
    return flushBranchQueue(context.supabase as never, data.branchId, 15);
  });
