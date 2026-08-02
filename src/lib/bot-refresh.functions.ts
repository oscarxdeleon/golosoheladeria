import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readEvolutionEnv } from "@/lib/evolution-env";

// ---------------------------------------------------------------------------
// "Actualizar chatbot" — aplica en caliente todos los cambios del chatbot
// (entrenamiento, FAQs, prompts, bienvenidas, menú, productos, categorías,
// modificadores, horarios, domicilios, sedes y configuración del menú online)
// en TODOS los despliegues: Lovable y Vercel.
//
// Cómo funciona:
//  1. Sube la revisión de configuración en la base de datos.
//  2. Llama al endpoint /api/public/bot-refresh de cada despliegue con el
//     token interno para que descarten sus cachés en memoria.
//  3. Verifica que todos los despliegues reporten la MISMA revisión.
//  4. Reintenta una vez si alguno queda desfasado y registra el resultado.
//
// Nunca toca la sesión de WhatsApp: no borra instancias ni tokens del
// proveedor, por lo que no se pide volver a escanear el QR.
// ---------------------------------------------------------------------------

const LOVABLE_PUBLISHED_URL = "https://golosoheladeria.lovable.app";

export type SyncTargetResult = {
  name: string;
  url: string;
  ok: boolean;
  revision: number | null;
  platform: string | null;
  commit: string | null;
  error: string | null;
};

export type ChatbotRefreshResult = {
  status: "ok" | "partial" | "error";
  revision: number;
  targets: SyncTargetResult[];
  message: string;
};

function normalizeBase(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProto);
    // Las vistas previas de Lovable son efímeras: nunca son un destino válido.
    if (/^id-preview--/i.test(url.hostname)) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function collectTargets(): Array<{ name: string; base: string }> {
  const env = process.env as Record<string, string | undefined>;
  const candidates: Array<{ name: string; base: string | null }> = [
    { name: "Lovable", base: normalizeBase(LOVABLE_PUBLISHED_URL) },
    { name: "Vercel", base: normalizeBase(readEvolutionEnv("POS_PUBLIC_URL") || env.PUBLIC_URL) },
    { name: "Despliegue actual", base: normalizeBase(env.VERCEL_URL) },
  ];
  for (const extra of String(env.BOT_SYNC_TARGETS ?? "").split(",")) {
    const base = normalizeBase(extra);
    if (base) candidates.push({ name: new URL(base).host, base });
  }

  const seen = new Set<string>();
  const out: Array<{ name: string; base: string }> = [];
  for (const c of candidates) {
    if (!c.base || seen.has(c.base)) continue;
    seen.add(c.base);
    out.push({ name: c.name, base: c.base });
  }
  return out;
}

async function refreshTarget(
  target: { name: string; base: string },
  token: string,
): Promise<SyncTargetResult> {
  const url = `${target.base}/api/public/bot-refresh`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-refresh-token": token },
      body: JSON.stringify({ source: "pos" }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      return {
        name: target.name,
        url,
        ok: false,
        revision: null,
        platform: null,
        commit: null,
        error: `HTTP ${res.status}${data?.error ? ` (${String(data.error)})` : ""}`,
      };
    }
    return {
      name: target.name,
      url,
      ok: true,
      revision: typeof data?.applied_revision === "number" ? data.applied_revision : null,
      platform: typeof data?.platform === "string" ? data.platform : null,
      commit: typeof data?.commit === "string" ? data.commit : null,
      error: null,
    };
  } catch (e) {
    return {
      name: target.name,
      url,
      ok: false,
      revision: null,
      platform: null,
      commit: null,
      error: String(e).slice(0, 200),
    };
  }
}

export const refreshChatbot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChatbotRefreshResult> => {
    const { supabase } = context;

    const { data: bumped, error: bumpError } = await supabase.rpc("bot_bump_config_revision");
    if (bumpError) throw new Error(bumpError.message);
    const row = (Array.isArray(bumped) ? bumped[0] : bumped) as
      | { config_revision: number; refresh_token: string }
      | null;
    if (!row?.refresh_token) throw new Error("No se pudo preparar la actualización del chatbot.");

    const revision = Number(row.config_revision);
    const targets = collectTargets();

    let results = await Promise.all(targets.map((t) => refreshTarget(t, row.refresh_token)));

    // Reintento automático solo sobre los destinos que fallaron o quedaron
    // desfasados respecto a la revisión recién publicada.
    const needsRetry = results.filter((r) => !r.ok || r.revision !== revision);
    if (needsRetry.length) {
      await new Promise((r) => setTimeout(r, 1_500));
      const retried = await Promise.all(
        needsRetry.map((r) => {
          const target = targets.find((t) => `${t.base}/api/public/bot-refresh` === r.url)!;
          return refreshTarget(target, row.refresh_token);
        }),
      );
      results = results.map((r) => retried.find((x) => x.url === r.url) ?? r);
    }

    const allOk = results.length > 0 && results.every((r) => r.ok && r.revision === revision);
    const anyOk = results.some((r) => r.ok);
    const status: ChatbotRefreshResult["status"] = allOk ? "ok" : anyOk ? "partial" : "error";

    const failed = results.filter((r) => !r.ok || r.revision !== revision);
    const message = allOk
      ? "El chatbot fue actualizado correctamente. Todos los cambios fueron sincronizados en Lovable y Vercel. La sesión de WhatsApp permanece activa y no es necesario volver a escanear el código QR."
      : `No todos los despliegues quedaron sincronizados: ${failed
          .map((f) => `${f.name} (${f.error ?? `versión ${f.revision ?? "desconocida"}`})`)
          .join(", ")}.`;

    await supabase.rpc("bot_record_sync", {
      _revision: revision,
      _status: status,
      _targets: results as unknown as never,
      _error: allOk ? undefined : message,
    });

    return { status, revision, targets: results, message };
  });
