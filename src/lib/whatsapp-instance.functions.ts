import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readEvolutionEnv } from "@/lib/evolution-env";

// ---------------------------------------------------------------------------
// Instancias WhatsApp administradas por API (Evolution API v2).
// Reemplaza el Hub/Baileys artesanal: una instancia por sede, QR generado por
// el proveedor, webhook automático hacia el POS.
// Todos los secretos viven SOLO en el servidor (nunca VITE_*).
// ---------------------------------------------------------------------------

function api() {
  const url = readEvolutionEnv("EVOLUTION_API_URL");
  const key = readEvolutionEnv("EVOLUTION_API_KEY");
  if (!url || !key) throw new Error("EVOLUTION_API_URL / EVOLUTION_API_KEY no configurados");
  return { url: url.replace(/\/$/, ""), key };
}

function publicBase() {
  return (readEvolutionEnv("POS_PUBLIC_URL") || process.env.PUBLIC_URL || "https://golosoheladeria.lovable.app").replace(/\/$/, "");
}

/** URL limpia: el token ya NO viaja en el query string, va en un header privado. */
function webhookUrl() {
  return `${publicBase()}/api/public/whatsapp-evolution`;
}

/** Token propio de la sede (rotable). Fallback: token global de entorno. */
async function branchWebhookToken(branchId: string, supabase: any): Promise<string> {
  try {
    const { data, error } = await supabase.rpc("whatsapp_evolution_get_token", { _branch_id: branchId });
    if (!error && typeof data === "string" && data.length >= 16) return data;
  } catch (e) {
    console.warn("[evolution] no pude leer el token de la sede", e);
  }
  return readEvolutionEnv("EVOLUTION_WEBHOOK_TOKEN") || "";
}

function webhookConfig(token: string) {
  return {
    enabled: true,
    url: webhookUrl(),
    byEvents: false,
    base64: true,
    headers: {
      "Content-Type": "application/json",
      "x-webhook-token": token,
    },
    events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
  };
}



export function instanceName(branchId: string) {
  return `goloso-${branchId}`;
}

async function evo(path: string, init?: RequestInit & { method?: string }) {
  const { url, key } = api();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: key, ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.response?.message || body?.message || body?.error || `evolution_${res.status}`;
    const err = new Error(Array.isArray(msg) ? msg.join(", ") : String(msg));
    (err as any).status = res.status;
    throw err;
  }
  return body;
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error || !data) throw new Error("Solo administradores");
}

async function persist(
  branchId: string,
  patch: { status: string; connected_phone?: string | null; last_qr?: string | null; last_error?: string | null },
  userSupabase?: any,
) {
  const now = new Date().toISOString();
  const row: Record<string, any> = {
    branch_id: branchId,
    status: patch.status,
    connected_phone: patch.connected_phone ?? null,
    last_error: patch.last_error ?? null,
    updated_at: now,
  };
  if (patch.last_qr !== undefined) {
    row.last_qr = patch.last_qr;
    row.last_qr_at = patch.last_qr ? now : null;
  }
  if (patch.status === "connected") row.last_connected_at = now;
  if (patch.status === "disconnected") row.last_disconnected_at = now;
  try {
    const env = process.env as Record<string, string | undefined>;
    if (env.SUPABASE_SERVICE_ROLE_KEY) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("whatsapp_hub_sessions").upsert(row, { onConflict: "branch_id" });
      return;
    }
  } catch (e) {
    console.warn("[evolution] persist admin falló, uso cliente de usuario", e);
  }
  try {
    if (userSupabase) await userSupabase.from("whatsapp_hub_sessions").upsert(row, { onConflict: "branch_id" });
  } catch (e) {
    console.warn("[evolution] persist usuario falló (no fatal)", e);
  }
}

function mapState(raw: string | null | undefined): string {
  switch ((raw || "").toLowerCase()) {
    case "open": return "connected";
    case "connecting": return "awaiting_qr";
    case "close":
    case "closed": return "disconnected";
    default: return raw ? String(raw) : "disconnected";
  }
}

/** Evolution v2 devuelve el QR en formas distintas según versión/endpoint. */
function extractQr(c: any): { qr: string | null; code: string | null; pairingCode: string | null } {
  const src = c?.qrcode ?? c?.qrCode ?? c;
  let qr: string | null = src?.base64 ?? c?.base64 ?? null;
  if (qr && !String(qr).startsWith("data:")) qr = `data:image/png;base64,${qr}`;
  const rawCode = src?.code ?? c?.code ?? null;
  const code = rawCode && String(rawCode).length > 20 ? String(rawCode) : null;
  const pairingCode = src?.pairingCode ?? c?.pairingCode ?? null;
  return { qr, code, pairingCode };
}

