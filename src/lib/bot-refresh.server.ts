const SYNC_TARGETS = [
  { name: "Lovable", base: "https://golosoheladeria.lovable.app" },
  { name: "Vercel", base: "https://golosoheladeria-swart.vercel.app" },
] as const;

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

export async function synchronizeChatbot(
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
): Promise<ChatbotRefreshResult> {
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

  const allOk = results.every((result) => result.ok && result.revision === revision);
  const anyOk = results.some((result) => result.ok);
  const status: ChatbotRefreshResult["status"] = allOk ? "ok" : anyOk ? "partial" : "error";
  const failed = results.filter((result) => !result.ok || result.revision !== revision);
  const message = allOk
    ? "El chatbot fue actualizado correctamente en Lovable y Vercel. La sesión de WhatsApp permanece activa."
    : `No todos los despliegues quedaron sincronizados: ${failed
        .map((failure) => `${failure.name} (${failure.error ?? `versión ${failure.revision ?? "desconocida"}`})`)
        .join(", ")}.`;

  await supabase.rpc("bot_record_sync", {
    _revision: revision,
    _status: status,
    _targets: results,
    _error: allOk ? undefined : message,
  });

  return { status, revision, targets: results, message };
}