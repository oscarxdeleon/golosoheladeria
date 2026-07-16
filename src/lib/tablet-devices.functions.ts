import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Solo administradores pueden gestionar tablets");
}

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const provisionTablet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({
      branch_id: z.string().uuid(),
      label: z.string().trim().min(1).max(60),
    }).parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: branch, error: bErr } = await supabaseAdmin
      .from("branches").select("id, name, slug").eq("id", data.branch_id).maybeSingle();
    if (bErr || !branch) throw new Error("Sede no encontrada");

    const token = randomToken(24);
    const shortId = token.slice(0, 8);
    const email = `tablet-${branch.slug ?? "sede"}-${shortId}@goloso.local`;
    const password = randomToken(16);
    const fullName = `Tablet ${data.label} · ${branch.name}`;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, tablet: true, branch_id: branch.id },
    });
    if (createErr || !created.user) throw new Error(createErr?.message ?? "No se pudo crear usuario tablet");
    const userId = created.user.id;

    await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: fullName,
      email,
      branch_id: branch.id,
      active: true,
    });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "mesero" });

    const { data: row, error: insErr } = await supabaseAdmin.from("tablet_devices").insert({
      branch_id: branch.id,
      label: data.label,
      token,
      user_id: userId,
      email,
      password,
      active: true,
    }).select("id, token").single();
    if (insErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(insErr.message);
    }
    return { id: row.id, token: row.token };
  });

export const deleteTablet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: dev } = await supabaseAdmin.from("tablet_devices").select("user_id").eq("id", data.id).maybeSingle();
    if (dev?.user_id) await supabaseAdmin.auth.admin.deleteUser(dev.user_id);
    await supabaseAdmin.from("tablet_devices").delete().eq("id", data.id);
    return { ok: true };
  });
