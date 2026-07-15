import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const dashboardInput = z.object({
  branchId: z.string().uuid(),
  range: z.enum(["hoy", "ayer", "semana", "mes"]),
  origen: z.string().default("all"),
  pago: z.string().default("all"),
});

export const getSharedDashboardPayload = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => dashboardInput.parse(data))
  .handler(async ({ context, data }) => {
    const { data: payload, error } = await (context.supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc("admin_dashboard_rpc", {
      _branch_id: data.branchId,
      _range: data.range,
      _origen: data.origen,
      _pago: data.pago,
    });

    if (error) throw new Error(error.message);
    return payload ?? {};
  });