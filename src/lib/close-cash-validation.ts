import { supabase } from "@/integrations/supabase/client";

export type PendingRoute =
  | "/mesas"
  | "/llevar-pendientes"
  | "/domicilios"
  | "/pedidos-online"
  | "/kiosko";

export interface PendingCategory {
  key: string;
  label: string;
  count: number;
  detail: string;
  route: PendingRoute;
}

export interface ValidationResult {
  ok: boolean;
  categories: PendingCategory[];
  checkedAt: string;
  totalChecks: number;
}

const ACTIVE_STATUSES = ["pending", "confirmed", "ready"] as const;

/**
 * Limpieza previa: pedidos de kiosco que ya fueron cobrados via POS
 * (payment_method distinto de "Pendiente") pero quedaron en status='ready'
 * o 'confirmed' porque el KDS no los cerró. Se marcan como 'completed'
 * para reflejar el estado real y evitar falsos positivos en el cierre de caja.
 */
async function reconcileKioskPaidReady(branchId: string): Promise<number> {
  const { data, error } = await supabase
    .from("sales")
    .update({ status: "paid" })
    .eq("branch_id", branchId)
    .eq("source", "kiosk")
    .in("status", ["ready", "confirmed"])
    .not("payment_method", "is", null)
    .not("payment_method", "in", '("Pendiente","pendiente","")')
    .select("id");
  if (error) {
    console.warn("[close-validation:reconcile-kiosk]", error);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Domicilios ya entregados (delivery_status='entregado') que quedaron
 * en status pending/confirmed/ready porque nadie los cerró.
 */
async function reconcileDeliveredDomicilios(branchId: string): Promise<number> {
  const { data, error } = await supabase
    .from("sales")
    .update({ status: "completed" })
    .eq("branch_id", branchId)
    .eq("order_type", "domicilio")
    .in("status", ["pending", "confirmed", "ready"])
    .eq("delivery_status", "entregado")
    .select("id");
  if (error) {
    console.warn("[close-validation:reconcile-delivered]", error);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Pedidos QR (table_qr) huérfanos: (a) con pago ya registrado o
 * (b) cuya mesa ya no está ocupada (mesa libre / sin mesa).
 */
async function reconcileStaleTableQr(branchId: string): Promise<number> {
  const paid = await supabase
    .from("sales")
    .update({ status: "paid" })
    .eq("branch_id", branchId)
    .eq("source", "table_qr")
    .in("status", ["ready", "confirmed"])
    .not("payment_method", "is", null)
    .not("payment_method", "in", '("Pendiente","pendiente","")')
    .select("id");
  if (paid.error) console.warn("[close-validation:reconcile-qr-paid]", paid.error);

  const candidates = await supabase
    .from("sales")
    .select("id, table_id, restaurant_tables:table_id(status)")
    .eq("branch_id", branchId)
    .eq("source", "table_qr")
    .in("status", ["ready", "confirmed"]);
  let orphanCount = 0;
  if (!candidates.error) {
    const orphanIds = (candidates.data ?? [])
      .filter((r: { table_id: string | null; restaurant_tables: { status: string } | null }) => {
        if (!r.table_id) return true;
        const st = r.restaurant_tables?.status;
        return !st || st === "free";
      })
      .map((r) => r.id);
    if (orphanIds.length > 0) {
      const upd = await supabase
        .from("sales")
        .update({ status: "completed" })
        .in("id", orphanIds)
        .select("id");
      if (upd.error) console.warn("[close-validation:reconcile-qr-orphan]", upd.error);
      orphanCount = upd.data?.length ?? 0;
    }
  } else {
    console.warn("[close-validation:reconcile-qr-orphan-read]", candidates.error);
  }
  return (paid.data?.length ?? 0) + orphanCount;
}

/**
 * Validación Integral de Operación previa al cierre de caja.
 * Verifica que no existan pedidos, mesas ni procesos pendientes en la sede.
 * Reutilizable desde otros módulos administrativos.
 */
export async function validateOperationBeforeClose(
  branchId: string,
): Promise<ValidationResult> {
  // Reconciliación automática: kiosco cobrado pero no cerrado por KDS.
  const reconciledKiosk = await reconcileKioskPaidReady(branchId);
  if (reconciledKiosk > 0) {
    console.info(`[close-validation] Reconciliados ${reconciledKiosk} pedidos de kiosco ya cobrados.`);
  }
  const [tables, llevar, domicilio, online, tableQr, kiosk] = await Promise.all([
    supabase
      .from("restaurant_tables")
      .select("id,number,label", { count: "exact" })
      .eq("active", true)
      .eq("status", "occupied")
      .eq("branch_id", branchId),
    supabase
      .from("sales")
      .select("id,ticket_number,status", { count: "exact" })
      .eq("branch_id", branchId)
      .eq("source", "pos")
      .eq("order_type", "llevar")
      .in("status", ACTIVE_STATUSES as unknown as string[]),
    supabase
      .from("sales")
      .select("id,ticket_number,status,delivery_status", { count: "exact" })
      .eq("branch_id", branchId)
      .eq("order_type", "domicilio")
      .in("status", ACTIVE_STATUSES as unknown as string[]),
    supabase
      .from("sales")
      .select("id,ticket_number,status", { count: "exact" })
      .eq("branch_id", branchId)
      .eq("source", "online_menu")
      .in("status", ACTIVE_STATUSES as unknown as string[]),
    supabase
      .from("sales")
      .select("id,ticket_number,status", { count: "exact" })
      .eq("branch_id", branchId)
      .eq("source", "table_qr")
      .in("status", ACTIVE_STATUSES as unknown as string[]),
    supabase
      .from("sales")
      .select("id,ticket_number,status,payment_method", { count: "exact" })
      .eq("branch_id", branchId)
      .eq("source", "kiosk")
      .eq("status", "pending"),
  ]);

  const categories: PendingCategory[] = [];

  const occupiedTables = tables.data ?? [];
  if (occupiedTables.length > 0) {
    const nums = occupiedTables
      .map((t) => t.label || `#${t.number}`)
      .slice(0, 6)
      .join(", ");
    categories.push({
      key: "tables",
      label: occupiedTables.length === 1 ? "1 mesa ocupada" : `${occupiedTables.length} mesas ocupadas`,
      count: occupiedTables.length,
      detail: `Mesa(s) con consumo abierto: ${nums}${occupiedTables.length > 6 ? "…" : ""}`,
      route: "/mesas",
    });
  }

  const push = (
    key: string,
    label: string,
    count: number,
    route: PendingRoute,
    detail: string,
  ) => {
    if (count > 0) categories.push({ key, label, count, detail, route });
  };

  push(
    "llevar",
    "Pedidos para llevar pendientes",
    llevar.data?.length ?? 0,
    "/llevar-pendientes",
    "Pedidos para llevar sin cobrar, sin despachar o sin finalizar.",
  );

  // Un domicilio se considera pendiente mientras esté en pending/confirmed/ready.
  push(
    "domicilio",
    "Domicilios pendientes",
    domicilio.data?.length ?? 0,
    "/domicilios",
    "Domicilios sin cobrar, sin despachar o sin entregar.",
  );

  push(
    "online",
    "Pedidos online pendientes",
    online.data?.length ?? 0,
    "/pedidos-online",
    "Pedidos del menú online sin aceptar, preparar o cerrar.",
  );

  push(
    "table_qr",
    "Pedidos de mesa (QR) pendientes",
    tableQr.data?.length ?? 0,
    "/mesas",
    "Pedidos realizados desde QR de mesa sin cerrar.",
  );

  push(
    "kiosk",
    "Pedidos de autopedido/kiosko pendientes",
    kiosk.data?.length ?? 0,
    "/kiosko",
    "Pedidos de kiosco/autopedido sin pagar o sin finalizar.",
  );

  return {
    ok: categories.length === 0,
    categories,
    checkedAt: new Date().toISOString(),
    totalChecks: 6,
  };
}

/**
 * Registra en audit_log el resultado de la validación integral.
 * Best-effort: si falla no interrumpe la operación de caja.
 */
export async function logValidationAudit(
  branchId: string,
  result: ValidationResult,
  action: "blocked" | "allowed",
): Promise<void> {
  try {
    const { data: user } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      action: `cash_close_validation:${action}`,
      entity: "cash_sessions",
      user_id: user.user?.id ?? null,
      user_name: user.user?.email ?? null,
      branch_id: branchId,
      meta: {
        checked_at: result.checkedAt,
        total_checks: result.totalChecks,
        pending_categories: result.categories.map((c) => ({
          key: c.key,
          label: c.label,
          count: c.count,
        })),
      },
    } as never);
  } catch (err) {
    console.warn("[close-validation-audit]", err);
  }
}
