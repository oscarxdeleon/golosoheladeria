import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Webhook de Evolution API → POS.
// Recibe eventos de las instancias (una por sede), actualiza el estado y
// enruta los mensajes entrantes al asistente ya existente (/api/public/whatsapp-bot).
//
// Seguridad:
//  - El token viaja en el header privado `x-webhook-token` (ya no en la URL).
//  - Cada sede tiene su propio token, guardado en `whatsapp_bot_config`
//    (`evolution_webhook_token`) y rotable desde el POS.
//  - La validación y la resolución del `device_token` ocurren en Postgres
//    (RPC SECURITY DEFINER), sin depender de la clave service_role.
//  - Se acepta `?t=` y el token global de entorno solo como compatibilidad
//    temporal con instancias que aún no se hayan reconfigurado.
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function branchFromInstance(name: string | null | undefined) {
  const n = String(name ?? "");
  return n.startsWith("goloso-") ? n.slice("goloso-".length) : null;
}

function isNewKey(k: string) {
  return k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");
}

function backend() {
  const env = process.env as Record<string, string | undefined>;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("backend_unavailable");
  return { url: url.replace(/\/$/, ""), key };
}

async function callRpc(name: string, params: Record<string, unknown>) {
  const { url, key } = backend();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (!isNewKey(key)) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, data };
}

type BranchAuth = {
  device_token: string | null;
  chatbot_mode: string | null;
  enabled: boolean;
  ai_enabled: boolean;
  ai_ordering_enabled: boolean;
};

/** Valida el token contra el de la sede. Fallback: token global de entorno. */
async function authenticate(branchId: string, provided: string): Promise<BranchAuth | { error: string }> {
  if (!provided) return { error: "missing_token" };

  const r = await callRpc("whatsapp_evolution_auth", { _branch_id: branchId, _token: provided });
  const data = (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>;
  if (r.ok && data.ok === true) {
    return {
      device_token: (data.device_token as string | null) ?? null,
      chatbot_mode: (data.chatbot_mode as string | null) ?? null,
      enabled: data.enabled !== false,
      ai_enabled: data.ai_enabled === true,
      ai_ordering_enabled: data.ai_ordering_enabled === true,
    };
  }

  // Compatibilidad temporal: instancias todavía configuradas con el token global.
  const { readEvolutionEnv } = await import("@/lib/evolution-env");
  const legacy = readEvolutionEnv("EVOLUTION_WEBHOOK_TOKEN");
  if (legacy && provided === legacy) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cfg } = await supabaseAdmin
        .from("whatsapp_bot_config")
        .select("device_token, chatbot_mode, enabled, ai_enabled, ai_ordering_enabled")
        .eq("branch_id", branchId)
        .maybeSingle();
      if (cfg) {
        return {
          device_token: (cfg.device_token as string | null) ?? null,
          chatbot_mode: (cfg.chatbot_mode as string | null) ?? null,
          enabled: cfg.enabled !== false,
          ai_enabled: cfg.ai_enabled === true,
          ai_ordering_enabled: cfg.ai_ordering_enabled === true,
        };
      }
    } catch (e) {
      console.warn("[evolution-webhook] fallback legacy sin service_role", e);
    }
    return { error: "legacy_token_without_config" };
  }

  return { error: String((data.reason as string | undefined) ?? "unauthorized") };
}

async function persistState(branchId: string, token: string, patch: Record<string, unknown>) {
  const r = await callRpc("whatsapp_evolution_persist", {
    _branch_id: branchId,
    _token: token,
    _patch: patch,
  });
  if (!r.ok) console.warn("[evolution-webhook] no pude persistir estado", r.data);
}

/** Deja rastro del motivo por el que un mensaje no se respondió. */
function logSkip(deviceToken: string | null, phone: string, reason: string, metadata: Record<string, unknown> = {}) {
  if (!deviceToken) return;
  void callRpc("whatsapp_bot_ai_log_event", {
    _token: deviceToken,
    _conversation_id: `evo-${Date.now()}`,
    _phone: phone,
    _stage: "evolution_webhook",
    _ok: false,
    _duration_ms: null,
    _error: reason,
    _metadata: metadata,
  }).catch(() => {});
}

