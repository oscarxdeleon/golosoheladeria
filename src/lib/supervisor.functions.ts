import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PIN_RE = /^\d{4}$/;

function hashPin(pin: string, salt: string): string {
  return createHash("sha256").update(`${salt}::${pin}`).digest("hex");
}

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Solo administradores");
}

function reqMeta() {
  const req = getRequest();
  const h = req?.headers;
  return {
    ip: h?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h?.get("x-real-ip") ?? null,
    ua: h?.get("user-agent") ?? null,
  };
}

// ---------- Admin management ----------

export const listSupervisorAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("supervisor_accounts")
      .select("id,username,display_name,active,access_token,last_login_at,locked_until,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSupervisorAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, "Solo letras, números . _ -"),
      display_name: z.string().trim().min(2).max(80),
      pin: z.string().regex(PIN_RE, "PIN debe ser 4 dígitos"),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const salt = randomBytes(16).toString("hex");
    const pin_hash = `${salt}:${hashPin(data.pin, salt)}`;
    const { data: row, error } = await supabaseAdmin
      .from("supervisor_accounts")
      .insert({
        username: data.username.toLowerCase(),
        display_name: data.display_name,
        pin_hash,
      })
      .select("id,access_token")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateSupervisorAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      display_name: z.string().trim().min(2).max(80).optional(),
      pin: z.string().regex(PIN_RE).optional(),
      active: z.boolean().optional(),
      regenerate_token: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.display_name !== undefined) patch.display_name = data.display_name;
    if (data.active !== undefined) patch.active = data.active;
    if (data.pin) {
      const salt = randomBytes(16).toString("hex");
      patch.pin_hash = `${salt}:${hashPin(data.pin, salt)}`;
      patch.failed_attempts = 0;
      patch.locked_until = null;
    }
    if (data.regenerate_token) {
      patch.access_token = randomBytes(18).toString("hex");
      // revoke existing sessions
      await supabaseAdmin.from("supervisor_sessions").update({ revoked_at: new Date().toISOString() }).eq("account_id", data.id).is("revoked_at", null);
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("supervisor_accounts")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const deleteSupervisorAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("supervisor_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Public login (no auth middleware; validated server-side) ----------

export const supervisorLogin = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      token: z.string().min(1).optional(),
      username: z.string().trim().min(1).max(60),
      pin: z.string().regex(PIN_RE, "PIN debe ser 4 dígitos"),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ip, ua } = reqMeta();
    const username = data.username.toLowerCase();

    let query = supabaseAdmin
      .from("supervisor_accounts")
      .select("id,username,display_name,pin_hash,active,failed_attempts,locked_until,access_token")
      .eq("username", username);
    if (data.token) query = query.eq("access_token", data.token);

    const { data: acct } = await query.maybeSingle();

    const logFail = async (accountId: string | null, reason: string) => {
      await supabaseAdmin.from("supervisor_audit_log").insert({
        account_id: accountId,
        username,
        event: "login_failed",
        detail: { reason },
        ip,
        user_agent: ua,
      });
    };

    if (!acct) {
      await logFail(null, "not_found");
      throw new Error("Credenciales incorrectas");
    }
    if (!acct.active) {
      await logFail(acct.id, "inactive");
      throw new Error("Acceso desactivado");
    }
    if (acct.locked_until && new Date(acct.locked_until) > new Date()) {
      await logFail(acct.id, "locked");
      throw new Error("Acceso bloqueado temporalmente. Intenta más tarde.");
    }

    const [salt, expected] = (acct.pin_hash ?? "").split(":");
    const ok = !!salt && expected === hashPin(data.pin, salt);
    if (!ok) {
      const attempts = (acct.failed_attempts ?? 0) + 1;
      const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      await supabaseAdmin
        .from("supervisor_accounts")
        .update({ failed_attempts: attempts, locked_until: lock })
        .eq("id", acct.id);
      await logFail(acct.id, "bad_pin");
      throw new Error(lock ? "Demasiados intentos. Acceso bloqueado 15 min." : "Credenciales incorrectas");
    }

    // Success: create session
    const { data: sess, error: sErr } = await supabaseAdmin
      .from("supervisor_sessions")
      .insert({ account_id: acct.id, ip, user_agent: ua })
      .select("session_token,expires_at")
      .single();
    if (sErr || !sess) throw new Error("No se pudo iniciar sesión");

    await supabaseAdmin
      .from("supervisor_accounts")
      .update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
      .eq("id", acct.id);

    await supabaseAdmin.from("supervisor_audit_log").insert({
      account_id: acct.id,
      username,
      event: "login_success",
      ip,
      user_agent: ua,
    });

    return {
      session_token: sess.session_token,
      expires_at: sess.expires_at,
      display_name: acct.display_name,
      username: acct.username,
    };
  });

async function requireSupervisorSession(session_token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: sess } = await supabaseAdmin
    .from("supervisor_sessions")
    .select("id,account_id,expires_at,revoked_at,supervisor_accounts(id,username,display_name,active)")
    .eq("session_token", session_token)
    .maybeSingle();
  if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) {
    throw new Error("Sesión expirada");
  }
  const acct = sess.supervisor_accounts as unknown as { id: string; username: string; display_name: string; active: boolean } | null;
  if (!acct?.active) throw new Error("Acceso desactivado");
  return { account: acct, sessionId: sess.id };
}

