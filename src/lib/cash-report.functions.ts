import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface Input {
  sessionId: string;
}

interface EmailRecipient {
  email: string;
  enabled?: boolean;
  label?: string;
}

function fmt(v: number | null | undefined) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

export const sendCashReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => d)
  .handler(async ({ data, context }) => {
    // Use the authenticated user's supabase client so RLS lets us read the
    // session/branch that the admin has access to. Previously we built an
    // anon-key client here and RLS returned no row → "Sesión no encontrada".
    const supabase = context.supabase;

    const { data: session, error } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error || !session) {
      return {
        skipped: true,
        reason: error?.message
          ? `No se pudo leer la sesión: ${error.message}`
          : "Sesión no encontrada (verifica permisos de la sede)",
      };
    }

    let branchName = "—";
    let branchAddress: string | null = null;
    let legacyEmail: string | null = null;
    let emailsRaw: unknown = [];
    let emailsEnabled = true;
    if (session.branch_id) {
      const { data: br } = await supabase
        .from("branches")
        .select("name,address,report_email,report_emails,report_emails_enabled")
        .eq("id", session.branch_id)
        .single();
      if (br) {
        const b = br as {
          name: string;
          address: string | null;
          report_email?: string | null;
          report_emails?: unknown;
          report_emails_enabled?: boolean | null;
        };
        branchName = b.name;
        branchAddress = b.address;
        legacyEmail = b.report_email ?? null;
        emailsRaw = b.report_emails ?? [];
        emailsEnabled = b.report_emails_enabled !== false;
      }
    }

    if (!emailsEnabled) {
      return { skipped: true, reason: "Envío por correo desactivado para esta sede" };
    }

    // Build list of recipients from the new report_emails array, fall back to legacy report_email
    const list: EmailRecipient[] = Array.isArray(emailsRaw) ? (emailsRaw as EmailRecipient[]) : [];
    const recipients = list
      .filter((r) => r && typeof r.email === "string" && r.enabled !== false && isValidEmail(r.email))
      .map((r) => r.email.trim())
      .slice(0, 2);
    if (recipients.length === 0 && legacyEmail && isValidEmail(legacyEmail)) {
      recipients.push(legacyEmail.trim());
    }

    if (recipients.length === 0) {
      return { skipped: true, reason: "Sede sin correos configurados" };
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return { skipped: true, reason: "RESEND_API_KEY no configurada" };
    }

    // --- Build full report ---
    const s = session as Record<string, number | string | null>;

    // Aggregate sales for detailed breakdown
    const { data: sales } = await supabase
      .from("sales")
      .select("total, tip_amount, order_type, payment_method, status")
      .eq("cash_session_id", session.id);
    const rowsSales = (sales ?? []) as Array<{
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
    const byPayment: Record<string, { count: number; total: number }> = {};
    for (const r of validSales) {
      const k = String(r.payment_method ?? "—");
      byPayment[k] = byPayment[k] ?? { count: 0, total: 0 };
      byPayment[k].count += 1;
      byPayment[k].total += Number(r.total ?? 0);
    }

    // Expenses of the session
    const { data: exps } = await supabase
      .from("expenses")
      .select("amount, description, category")
      .eq("cash_session_id", session.id);
    const expenses = ((exps ?? []) as unknown) as Array<{ amount: number | null; description: string | null; category: string | null }>;
    const totalExpenses = expenses.reduce((a, r) => a + Number(r.amount ?? 0), 0);

    const cashE = Number(s.cash_expected ?? s.expected_amount ?? 0);
    const cashC = Number(s.cash_counted ?? s.counted_amount ?? 0);
    const nE = Number(s.nequi_expected ?? 0);
    const nC = Number(s.nequi_counted ?? 0);
    const bE = Number(s.bancolombia_expected ?? 0);
    const bC = Number(s.bancolombia_counted ?? 0);
    const cashD = cashC - cashE;
    const nD = nC - nE;
    const bD = bC - bE;
    const totalE = cashE + nE + bE;
    const totalC = cashC + nC + bC;
    const totalD = totalC - totalE;

    const row = (label: string, esperado: number, contado: number, diff: number) => {
      const color = diff === 0 ? "#666" : diff < 0 ? "#c0392b" : "#1f8a3a";
      const sign = diff > 0 ? "+" : "";
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${label}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(esperado)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(contado)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${color};font-weight:600">${sign}${fmt(diff)}</td>
      </tr>`;
    };

    const svcRows = Object.entries(byService)
      .map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${k}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #eee">${v.count}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #eee">${fmt(v.total)}</td></tr>`)
      .join("");
    const payRows = Object.entries(byPayment)
      .map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${k}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #eee">${v.count}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #eee">${fmt(v.total)}</td></tr>`)
      .join("");
    const expRows = expenses
      .map((e) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${e.category ?? "—"}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${e.description ?? ""}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #eee">${fmt(Number(e.amount ?? 0))}</td></tr>`)
      .join("");

    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f6f6;padding:20px;color:#222">
    <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #eaeaea">
      <div style="background:#0e8a5a;color:#fff;padding:20px 24px">
        <h1 style="margin:0;font-size:22px">Cierre de Caja · ${branchName}</h1>
        <p style="margin:4px 0 0;opacity:.9;font-size:13px">Heladería Goloso · ${branchAddress ?? ""}</p>
      </div>
      <div style="padding:24px">
        <table style="width:100%;font-size:14px;margin-bottom:18px">
          <tr><td style="padding:4px 0;color:#666">Cajero</td><td style="text-align:right;font-weight:600">${session.user_name ?? "—"}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Apertura</td><td style="text-align:right">${new Date(session.opened_at).toLocaleString("es-CO")}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Cierre</td><td style="text-align:right">${session.closed_at ? new Date(session.closed_at).toLocaleString("es-CO") : "—"}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Monto inicial</td><td style="text-align:right">${fmt(Number(session.opening_amount))}</td></tr>
        </table>

        <h3 style="margin:18px 0 8px;font-size:16px">Resumen de ventas</h3>
        <table style="width:100%;font-size:14px;margin-bottom:12px">
          <tr><td style="padding:4px 0;color:#666">Pedidos</td><td style="text-align:right;font-weight:600">${nSales}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Ventas totales</td><td style="text-align:right;font-weight:700">${fmt(totalSales)}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Ticket promedio</td><td style="text-align:right">${fmt(avgTicket)}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Propinas</td><td style="text-align:right">${fmt(totalTips)}</td></tr>
          ${cancelled.length ? `<tr><td style="padding:4px 0;color:#666">Cancelados</td><td style="text-align:right">${cancelled.length} (${fmt(cancelledValue)})</td></tr>` : ""}
        </table>

        ${svcRows ? `<h3 style="margin:18px 0 8px;font-size:16px">Por tipo de servicio</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #eee">
          <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left">Servicio</th><th style="padding:8px;text-align:right">#</th><th style="padding:8px;text-align:right">Total</th></tr></thead>
          <tbody>${svcRows}</tbody>
        </table>` : ""}

        ${payRows ? `<h3 style="margin:18px 0 8px;font-size:16px">Por método de pago</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #eee">
          <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left">Método</th><th style="padding:8px;text-align:right">#</th><th style="padding:8px;text-align:right">Total</th></tr></thead>
          <tbody>${payRows}</tbody>
        </table>` : ""}

        <h3 style="margin:18px 0 8px;font-size:16px">Arqueo por método de pago</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #eee">
          <thead><tr style="background:#fafafa">
            <th style="padding:8px;text-align:left">Método</th>
            <th style="padding:8px;text-align:right">Esperado</th>
            <th style="padding:8px;text-align:right">Reportado</th>
            <th style="padding:8px;text-align:right">Descuadre</th>
          </tr></thead>
          <tbody>
            ${row("Efectivo", cashE, cashC, cashD)}
            ${row("Nequi", nE, nC, nD)}
            ${row("Bancolombia", bE, bC, bD)}
            <tr style="background:#fafafa;font-weight:700">
              <td style="padding:10px">TOTAL</td>
              <td style="padding:10px;text-align:right">${fmt(totalE)}</td>
              <td style="padding:10px;text-align:right">${fmt(totalC)}</td>
              <td style="padding:10px;text-align:right;color:${totalD === 0 ? "#666" : totalD < 0 ? "#c0392b" : "#1f8a3a"}">${totalD > 0 ? "+" : ""}${fmt(totalD)}</td>
            </tr>
          </tbody>
        </table>

        ${expRows ? `<h3 style="margin:18px 0 8px;font-size:16px">Egresos del turno · Total ${fmt(totalExpenses)}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #eee">
          <thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left">Categoría</th><th style="padding:8px;text-align:left">Descripción</th><th style="padding:8px;text-align:right">Valor</th></tr></thead>
          <tbody>${expRows}</tbody>
        </table>` : ""}

        ${session.closing_notes ? `<p style="margin-top:18px;font-size:13px;color:#555"><b>Observaciones:</b> ${session.closing_notes}</p>` : ""}
        <p style="margin-top:24px;font-size:12px;color:#999">Reporte generado automáticamente por Goloso POS.</p>
      </div>
    </div></body></html>`;

    const from = process.env.RESEND_FROM || "Goloso POS <onboarding@resend.dev>";
    const subject = `Cierre de Caja · ${branchName} · ${new Date(session.closed_at ?? Date.now()).toLocaleDateString("es-CO")}`;

    let sentCount = 0;
    const results: Array<{ email: string; sent: boolean; error?: string; id?: string }> = [];

    for (const to of recipients) {
      let sent = false;
      let errorMsg: string | undefined;
      let providerId: string | undefined;
      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to: [to], subject, html }),
        });
        if (!resp.ok) {
          errorMsg = `Resend ${resp.status}: ${await resp.text()}`;
        } else {
          const json = (await resp.json()) as { id?: string };
          providerId = json.id;
          sent = true;
          sentCount++;
        }
      } catch (e) {
        errorMsg = e instanceof Error ? e.message : String(e);
      }

      results.push({ email: to, sent, error: errorMsg, id: providerId });

      await supabase.from("cash_report_email_log").insert({
        session_id: session.id,
        branch_id: session.branch_id,
        recipient_email: to,
        status: sent ? "sent" : "failed",
        error_message: errorMsg ?? null,
        provider_id: providerId ?? null,
      });
    }

    return { sent: sentCount > 0, count: sentCount, total: recipients.length, results };
  });
