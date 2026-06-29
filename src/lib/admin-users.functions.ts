import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLE = z.enum(["admin", "cajero", "mesero", "domiciliario"]);

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Solo administradores pueden gestionar usuarios");
}

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      email: z.string().trim().email(),
      password: z.string().min(6, "Mínimo 6 caracteres"),
      full_name: z.string().trim().min(2),
      role: ROLE,
      branch_id: z.string().uuid().nullable().optional(),
    }).parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (createErr || !created.user) throw new Error(createErr?.message ?? "No se pudo crear el usuario");
    const newId = created.user.id;

    // Profile is auto-created by trigger; upsert metadata
    await supabaseAdmin.from("profiles").upsert({
      id: newId,
      full_name: data.full_name,
      email: data.email,
      branch_id: data.branch_id ?? null,
      active: true,
    });

    // Replace roles (trigger may have inserted a default)
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    await supabaseAdmin.from("user_roles").insert({ user_id: newId, role: data.role });

    return { id: newId };
  });

export const updateAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      user_id: z.string().uuid(),
      full_name: z.string().trim().min(2).optional(),
      role: ROLE.optional(),
      branch_id: z.string().uuid().nullable().optional(),
      active: z.boolean().optional(),
      password: z.string().min(6).optional(),
    }).parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: { full_name?: string; branch_id?: string | null; active?: boolean } = {};
    if (data.full_name !== undefined) patch.full_name = data.full_name;
    if (data.branch_id !== undefined) patch.branch_id = data.branch_id;
    if (data.active !== undefined) patch.active = data.active;
    if (Object.keys(patch).length) {
      await supabaseAdmin.from("profiles").update(patch).eq("id", data.user_id);
    }


    if (data.role) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
      await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
    }

    if (data.password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ user_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    if (data.user_id === context.userId) throw new Error("No puedes eliminar tu propio usuario");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
