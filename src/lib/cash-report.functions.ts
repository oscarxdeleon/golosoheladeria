import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface Input {
  sessionId: string;
}

function fmt(v: number | null | undefined) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

export const sendCashReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: session, error } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .single();
    if (error || !session) throw new Error("Sesión no encontrada");

    let branchName = "—";
    let reportEmail: string | null = null;
    let branchAddress: string | null = null;
    if (session.branch_id) {
      const { data: br } = await supabase
        .from("branches")
        .select("name,address,report_email")
        .eq("id", session.branch_id)
        .single();
      if (br) {
        branchName = br.name;
        branchAddress = br.address;
        // @ts-expect-error nuevo campo
        reportEmail = br.report_email ?? null;
      }
    }

    if (!reportEmail) {
      return { skipped: true, reason: "Sede sin correo configurado" };
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return { skipped: true, reason: "RESEND_API_KEY no configurada" };
    }

    const s = session as Record<string, number | string | null>;
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

    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f6f6;padding:20px;color:#222">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #eaeaea">
      <div style="background:#0e8a5a;color:#fff;padding:20px 24px">
        <h1 style="margin:0;font-size:22px">Cierre de Caja · ${branchName}</h1>
        <p style="margin:4px 0 0;opacity:.9;font-size:13px">Heladería Goloso · ${branchAddress ?? ""}</p>
      </div>
      <div style="padding:24px">
        <table style="width:100%;font-size:14px;margin-bottom:18px">
          <tr><td style="padding:4px 0;color:#666">Cajero</td><td style="text-align:right;font-weight:600">${session.user_name}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Apertura</td><td style="text-align:right">${new Date(session.opened_at).toLocaleString("es-CO")}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Cierre</td><td style="text-align:right">${session.closed_at ? new Date(session.closed_at).toLocaleString("es-CO") : "—"}</td></tr>
          <tr><td style="padding:4px 0;color:#666">Monto inicial</td><td style="text-align:right">${fmt(Number(session.opening_amount))}</td></tr>
        </table>

        <h3 style="margin:0 0 8px;font-size:16px">Arqueo por método de pago</h3>
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

        ${session.closing_notes ? `<p style="margin-top:18px;font-size:13px;color:#555"><b>Notas:</b> ${session.closing_notes}</p>` : ""}
        <p style="margin-top:24px;font-size:12px;color:#999">Reporte generado automáticamente por Goloso POS.</p>
      </div>
    </div></body></html>`;

    const from = process.env.RESEND_FROM || "Goloso POS <onboarding@resend.dev>";
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [reportEmail],
        subject: `Cierre de Caja · ${branchName} · ${new Date(session.closed_at ?? Date.now()).toLocaleDateString("es-CO")}`,
        html,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Resend error ${resp.status}: ${txt}`);
    }
    const json = await resp.json();
    return { sent: true, id: json.id, to: reportEmail };
  });
