import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deployToVercel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Solo administradores pueden desplegar en Vercel");

    const hookUrl = process.env["VERCEL_DEPLOY_HOOK"];
    if (!hookUrl) throw new Error("No está configurado VERCEL_DEPLOY_HOOK");

    const res = await fetch(hookUrl, { method: "POST" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vercel respondió ${res.status}: ${text.slice(0, 200)}`);
    }

    return { ok: true as const, status: res.status };
  });