export const supervisorLogout = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ session_token: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ip, ua } = reqMeta();
    const { data: sess } = await supabaseAdmin
      .from("supervisor_sessions")
      .select("id,account_id")
      .eq("session_token", data.session_token)
      .maybeSingle();
    if (sess) {
      await supabaseAdmin.from("supervisor_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", sess.id);
      await supabaseAdmin.from("supervisor_audit_log").insert({
        account_id: sess.account_id,
        event: "logout",
        ip,
        user_agent: ua,
      });
    }
    return { ok: true };
  });

// ---------- Read-only data feed for the supervisor dashboard ----------

export const supervisorDashboard = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      session_token: z.string().min(1),
      branch_id: z.string().uuid().nullable().optional(),
      log_switch: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { account } = await requireSupervisorSession(data.session_token);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.log_switch && data.branch_id) {
      await supabaseAdmin.from("supervisor_audit_log").insert({
        account_id: account.id,
        username: account.username,
        event: "branch_switch",
        detail: { branch_id: data.branch_id },
      });
    }

    const { data: branches } = await supabaseAdmin
      .from("branches")
      .select("id,name,is_main")
      .order("is_main", { ascending: false })
      .order("name");

    const branchId = data.branch_id ?? branches?.find((b) => b.is_main)?.id ?? branches?.[0]?.id ?? null;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const iso = startOfDay.toISOString();

    // Sales today for branch
    let salesQ = supabaseAdmin
      .from("sales")
      .select("id,total,payment_method,order_type,created_at,delivery_fee,status")
      .gte("created_at", iso);
    if (branchId) salesQ = salesQ.eq("branch_id", branchId);
    const { data: sales } = await salesQ;
    const salesList = (sales ?? []).filter((s) => s.status !== "cancelled");

    const totalSales = salesList.reduce((a, s) => a + Number(s.total ?? 0), 0);
    const orderCount = salesList.length;
    const avgTicket = orderCount ? totalSales / orderCount : 0;

    const byHour: Record<string, number> = {};
    const byService: Record<string, number> = {};
    const byPayment: Record<string, number> = {};
    for (const s of salesList) {
      const h = String(new Date(s.created_at).getHours()).padStart(2, "0");
      byHour[h] = (byHour[h] ?? 0) + Number(s.total ?? 0);
      const svc = s.order_type ?? "otro";
      byService[svc] = (byService[svc] ?? 0) + Number(s.total ?? 0);
      const pm = s.payment_method ?? "otro";
      byPayment[pm] = (byPayment[pm] ?? 0) + Number(s.total ?? 0);
    }

    const cashTotal = Object.entries(byPayment)
      .filter(([k]) => k.toLowerCase().includes("efectivo") || k.toLowerCase() === "cash")
      .reduce((a, [, v]) => a + v, 0);
    const digitalTotal = totalSales - cashTotal;

    // Top products
    const saleIds = salesList.map((s) => s.id);
    let topProducts: { name: string; qty: number }[] = [];
    let lowProducts: { name: string; qty: number }[] = [];
    if (saleIds.length) {
      const { data: items } = await supabaseAdmin
        .from("sale_items")
        .select("product_name,quantity")
        .in("sale_id", saleIds);
      const agg: Record<string, number> = {};
      (items ?? []).forEach((it) => {
        const n = (it as { product_name?: string }).product_name ?? "—";
        agg[n] = (agg[n] ?? 0) + Number((it as { quantity?: number }).quantity ?? 0);
      });
      const arr = Object.entries(agg).map(([name, qty]) => ({ name, qty }));
      arr.sort((a, b) => b.qty - a.qty);
      topProducts = arr.slice(0, 5);
      lowProducts = arr.slice(-5).reverse();
    }

    // Active cash session
    let cashQ = supabaseAdmin
      .from("cash_sessions")
      .select("id,status,opened_at,closed_at,opening_amount,cashier_name,cashier_id")
      .order("opened_at", { ascending: false })
      .limit(1);
    if (branchId) cashQ = cashQ.eq("branch_id", branchId);
    const { data: cs } = await cashQ;
    const activeCash = cs?.[0] ?? null;

    // Orders state
    let ordersQ = supabaseAdmin
      .from("sales")
      .select("id,order_type,status,table_id,created_at")
      .in("status", ["open", "pending", "in_progress", "ready", "preparing"]);
    if (branchId) ordersQ = ordersQ.eq("branch_id", branchId);
    const { data: openOrders } = await ordersQ;
    const orders = (openOrders ?? []) as Array<{ order_type: string | null; status: string | null; table_id: string | null }>;
    const tablesOccupied = new Set(orders.filter((o) => o.order_type === "mesa" && o.table_id != null).map((o) => o.table_id)).size;
    const pendingLlevar = orders.filter((o) => o.order_type === "llevar").length;
    const pendingDomicilio = orders.filter((o) => o.order_type === "domicilio").length;
    const preparing = orders.filter((o) => ["preparing", "in_progress"].includes(o.status ?? "")).length;


    return {
      supervisor: { username: account.username, display_name: account.display_name },
      branches: branches ?? [],
      active_branch_id: branchId,
      generated_at: new Date().toISOString(),
      summary: {
        total_sales: totalSales,
        order_count: orderCount,
        avg_ticket: avgTicket,
        cash_total: cashTotal,
        digital_total: digitalTotal,
        tables_occupied: tablesOccupied,
        pending_llevar: pendingLlevar,
        pending_domicilio: pendingDomicilio,
        preparing,
      },
      by_hour: byHour,
      by_service: byService,
      by_payment: byPayment,
      top_products: topProducts,
      low_products: lowProducts,
      active_cash: activeCash,
    };
  });

export const listSupervisorAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("supervisor_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });
