import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function hubBase() {
  const env = process.env as Record<string, string | undefined>;
  // Server-only secrets. Never accept VITE_* fallbacks — those get bundled
  // into the client and would leak the Hub API token.
  const url = env.HUB_URL;
  const token = env.HUB_API_TOKEN;
  if (!url || !token) throw new Error("HUB_URL / HUB_API_TOKEN not configured");
  return { url: url.replace(/\/$/, ""), token };
}

async function hubFetch(path: string, init?: RequestInit) {
  const { url, token } = hubBase();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body?.error || `hub_${res.status}`);
  return body;
}

async function persistSession(
  branchId: string,
  data: { status: string; connected_phone?: string | null; last_qr?: string | null; last_error?: string | null },
  userSupabase?: any
) {
  const now = new Date().toISOString();
  const patch: Record<string, any> = {
    branch_id: branchId,
    status: data.status,
    connected_phone: data.connected_phone ?? null,
    last_error: data.last_error ?? null,
    updated_at: now,
  };
  if (data.last_qr !== undefined) {
    patch.last_qr = data.last_qr;
    patch.last_qr_at = data.last_qr ? now : null;
  }
  if (data.status === "connected") patch.last_connected_at = now;
  if (data.status === "disconnected" || data.status === "needs_qr") patch.last_disconnected_at = now;

  // Try service-role first (works on Lovable Cloud). If SUPABASE_SERVICE_ROLE_KEY
  // is not configured (e.g. Vercel deploy without the key), fall back to the
  // authenticated user's client. Never let a persist failure break QR flow.
  try {
    const env = process.env as Record<string, string | undefined>;
    if (env.SUPABASE_SERVICE_ROLE_KEY) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("whatsapp_hub_sessions").upsert(patch, { onConflict: "branch_id" });
      return;
    }
  } catch (e) {
    console.warn("[hub] persistSession admin failed, falling back to user client", e);
  }
  try {
    if (userSupabase) {
      await userSupabase.from("whatsapp_hub_sessions").upsert(patch, { onConflict: "branch_id" });
    }
  } catch (e) {
    console.warn("[hub] persistSession user client failed (non-fatal)", e);
  }
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error || !data) throw new Error("Solo administradores");
}

export const requestBranchHubQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string; reset?: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    let deviceToken: string | null = null;
    try {
      const { data: cfg } = await context.supabase
        .from("whatsapp_bot_config")
        .select("device_token")
        .eq("branch_id", data.branchId)
        .maybeSingle();
      deviceToken = (cfg?.device_token as string | undefined) ?? null;
    } catch (e) {
      console.warn("[hub] no pude leer device_token de la sede", e);
    }
    const env = process.env as Record<string, string | undefined>;
    const posWebhookBase =
      env.POS_PUBLIC_URL ||
      env.PUBLIC_URL ||
      env.VITE_PUBLIC_URL ||
      "https://golosoheladeria.lovable.app";
    const r = await hubFetch(`/api/branch/${data.branchId}/connect`, {
      method: "POST",
      body: JSON.stringify({ deviceToken, posWebhookBase, reset: data.reset === true }),
    });
    await persistSession(data.branchId, { status: r.status || "connecting" }, context.supabase);
    return { ok: true, status: r.status, reset: !!r.reset, hasWebhook: !!r.hasWebhook };
  });

export const resetBranchHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const r = await hubFetch(`/api/branch/${data.branchId}/reset`, { method: "POST" });
    await persistSession(data.branchId, { status: r.status || "connecting", last_qr: null, last_error: null }, context.supabase);
    return { ok: true, status: r.status };
  });

export const getBranchHubStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const r = await hubFetch(`/api/branch/${data.branchId}/status`);
    await persistSession(data.branchId, {
      status: r.status,
      connected_phone: r.phone,
      last_qr: r.qr ?? null,
      last_error: r.lastError ?? null,
    }, context.supabase);
    return {
      status: r.status as string,
      qr: (r.qr as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      pairingCode: (r.pairingCode as string | null) ?? null,
      lastError: (r.lastError as string | null) ?? null,
    };
  });

export const pairBranchHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string; phone: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const phone = String(data.phone).replace(/[^0-9]/g, "");
    if (phone.length < 10) throw new Error("Número inválido (incluye código de país, ej: 573001234567)");
    const r = await hubFetch(`/api/branch/${data.branchId}/pair`, {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
    return { ok: true, code: r.code as string, phone: r.phone as string };
  });

export const logoutBranchHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await hubFetch(`/api/branch/${data.branchId}/logout`, { method: "POST" });
    await persistSession(data.branchId, { status: "disconnected", connected_phone: null, last_qr: null }, context.supabase);
    return { ok: true };
  });

export const sendHubMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string; to: string; text: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    return hubFetch(`/api/send`, {
      method: "POST",
      body: JSON.stringify({ branchId: data.branchId, to: data.to, text: data.text }),
    });
  });
