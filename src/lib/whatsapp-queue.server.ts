// Envío real de los mensajes encolados en `whatsapp_outbound_queue`.
//
// Antes esta cola la vaciaba el bot local (Baileys). Tras migrar a Evolution
// API nadie la procesaba, así que los reportes de cierre y las pruebas quedaban
// "encolados" para siempre. Ahora el propio servidor los entrega.

import { readEvolutionEnv } from "@/lib/evolution-env";

type QueueRow = { id: string; to_phone: string; body: string; purpose: string | null };

async function sendText(instance: string, number: string, text: string) {
  const url = (readEvolutionEnv("EVOLUTION_API_URL") || "").replace(/\/$/, "");
  const key = readEvolutionEnv("EVOLUTION_API_KEY");
  if (!url || !key) return { ok: false, error: "Evolution no configurado (URL/API KEY)" };

  try {
    const res = await fetch(`${url}/message/sendText/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key },
      body: JSON.stringify({ number, text }),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.ok) return { ok: true as const };
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: false as const, error: `evolution_${res.status}: ${detail}` };
  } catch (e) {
    return { ok: false as const, error: String(e).slice(0, 300) };
  }
}

/**
 * Toma los pendientes de la sede y los entrega por WhatsApp.
 * Usa RPCs SECURITY DEFINER para que funcione con cualquier rol del POS.
 */
export async function flushBranchQueue(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> },
  branchId: string,
  limit = 10,
) {
  const { data, error } = await supabase.rpc("whatsapp_queue_claim", {
    _branch_id: branchId,
    _limit: limit,
  });
  if (error) return { sent: 0, failed: 0, error: error.message };

  const rows = (Array.isArray(data) ? data : []) as QueueRow[];
  let sent = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const row of rows) {
    const r = await sendText(`goloso-${branchId}`, row.to_phone, row.body);
    if (r.ok) sent++;
    else {
      failed++;
      lastError = r.error;
    }
    await supabase.rpc("whatsapp_queue_complete", {
      _id: row.id,
      _ok: r.ok,
      _error: r.ok ? null : r.error,
    });
  }

  return { sent, failed, error: lastError };
}
