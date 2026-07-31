// Acceso al backend (RPCs SECURITY DEFINER) y utilidades de log del asistente.


export function isNewKey(k: string) {
  return k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function backend() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("backend_unavailable");
  return { url: url.replace(/\/$/, ""), key };
}

export async function callRpc(name: string, params: Record<string, unknown>) {
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
  try { data = text ? JSON.parse(text) : null; } catch { /* keep as text */ }
  return { ok: res.ok, status: res.status, data };
}

export function makeConversationId(phone: string) {
  const cleanPhone = phone.replace(/\D/g, "");
  const suffix = cleanPhone.slice(-4) || "anon";
  const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `wa-${Date.now()}-${suffix}-${randomId}`;
}

export function elapsedMs(start: number) {
  return Math.max(0, Math.round(performance.now() - start));
}

export function formatCOP(n: number) {
  return "$" + Math.round(n).toLocaleString("es-CO");
}

export function trimForLog(value: unknown, max = 800) {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

export async function logBotEvent(
  token: string,
  conversationId: string,
  phone: string,
  stage: string,
  data: { ok?: boolean; durationMs?: number; error?: unknown; metadata?: Record<string, unknown> } = {},
) {
  // Fire-and-forget: nunca esperamos por el log. Un log lento no debe
  // demorar la respuesta al cliente. Los errores del RPC se ignoran.
  void callRpc("whatsapp_bot_ai_log_event", {
    _token: token,
    _conversation_id: conversationId,
    _phone: phone,
    _stage: stage,
    _ok: data.ok !== false,
    _duration_ms: typeof data.durationMs === "number" ? data.durationMs : null,
    _error: data.error == null ? null : trimForLog(data.error, 1000),
    _metadata: data.metadata ?? {},
  }).catch(() => {});
}

// Cache in-memory de la porción "sede" del contexto (menú, sabores, FAQs,
