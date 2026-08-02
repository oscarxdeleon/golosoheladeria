import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SYNC_TARGETS = [
  { name: "Lovable", base: "https://golosoheladeria.lovable.app" },
  { name: "Vercel", base: "https://golosoheladeria-swart.vercel.app" },
] as const;

/** Frases reales de clientes con las que se verifica el chatbot tras actualizar. */
const SMOKE_TESTS = [
  "Una malteada",
  "Una ensalada de frutas",
  "Un brownie",
  "A que hora atienden",
] as const;

export type SmokeTestResult = {
  target: string;
  prompt: string;
  ok: boolean;
  source: string | null;
  reply: string;
};

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
  tests: SmokeTestResult[];
  ai_key_synced: boolean;
  duration_ms: number;
  message: string;
};

function describeError(data: Record<string, unknown> | null) {
  const error = data?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return "respuesta de autorización no válida";
    }
  }
  return null;
}

/**
 * Valida la clave de IA disponible en este entorno y, si funciona, la guarda en
 * la base de datos. Es la corrección de raíz del chatbot en Vercel: allí no
 * existe `LOVABLE_API_KEY`, por lo que el bot lee la clave desde la base. Si esa
 * clave quedó vieja, el gateway responde 403 y el chatbot pierde la IA.
 */
async function syncAiKeys(supabase: SupabaseClient<Database>): Promise<boolean> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const geminiKey = process.env["GEMINI_API_KEY"];
  let synced = false;

  if (lovableKey) {
    try {
      const probe = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": lovableKey,
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
        },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 4,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (probe.ok) {
        const { error } = await supabase.rpc("admin_set_ai_key", {
          _provider: "lovable",
          _api_key: lovableKey,
        });
        if (!error) synced = true;
      }
    } catch {
      /* sin clave verificable en este entorno */
    }
  }

  if (geminiKey) {
    const { error } = await supabase.rpc("admin_set_ai_key", {
      _provider: "gemini",
      _api_key: geminiKey,
    });
    if (!error) synced = true;
  }

  return synced;
}

async function refreshTarget(
  target: (typeof SYNC_TARGETS)[number],
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
      const detail = describeError(data);
      return {
        name: target.name,
        url,
        ok: false,
        revision: null,
        platform: null,
        commit: null,
        error: `HTTP ${res.status}${detail ? ` (${detail})` : ""}`,
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
  } catch (error) {
    return {
      name: target.name,
      url,
      ok: false,
      revision: null,
      platform: null,
      commit: null,
      error: error instanceof Error ? error.message.slice(0, 200) : "Error de red desconocido",
    };
  }
}

/** Ejecuta las pruebas funcionales contra un despliegue ya sincronizado. */
async function runSmokeTests(
  target: (typeof SYNC_TARGETS)[number],
  deviceToken: string,
): Promise<SmokeTestResult[]> {
  const results: SmokeTestResult[] = [];
  for (const prompt of SMOKE_TESTS) {
    try {
      const res = await fetch(`${target.base}/api/public/whatsapp-bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_reply",
          token: deviceToken,
          from: `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: prompt,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await res.json().catch(() => null)) as
        | { reply?: string; source?: string }
        | null;
      const reply = String(data?.reply ?? "").trim();
      const generic = /no te entend|dilo de otra forma|me lo dices de otra forma/i.test(reply);
      results.push({
        target: target.name,
        prompt,
        ok: res.ok && reply.length > 0 && !generic,
        source: data?.source ?? null,
        reply: reply.slice(0, 240),
      });
    } catch (error) {
      results.push({
        target: target.name,
        prompt,
        ok: false,
        source: null,
        reply: error instanceof Error ? error.message.slice(0, 160) : "error de red",
      });
    }
  }
  return results;
}

async function firstDeviceToken(supabase: SupabaseClient<Database>): Promise<string | null> {
  const { data } = await supabase
    .from("whatsapp_bot_config")
    .select("device_token")
    .limit(1)
    .maybeSingle();
  const token = (data as { device_token?: string } | null)?.device_token;
  return typeof token === "string" && token.length >= 16 ? token : null;
}

export async function synchronizeChatbot(
  supabase: SupabaseClient<Database>,
): Promise<ChatbotRefreshResult> {
  const startedAt = Date.now();

  const aiKeySynced = await syncAiKeys(supabase);

  const { data: bumped, error: bumpError } = await supabase.rpc("bot_bump_config_revision");
  if (bumpError) throw new Error(bumpError.message);
  const row = (Array.isArray(bumped) ? bumped[0] : bumped) as
    | { config_revision: number; refresh_token: string }
    | null;
  if (!row?.refresh_token) throw new Error("No se pudo preparar la actualización del chatbot.");

  const revision = Number(row.config_revision);
  let results = await Promise.all(SYNC_TARGETS.map((target) => refreshTarget(target, row.refresh_token)));
  const retryIndexes = results
    .map((result, index) => (!result.ok || result.revision !== revision ? index : -1))
    .filter((index) => index >= 0);

  if (retryIndexes.length) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const retried = await Promise.all(
      retryIndexes.map((index) => refreshTarget(SYNC_TARGETS[index], row.refresh_token)),
    );
    results = results.map((result, index) => {
      const retryPosition = retryIndexes.indexOf(index);
      return retryPosition >= 0 ? retried[retryPosition] : result;
    });
  }

  // Pruebas funcionales reales sobre cada despliegue sincronizado.
  let tests: SmokeTestResult[] = [];
  const deviceToken = await firstDeviceToken(supabase).catch(() => null);
  if (deviceToken) {
    const runnable = SYNC_TARGETS.filter((target) =>
      results.some((result) => result.name === target.name && result.ok),
    );
    const perTarget = await Promise.all(runnable.map((target) => runSmokeTests(target, deviceToken)));
    tests = perTarget.flat();
  }

  const allOk = results.every((result) => result.ok && result.revision === revision);
  const testsOk = tests.every((test) => test.ok);
  const anyOk = results.some((result) => result.ok);
  const status: ChatbotRefreshResult["status"] =
    allOk && testsOk ? "ok" : anyOk ? "partial" : "error";
  const failed = results.filter((result) => !result.ok || result.revision !== revision);
  const failedTests = tests.filter((test) => !test.ok);
  const duration = Date.now() - startedAt;

  const message = allOk && testsOk
    ? `Chatbot actualizado a la versión #${revision} en Lovable y Vercel. ${tests.length} pruebas funcionales correctas. La sesión de WhatsApp permanece activa.`
    : failed.length
      ? `No todos los despliegues quedaron sincronizados: ${failed
          .map((failure) => `${failure.name} (${failure.error ?? `versión ${failure.revision ?? "desconocida"}`})`)
          .join(", ")}.`
      : `Sincronización aplicada, pero fallaron ${failedTests.length} pruebas: ${failedTests
          .map((test) => `${test.target}: "${test.prompt}"`)
          .join(", ")}.`;

  await supabase.rpc("bot_record_sync", {
    _revision: revision,
    _status: status,
    _targets: { deployments: results, tests, duration_ms: duration, ai_key_synced: aiKeySynced },
    _error: status === "ok" ? undefined : message,
  });

  return {
    status,
    revision,
    targets: results,
    tests,
    ai_key_synced: aiKeySynced,
    duration_ms: duration,
    message,
  };
}
