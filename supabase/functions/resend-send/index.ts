// Edge function proxy to send emails via Resend using the connector-gateway.
// Exists because the Vercel-deployed Worker does not have LOVABLE_API_KEY /
// RESEND_API_KEY (those are only injected on Lovable Cloud). The TanStack
// server function calls this edge function to do the actual send.

// deno-lint-ignore-file no-explicit-any
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  from?: string;
  to: string[];
  subject: string;
  html: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return new Response(
      JSON.stringify({ error: "resend_not_configured" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const from = body.from || "Goloso POS <onboarding@resend.dev>";
  const useGateway = Boolean(lovableKey);
  const url = useGateway
    ? "https://connector-gateway.lovable.dev/resend/emails"
    : "https://api.resend.com/emails";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (useGateway) {
    headers["Authorization"] = `Bearer ${lovableKey}`;
    headers["X-Connection-Api-Key"] = resendKey;
  } else {
    headers["Authorization"] = `Bearer ${resendKey}`;
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ from, to: body.to, subject: body.subject, html: body.html }),
    });
    const text = await resp.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* provider returned non-json */ }
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: "resend_error", status: resp.status, detail: json ?? text }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true, id: json?.id ?? null }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "network_error", detail: (e as Error).message }),
      { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