async function ensureInstance(branchId: string, webhookToken: string) {
  const name = instanceName(branchId);
  try {
    await evo(`/instance/connectionState/${encodeURIComponent(name)}`);
    return { name, created: false };
  } catch (e: any) {
    if (e?.status && e.status !== 404) throw e;
  }
  await evo(`/instance/create`, {
    method: "POST",
    body: JSON.stringify({
      instanceName: name,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: webhookConfig(webhookToken),
    }),
  });
  return { name, created: true };
}


/** Estado + QR vigente de la instancia de la sede. */
export const getInstanceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const name = instanceName(data.branchId);
    let state = "disconnected";
    let phone: string | null = null;
    let exists = true;
    try {
      const list = await evo(`/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`);
      const arr = Array.isArray(list) ? list : [list];
      const inst = arr.find((i: any) => (i?.name ?? i?.instance?.instanceName) === name) ?? arr[0];
      if (!inst) exists = false;
      state = mapState(inst?.connectionStatus ?? inst?.instance?.state ?? inst?.state);
      const owner = inst?.ownerJid ?? inst?.owner ?? inst?.instance?.owner ?? null;
      phone = owner ? String(owner).split("@")[0].split(":")[0] : null;
    } catch (e: any) {
      if (e?.status === 404) exists = false;
      else throw e;
    }

    let qr: string | null = null;
    let code: string | null = null;
    let pairingCode: string | null = null;
    if (exists && state !== "connected") {
      try {
        const c = await evo(`/instance/connect/${encodeURIComponent(name)}`);
        const x = extractQr(c);
        qr = x.qr; code = x.code; pairingCode = x.pairingCode;
        if (qr || code) state = "awaiting_qr";
      } catch { /* la instancia puede estar reconectando */ }
    }

    await persist(data.branchId, { status: exists ? state : "no_instance", connected_phone: phone, last_qr: qr ?? code }, context.supabase);
    return { exists, status: exists ? state : "no_instance", qr, code, pairingCode, phone };

  });

/** Crea (si hace falta) la instancia y devuelve un QR nuevo. */
export const connectInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string; force?: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { name } = await ensureInstance(data.branchId);
    if (data.force) {
      try { await evo(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" }); } catch { /* ya estaba cerrada */ }
    }
    // Asegura webhook actualizado (idempotente)
    try {
      await evo(`/webhook/set/${encodeURIComponent(name)}`, {
        method: "POST",
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: webhookUrl(),
            byEvents: false,
            base64: true,
            events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
          },
        }),
      });
    } catch (e) { console.warn("[evolution] webhook/set falló", e); }

    const c = await evo(`/instance/connect/${encodeURIComponent(name)}`);
    const { qr, code, pairingCode } = extractQr(c);
    await persist(data.branchId, { status: qr || code ? "awaiting_qr" : "connecting", last_qr: qr ?? code, last_error: null }, context.supabase);
    return { ok: true, qr, code, pairingCode };
  });

/** Reinicia la instancia sin borrar la sesión. */
export const restartInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const name = instanceName(data.branchId);
    await evo(`/instance/restart/${encodeURIComponent(name)}`, { method: "POST" });
    await persist(data.branchId, { status: "connecting", last_error: null }, context.supabase);
    return { ok: true };
  });

/** Cierra sesión (el teléfono se desvincula) pero conserva la instancia. */
export const disconnectInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const name = instanceName(data.branchId);
    try { await evo(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" }); } catch { /* noop */ }
    await persist(data.branchId, { status: "disconnected", connected_phone: null, last_qr: null }, context.supabase);
    return { ok: true };
  });

/** Elimina por completo la instancia (borra credenciales en el proveedor). */
export const deleteInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const name = instanceName(data.branchId);
    try { await evo(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" }); } catch { /* noop */ }
    await evo(`/instance/delete/${encodeURIComponent(name)}`, { method: "DELETE" });
    await persist(data.branchId, { status: "no_instance", connected_phone: null, last_qr: null, last_error: null }, context.supabase);
    return { ok: true };
  });

/** Envío manual de prueba desde el POS. */
export const sendInstanceMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { branchId: string; to: string; text: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const number = String(data.to).replace(/[^0-9]/g, "");
    if (number.length < 10) throw new Error("Número inválido (incluye código de país)");
    const r = await evo(`/message/sendText/${encodeURIComponent(instanceName(data.branchId))}`, {
      method: "POST",
      body: JSON.stringify({ number, text: data.text }),
    });
    return { ok: true, id: r?.key?.id ?? null };
  });
