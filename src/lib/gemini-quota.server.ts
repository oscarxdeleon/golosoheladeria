// Rastreo de cuota Gemini + alertas por email.
// Todas las llamadas directas a Google AI Studio deben pasar por trackGeminiCall
// después de una respuesta 2xx, para llevar el contador diario contra el límite
// gratuito (default 1500 req/día). Si se cruzan los umbrales 80% o 95% se envía
// un email de alerta vía la edge function `resend-send`.

type TrackRow = {
  call_count: number;
  daily_limit: number;
  alert_level: string | null;
  alert_emails: string[] | null;
};

async function callRpc(rpc: string, args: Record<string, unknown>): Promise<TrackRow | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(args),
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (Array.isArray(data) && data.length > 0) return data[0] as TrackRow;
    return null;
  } catch {
    return null;
  }
}

async function sendAlertEmail(level: "80" | "95", count: number, limit: number, recipients: string[]) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon || recipients.length === 0) return;

  const pct = Math.round((count / Math.max(limit, 1)) * 100);
  const critical = level === "95";
  const subject = `${critical ? "🚨" : "⚠️"} Cuota Gemini al ${pct}% (${count}/${limit})`;
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="padding:20px;border-radius:12px;background:${critical ? "#fee2e2" : "#fef3c7"};border:1px solid ${critical ? "#fca5a5" : "#fcd34d"}">
      <h2 style="margin:0 0 8px 0;color:${critical ? "#991b1b" : "#92400e"}">${critical ? "🚨 Cuota Gemini casi agotada" : "⚠️ Cuota Gemini al 80%"}</h2>
      <p style="margin:0;color:#333;font-size:15px">Se han usado <b>${count}</b> de <b>${limit}</b> llamadas gratuitas de Google AI Studio hoy (<b>${pct}%</b>).</p>
    </div>
    <p style="margin-top:20px;font-size:14px;color:#444">
      ${critical
        ? "Si se agota la cuota, el bot de WhatsApp caerá al respaldo de Lovable AI Gateway (consume créditos) o dará respuestas operativas sin IA."
        : "El bot sigue funcionando con normalidad. Este es un aviso preventivo."}
    </p>
    <p style="margin-top:16px;font-size:13px;color:#666">
      La cuota se reinicia automáticamente cada día a medianoche (hora del Pacífico).
      Puedes ajustar el límite y los correos de alerta desde <i>Ajustes → WhatsApp Bot → Cuota Gemini</i>.
    </p>
    <p style="margin-top:24px;font-size:12px;color:#999">Alerta automática de Goloso POS.</p>
  </div>`;

  const from = process.env.RESEND_FROM || "Heladería Goloso <reportes@heladeriagoloso.com>";

  await Promise.all(
    recipients.map((to) =>
      fetch(`${url}/functions/v1/resend-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anon}`,
          apikey: anon,
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
      }).catch(() => null),
    ),
  );
}

/**
 * Registra una llamada exitosa a Gemini directo. No falla nunca el flujo llamante.
 * Si se cruza un umbral (80% o 95%), dispara email a los destinatarios configurados.
 */
export async function trackGeminiCall(source: string): Promise<void> {
  try {
    const row = await callRpc("track_gemini_call", { _source: source });
    if (!row) return;
    const level = row.alert_level;
    if (level !== "80" && level !== "95") return;
    const recipients = (row.alert_emails ?? []).filter((e) => typeof e === "string" && e.includes("@"));
    if (recipients.length === 0) {
      console.info(`[gemini-quota] Umbral ${level}% cruzado (${row.call_count}/${row.daily_limit}) pero no hay emails configurados.`);
      return;
    }
    await sendAlertEmail(level, row.call_count, row.daily_limit, recipients);
  } catch {
    // silencio absoluto: nunca romper el flujo AI por el tracking
  }
}
