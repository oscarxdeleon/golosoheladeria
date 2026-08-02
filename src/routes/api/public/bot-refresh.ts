import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Refresco en caliente del chatbot.
//
// El botón "Actualizar chatbot" del POS sube la revisión de configuración en
// la base de datos y llama a este endpoint en CADA despliegue (Lovable y
// Vercel). Cada proceso descarta sus cachés en memoria (menú, productos,
// FAQs, prompts, claves de IA, enfriamientos) y responde con la revisión que
// quedó aplicada, para poder verificar que ambos entornos están iguales.
//
// No toca la sesión de WhatsApp: no borra instancias, no reinicia el
// proveedor y no invalida tokens, por lo que nunca pide volver a escanear QR.
//
// Seguridad: requiere el token interno guardado en `bot_runtime_state`
// (header `x-bot-refresh-token`), validado por una RPC SECURITY DEFINER.
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function deploymentInfo() {
  const env = process.env as Record<string, string | undefined>;
  return {
    deployment: env.VERCEL_URL ?? env.VERCEL_BRANCH_URL ?? env.PUBLIC_URL ?? "lovable",
    platform: env.VERCEL ? "vercel" : "lovable",
    commit: env.VERCEL_GIT_COMMIT_SHA ?? null,
    deployment_id: env.VERCEL_DEPLOYMENT_ID ?? null,
  };
}

function isNewKey(k: string) {
  return k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");
}

async function authorize(token: string): Promise<{ ok: boolean; revision: number | null }> {
  const env = process.env as Record<string, string | undefined>;
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!url || !key) return { ok: false, revision: null };

  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (!isNewKey(key)) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${url}/rest/v1/rpc/bot_refresh_authorize`, {
    method: "POST",
    headers,
    body: JSON.stringify({ _token: token }),
  });
  if (!res.ok) return { ok: false, revision: null };
  const rows = (await res.json().catch(() => null)) as Array<{ ok: boolean; config_revision: number | null }> | null;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.ok) return { ok: false, revision: null };
  return { ok: true, revision: row.config_revision ?? null };
}

/**
 * Publica en la base de datos la clave de IA válida de ESTE despliegue.
 * Vercel no tiene `LOVABLE_API_KEY`; el chatbot allí lee la clave desde la
 * base. Si esa clave quedó desactualizada, el gateway responde 403 y el bot
 * pierde la IA (respuestas incoherentes o genéricas).
 */
async function publishAiKeys(): Promise<boolean> {
  const env = process.env as Record<string, string | undefined>;
  let published = false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (env.LOVABLE_API_KEY) {
      const probe = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 4,
        }),
        signal: AbortSignal.timeout(12_000),
      }).catch(() => null);
      if (probe?.ok) {
        const { error } = await supabaseAdmin
          .from("app_ai_credentials")
          .upsert({ provider: "lovable", api_key: env.LOVABLE_API_KEY, updated_at: new Date().toISOString() });
        if (!error) published = true;
      }
    }
    if (env.GEMINI_API_KEY) {
      const { error } = await supabaseAdmin
        .from("app_ai_credentials")
        .upsert({ provider: "gemini", api_key: env.GEMINI_API_KEY, updated_at: new Date().toISOString() });
      if (!error) published = true;
    }
  } catch {
    /* despliegue sin clave de servicio o sin claves de IA */
  }
  return published;
}

export const Route = createFileRoute("/api/public/bot-refresh")({

  server: {
    handlers: {
      // Sonda pública: sirve para comparar qué versión está sirviendo cada
      // despliegue. No expone datos sensibles.
      GET: async () => {
        const { getAppliedRevision } = await import("@/lib/bot/engine");
        return json({ ok: true, service: "bot-refresh", applied_revision: getAppliedRevision(), ...deploymentInfo() });
      },

      POST: async ({ request }) => {
        const token = (request.headers.get("x-bot-refresh-token") ?? "").trim();
        if (!token) return json({ error: "missing_token" }, 401);

        let auth: { ok: boolean; revision: number | null };
        try {
          auth = await authorize(token);
        } catch (e) {
          return json({ error: "authorize_failed", detail: String(e).slice(0, 200) }, 500);
        }
        if (!auth.ok) return json({ error: "unauthorized" }, 401);

        // Si ESTE despliegue tiene una clave de IA válida en variables de
        // entorno (caso Lovable), la publica en la base de datos para que los
        // despliegues sin variables (Vercel) usen exactamente la misma clave.
        // Esta era la causa raíz de que el chatbot perdiera la IA en Vercel.
        const ai_key_published = await publishAiKeys();

        const { clearBotCaches } = await import("@/lib/bot/engine");
        const applied = clearBotCaches(auth.revision ?? undefined);


        return json({
          ok: true,
          applied_revision: applied,
          expected_revision: auth.revision,
          in_sync: auth.revision === null ? true : applied === auth.revision,
          whatsapp_session: "untouched",
          ai_key_published,

          ...deploymentInfo(),
        });
      },
    },
  },
});