async function sendText(instance: string, number: string, text: string) {
  const { readEvolutionEnv } = await import("@/lib/evolution-env");
  const url = (readEvolutionEnv("EVOLUTION_API_URL") || "").replace(/\/$/, "");
  const key = readEvolutionEnv("EVOLUTION_API_KEY");
  if (!url || !key) return;
  await fetch(`${url}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ number, text }),
  }).catch((e) => console.warn("[evolution-webhook] sendText falló", e));
}

export const Route = createFileRoute("/api/public/whatsapp-evolution")({
  server: {
    handlers: {
      GET: () => json({ ok: true, service: "whatsapp-evolution-webhook" }),
      POST: async ({ request }) => {
        const { readEvolutionEnv } = await import("@/lib/evolution-env");
        const provided =
          request.headers.get("x-webhook-token") ??
          new URL(request.url).searchParams.get("t") ??
          "";

        const posBase = (readEvolutionEnv("POS_PUBLIC_URL") || process.env.PUBLIC_URL || "https://golosoheladeria.lovable.app").replace(/\/$/, "");

        let body: any = null;
        try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
        if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

        const instance: string = String(body.instance ?? body.instanceName ?? "");
        const branchId = branchFromInstance(instance);
        if (!branchId) return json({ ok: true, skipped: "unknown_instance" });

        const auth = await authenticate(branchId, String(provided).trim());
        if ("error" in auth) {
          console.warn("[evolution-webhook] rechazado", { instance, reason: auth.error });
          return json({ error: "unauthorized", reason: auth.error }, 401);
        }

        const token = String(provided).trim();
        const event = String(body.event ?? "").toLowerCase().replace(/_/g, ".");
        const payload = body.data ?? {};

        if (event === "qrcode.updated") {
          const raw = payload?.qrcode?.base64 ?? payload?.base64 ?? null;
          const qr = raw && !String(raw).startsWith("data:") ? `data:image/png;base64,${raw}` : raw;
          await persistState(branchId, token, { status: "awaiting_qr", last_qr: qr });
          return json({ ok: true });
        }

        if (event === "connection.update") {
          const state = String(payload?.state ?? payload?.connection ?? "").toLowerCase();
          const mapped = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
          const owner = payload?.wuid ?? payload?.ownerJid ?? null;
          await persistState(branchId, token, {
            status: mapped,
            connected_phone: owner ? String(owner).split("@")[0].split(":")[0] : null,
            ...(mapped === "connected" ? { last_qr: null, last_error: null } : {}),
          });
          return json({ ok: true });
        }

        if (event !== "messages.upsert") return json({ ok: true, skipped: event });

        const msg = Array.isArray(payload?.messages) ? payload.messages[0] : payload;
        if (!msg || msg?.key?.fromMe) return json({ ok: true, skipped: "outgoing" });
        const remoteJid: string = String(msg?.key?.remoteJid ?? "");
        if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid.includes("broadcast")) {
          return json({ ok: true, skipped: "not_direct_chat" });
        }
        const from = remoteJid.split("@")[0];
        const text: string =
          msg?.message?.conversation ??
          msg?.message?.extendedTextMessage?.text ??
          msg?.message?.imageMessage?.caption ??
          "";
        if (!text.trim()) return json({ ok: true, skipped: "unsupported_message" });

        if (!auth.enabled || auth.chatbot_mode === "off") {
          logSkip(auth.device_token, from, "chatbot_disabled", { chatbot_mode: auth.chatbot_mode });
          return json({ ok: true, skipped: "chatbot_disabled" });
        }
        if (!auth.device_token) {
          console.error("[evolution-webhook] sede sin device_token", { branchId });
          return json({ ok: true, skipped: "no_device_token" });
        }

        const wantsAi = auth.ai_enabled && auth.chatbot_mode !== "menu_only";
        const action = wantsAi ? "ai_reply" : "incoming";

        try {
          const res = await fetch(`${posBase}/api/public/whatsapp-bot`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              token: auth.device_token,
              from,
              text: text.trim(),
              message: text.trim(),
              msg_id: msg?.key?.id ?? undefined,
            }),
          });
          const data: any = await res.json().catch(() => null);
          const reply: string | null = data?.reply ?? null;
          if (reply) {
            await sendText(instance, from, reply);
            return json({ ok: true, replied: true });
          }
          const reason = data?.skipped ?? data?.error ?? (res.ok ? "empty_reply" : `bot_${res.status}`);
          logSkip(auth.device_token, from, String(reason), { action, status: res.status });
          return json({ ok: true, replied: false, skipped: reason });
        } catch (e) {
          console.error("[evolution-webhook] error procesando mensaje", e);
          logSkip(auth.device_token, from, "processing_failed", { error: String(e) });
          return json({ ok: false, error: "processing_failed" }, 200);
        }
      },
    },
  },
});
