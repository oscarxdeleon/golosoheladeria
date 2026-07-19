import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

interface Input {
  sessionId: string;
}

interface WaNumber {
  phone: string;
  label?: string;
  enabled?: boolean;
}

function fmt(v: number | null | undefined) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

function pad(s: string, len: number) {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padRight(s: string, len: number) {
  return s.length >= len ? s.slice(-len) : " ".repeat(len - s.length) + s;
}

function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  if (!digits) return null;
  // Colombia: si viene local de 10 dígitos, agregar 57 automáticamente.
  if (digits.length === 10) return "57" + digits;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

export const sendCashReportWhatsApp = createServerFn({ method: "POST" })
  .inputValidator((d: Input) => d)
  .handler(async ({ data }) => {
    const SUPABASE_URL =
      process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      import.meta.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return { skipped: true, reason: "Backend no configurado" };
    }

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data: session, error } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error || !session) return { skipped: true, reason: "Sesión no encontrada" };

    if (!session.branch_id) return { skipped: true, reason: "Sesión sin sede" };

    const { data: branch } = await supabase
      .from("branches")
      .select("name, address, report_whatsapp_numbers")
      .eq("id", session.branch_id)
      .single();
    if (!branch) return { skipped: true, reason: "Sede no encontrada" };

    const rawNumbers = ((branch as { report_whatsapp_numbers?: unknown }).report_whatsapp_numbers ?? []) as unknown;
    const numbers: WaNumber[] = Array.isArray(rawNumbers) ? (rawNumbers as WaNumber[]) : [];
    const active = numbers.filter((n) => n && n.phone && n.enabled !== false);
    if (active.length === 0) return { skipped: true, reason: "Sin números configurados" };

    // Aggregate sales/expenses del turno para armar el texto (mismos criterios que el email)
    const s = session as Record<string, number | string | null>;
    const openedAt = new Date(String(s.opened_at));
    const closedAt = s.closed_at ? new Date(String(s.closed_at)) : new Date();

    const { data: sales } = await supabase
      .from("sales")
      .select("total, tip_amount, order_type, payment_method, status")
      .eq("cash_session_id", session.id);
    const rowsSales = (sales ?? []) as unknown as Array<{
      total: number | null;
      tip_amount: number | null;
      order_type: string | null;
      payment_method: string | null;
      status: string | null;
    }>;

    const validSales = rowsSales.filter((x) => (x.status ?? "completed") !== "cancelled");
    const totalSales = validSales.reduce((a, r) => a + Number(r.total ?? 0), 0);
    const totalTips = validSales.reduce((a, r) => a + Number(r.tip_amount ?? 0), 0);
    const nSales = validSales.length;
    const avgTicket = nSales ? totalSales / nSales : 0;
    const cancelled = rowsSales.filter((x) => x.status === "cancelled");
    const cancelledValue = cancelled.reduce((a, r) => a + Number(r.total ?? 0), 0);

    const byService: Record<string, { count: number; total: number }> = {};
    for (const r of validSales) {
      const k = String(r.order_type ?? "mesa");
      byService[k] = byService[k] ?? { count: 0, total: 0 };
      byService[k].count += 1;
      byService[k].total += Number(r.total ?? 0);
    }

    const cashE = Number(s.cash_expected ?? s.expected_amount ?? 0);
    const cashC = Number(s.cash_counted ?? s.counted_amount ?? 0);
    const nE = Number(s.nequi_expected ?? 0);
    const nC = Number(s.nequi_counted ?? 0);
    const bE = Number(s.bancolombia_expected ?? 0);
    const bC = Number(s.bancolombia_counted ?? 0);
    const totalE = cashE + nE + bE;
    const totalC = cashC + nC + bC;
    const totalD = totalC - totalE;

    const cuadre = totalD === 0
      ? "✅ *CUADRÓ*"
      : totalD > 0
        ? `⚠️ *SOBRANTE ${fmt(totalD)}*`
        : `⚠️ *FALTANTE ${fmt(Math.abs(totalD))}*`;

    const svcLines = Object.entries(byService)
      .map(([k, v]) => `${pad(k, 12)} ${padRight(String(v.count), 3)} · ${fmt(v.total)}`)
      .join("\n");

    const arqueoRow = (label: string, esp: number, rep: number) => {
      const d = rep - esp;
      const sign = d === 0 ? "  " : d > 0 ? "+ " : "- ";
      return `${pad(label, 12)} ${padRight(fmt(esp), 12)}  ${padRight(fmt(rep), 12)}  ${sign}${d === 0 ? "" : fmt(Math.abs(d))}`;
    };

    const dateStr = closedAt.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    const openStr = openedAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    const closeStr = closedAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

    const body = `🍦 *CIERRE DE CAJA · ${branch.name}*
📅 ${dateStr}

👤 Cajero: ${session.user_name ?? "—"}
🕐 Apertura: ${openStr}   Cierre: ${closeStr}
💵 Monto inicial: ${fmt(Number(session.opening_amount))}

━━━━━━━━━━━━━━━━━━
📊 *RESUMEN*
Pedidos: ${nSales}
Ventas: *${fmt(totalSales)}*
Ticket promedio: ${fmt(avgTicket)}
Propinas: ${fmt(totalTips)}
${cancelled.length ? `Cancelados: ${cancelled.length} (${fmt(cancelledValue)})` : ""}
━━━━━━━━━━━━━━━━━━
🍨 *SERVICIO*
${svcLines || "—"}

━━━━━━━━━━━━━━━━━━
💰 *ARQUEO*
\`\`\`
Método       Esperado      Reportado     Δ
${arqueoRow("Efectivo", cashE, cashC)}
${arqueoRow("Nequi", nE, nC)}
${arqueoRow("Bancolombia", bE, bC)}
─────────────────────────────────────
${arqueoRow("TOTAL", totalE, totalC)}
\`\`\`
${cuadre}
${session.closing_notes ? `\n📝 Notas: ${session.closing_notes}` : ""}

_Reporte automático de Goloso POS_`;

    // Encolar mensajes
    const rows = active
      .map((n) => {
        const phone = normalizePhone(n.phone);
        if (!phone) return null;
        return {
          branch_id: session.branch_id!,
          to_phone: phone,
          body,
          purpose: "cash_report",
        };
      })
      .filter(Boolean) as Array<{ branch_id: string; to_phone: string; body: string; purpose: string }>;

    if (rows.length === 0) return { skipped: true, reason: "Sin números válidos" };

    const { error: insErr } = await supabase.from("whatsapp_outbound_queue").insert(rows);
    if (insErr) throw new Error(`No se pudo encolar: ${insErr.message}`);

    return { queued: rows.length };
  });
