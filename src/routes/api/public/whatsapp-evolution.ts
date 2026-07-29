import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Webhook de Evolution API → POS.
// Recibe eventos de las instancias (una por sede), actualiza el estado y
// enruta los mensajes entrantes al asistente ya existente (/api/public/whatsapp-bot).
// Seguridad: token secreto en el query string (?t=) verificado contra
// EVOLUTION_WEBHOOK_TOKEN. Sin token válido → 401.
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function branchFromInstance(name: string | null | undefined) {
  const n = String(name ?? "");
  return n.startsWith("goloso-") ? n.slice("goloso-".length) : null;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function persistState(
  branchId: string,
  patch: Record<string, unknown>,
) {
  try {
    const db = await admin();
    await db.from("whatsapp_hub_sessions").upsert(
      { branch_id: branchId, updated_at: new Date().toISOString(), ...patch },
      { onConflict: "branch_id" },
    );
  } catch (e) {
    console.warn("[evolution-webhook] no pude persistir estado", e);
  }
}

async function deviceToken(branchId: string): Promise<string | null> {
  try {
    const db = await admin();
    const { data } = await db
      .from("whatsapp_bot_config")
      .select("device_token")
      .eq("branch_id", branchId)
      .maybeSingle();
    return (data?.device_token as string | undefined) ?? null;
  } catch {
    return null;
  }
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
        const expected = readEvolutionEnv("EVOLUTION_WEBHOOK_TOKEN");
        const provided = new URL(request.url).searchParams.get("t") ?? request.headers.get("x-webhook-token");
        if (!expected || provided !== expected) return json({ error: "unauthorized" }, 401);

        const posBase = (readEvolutionEnv("POS_PUBLIC_URL") || process.env.PUBLIC_URL || "https://golosoheladeria.lovable.app").replace(/\/$/, "");


        let body: any = null;
        try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
        if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

        const instance: string = String(body.instance ?? body.instanceName ?? "");
        const branchId = branchFromInstance(instance);
        if (!branchId) return json({ ok: true, skipped: "unknown_instance" });

        const event = String(body.event ?? "").toLowerCase().replace(/_/g, ".");
        const payload = body.data ?? {};

        if (event === "qrcode.updated") {
          const raw = payload?.qrcode?.base64 ?? payload?.base64 ?? null;
          const qr = raw && !String(raw).startsWith("data:") ? `data:image/png;base64,${raw}` : raw;
          await persistState(branchId, { status: "awaiting_qr", last_qr: qr, last_qr_at: new Date().toISOString() });
          return json({ ok: true });
        }

        if (event === "connection.update") {
          const state = String(payload?.state ?? payload?.connection ?? "").toLowerCase();
          const mapped = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
          const owner = payload?.wuid ?? payload?.ownerJid ?? null;
          await persistState(branchId, {
            status: mapped,
            connected_phone: owner ? String(owner).split("@")[0].split(":")[0] : null,
            ...(mapped === "connected"
              ? { last_qr: null, last_error: null, last_connected_at: new Date().toISOString() }
              : {}),
            ...(mapped === "disconnected" ? { last_disconnected_at: new Date().toISOString() } : {}),
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

        const token = await deviceToken(branchId);
        if (!token) return json({ ok: true, skipped: "no_device_token" });

        try {
          const res = await fetch(`${posBase}/api/public/whatsapp-bot`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "ai_reply",
              token,
              from,
              text: text.trim(),
              msg_id: msg?.key?.id ?? undefined,
            }),
          });
          const data: any = await res.json().catch(() => null);
          const reply: string | null = data?.reply ?? null;
          if (reply) await sendText(instance, from, reply);
          return json({ ok: true, replied: Boolean(reply), skipped: data?.skipped ?? null });
        } catch (e) {
          console.error("[evolution-webhook] error procesando mensaje", e);
          return json({ ok: false, error: "processing_failed" }, 200);
        }
      },
    },
  },
});
