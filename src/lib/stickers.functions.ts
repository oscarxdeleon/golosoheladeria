import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getStickerSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage.from("stickers").createSignedUrl(data.path, 60 * 60);
    if (error || !signed?.signedUrl) throw error ?? new Error("signed_url_failed");
    return { url: signed.signedUrl };
  });

export const listBranchStickers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { branchId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("whatsapp_stickers")
      .select("*")
      .eq("branch_id", data.branchId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });

export const updateSticker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: { event_key?: string; active?: boolean; sort_order?: number; label?: string } }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("whatsapp_stickers")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
