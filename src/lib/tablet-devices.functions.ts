import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Registra una tablet asociada a un mesero existente.
 * No crea usuarios nuevos ni usa service-role. El admin elige un mesero ya
 * creado en la sección Usuarios y guarda su contraseña actual para que la
 * tablet pueda auto-loguearse. La política RLS "admins manage tablet_devices"
 * garantiza que solo admins pueden insertar.
 */
export const provisionTablet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      branch_id: z.string().uuid(),
      label: z.string().trim().min(1).max(60),
      email: z.string().trim().email().toLowerCase(),
      password: z.string().min(1).max(200),
      user_id: z.string().uuid().optional(),
    }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const token = randomToken(24);
    const { data: row, error } = await context.supabase
      .from("tablet_devices")
      .insert({
        branch_id: data.branch_id,
        label: data.label,
        token,
        email: data.email,
        password: data.password,
        user_id: data.user_id ?? null,
        active: true,
      })
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, token: row.token };
  });

export const deleteTablet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("tablet_devices").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
