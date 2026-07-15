import { supabase } from "@/integrations/supabase/client";

export interface ReportFilters {
  from?: string; // ISO
  to?: string;
  branchId?: string | null;
  userId?: string | null;
  cashSessionId?: string | null;
}

export interface SaleRow {
  id: string;
  ticket_number: number | null;
  user_id: string | null;
  user_name: string | null;
  branch_id: string | null;
  cash_session_id: string | null;
  subtotal: number | null;
  total: number | null;
  tax: number | null;
  tip_amount: number | null;
  delivery_fee: number | null;
  payment_method: string | null;
  payment_details: Record<string, number> | null;
  order_type: string | null;
  source: string | null;
  status: string | null;
  created_at: string;
  cancelled_at: string | null;
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  modifiers: unknown;
}

export interface CashSessionRow {
  id: string;
  branch_id: string | null;
  user_id: string | null;
  user_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  counted_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  status: string;
  opening_notes: string | null;
  closing_notes: string | null;
  cash_counted: number | null;
  nequi_counted: number | null;
  bancolombia_counted: number | null;
  cash_expected: number | null;
  nequi_expected: number | null;
  bancolombia_expected: number | null;
  cash_difference: number | null;
  nequi_difference: number | null;
  bancolombia_difference: number | null;
}

export interface ExpenseRow {
  id: string;
  branch_id: string | null;
  cash_session_id: string | null;
  user_id: string | null;
  user_name: string | null;
  category: string;
  description: string | null;
  amount: number;
  payment_method: string | null;
  created_at: string;
}

export interface PurchaseRow {
  id: string;
  branch_id: string | null;
  cash_session_id: string | null;
  user_id: string | null;
  user_name: string | null;
  supplier: string | null;
  invoice_number: string | null;
  payment_method: string | null;
  total: number;
  notes: string | null;
  created_at: string;
}

// ----------- Fetchers -----------

function applyDateFilters<T extends { gte: (...a: unknown[]) => T; lte: (...a: unknown[]) => T }>(
  q: T,
  column: string,
  f: ReportFilters,
): T {
  let out = q as unknown as { gte: Function; lte: Function };
  if (f.from) out = out.gte(column, f.from);
  if (f.to) out = out.lte(column, f.to);
  return out as unknown as T;
}

export async function fetchSales(f: ReportFilters): Promise<SaleRow[]> {
  let q = supabase.from("sales").select("*").order("created_at", { ascending: false });
  if (f.branchId) q = q.eq("branch_id", f.branchId);
  if (f.userId) q = q.eq("user_id", f.userId);
  if (f.cashSessionId) q = q.eq("cash_session_id", f.cashSessionId);
  q = applyDateFilters(q, "created_at", f);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  return (data ?? []) as SaleRow[];
}

export async function fetchSaleItemsForSales(saleIds: string[]): Promise<SaleItemRow[]> {
  if (saleIds.length === 0) return [];
  // Batch in chunks of 200 ids
  const chunks: string[][] = [];
  for (let i = 0; i < saleIds.length; i += 200) chunks.push(saleIds.slice(i, i + 200));
  const results = await Promise.all(
    chunks.map((c) => supabase.from("sale_items").select("*").in("sale_id", c)),
  );
  const rows: SaleItemRow[] = [];
  for (const r of results) {
    if (r.error) throw r.error;
    rows.push(...((r.data ?? []) as SaleItemRow[]));
  }
  return rows;
}

export async function fetchCashSessions(f: ReportFilters): Promise<CashSessionRow[]> {
  let q = supabase.from("cash_sessions").select("*").order("opened_at", { ascending: false });
  if (f.branchId) q = q.eq("branch_id", f.branchId);
  if (f.userId) q = q.eq("user_id", f.userId);
  q = applyDateFilters(q, "opened_at", f);
  const { data, error } = await q.limit(1000);
  if (error) throw error;
  return (data ?? []) as CashSessionRow[];
}

export async function fetchExpenses(f: ReportFilters): Promise<ExpenseRow[]> {
  let q = supabase.from("expenses").select("*").order("created_at", { ascending: false });
  if (f.branchId) q = q.eq("branch_id", f.branchId);
  if (f.userId) q = q.eq("user_id", f.userId);
  if (f.cashSessionId) q = q.eq("cash_session_id", f.cashSessionId);
  q = applyDateFilters(q, "created_at", f);
  const { data, error } = await q.limit(2000);
  if (error) throw error;
  return (data ?? []) as ExpenseRow[];
}

export async function fetchPurchases(f: ReportFilters): Promise<PurchaseRow[]> {
  let q = supabase.from("purchases").select("*").order("created_at", { ascending: false });
  if (f.branchId) q = q.eq("branch_id", f.branchId);
  if (f.userId) q = q.eq("user_id", f.userId);
  if (f.cashSessionId) q = q.eq("cash_session_id", f.cashSessionId);
  q = applyDateFilters(q, "created_at", f);
  const { data, error } = await q.limit(2000);
  if (error) throw error;
  return (data ?? []) as PurchaseRow[];
}

// ----------- Derived helpers -----------

export const CATEGORY_INCOME = new Set(["ingreso", "entrada", "propina"]);
export const CATEGORY_WITHDRAWAL = new Set(["retiro", "salida"]);
export const CATEGORY_REFUND = new Set(["devolucion", "devolución", "reembolso"]);

export interface FinancialSummary {
  salesTotal: number;
  transactions: number;
  averageTicket: number;
  income: number; // gastos "ingreso" / "entrada"
  entries: number;
  expenses: number;
  exits: number;
  withdrawals: number;
  refunds: number;
  tips: number;
  courtesies: number;
  cancelled: number;
  cancelledValue: number;
  netBalance: number;
  cashExpected: number;
  declared: number;
  difference: number;
}

function isModifierName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return n.startsWith("+ ") || n.startsWith("→") || n.startsWith("- ") || n.startsWith("· ") || n.startsWith("• ");
}

export function paymentBreakdown(sales: SaleRow[]): Record<string, { amount: number; count: number }> {
  const out: Record<string, { amount: number; count: number }> = {};
  const bump = (rawKey: string, amount: number) => {
    const key = normalizeMethod(rawKey);
    if (!out[key]) out[key] = { amount: 0, count: 0 };
    out[key].amount += Number(amount) || 0;
    return key;
  };
  for (const s of sales) {
    if (s.status === "cancelled") continue;
    const details = (s.payment_details ?? null) as Record<string, unknown> | null;
    const isSplit =
      !!details &&
      typeof details === "object" &&
      (details as { split?: unknown }).split === true &&
      Array.isArray((details as { splits?: unknown }).splits);
    if (isSplit) {
      const splits = (details as { splits: Array<{ method?: string; amount?: number }> }).splits;
      let firstKey: string | null = null;
      for (const part of splits) {
        const k = bump(String(part?.method ?? "otros"), Number(part?.amount ?? 0));
        if (!firstKey) firstKey = k;
      }
      if (firstKey) out[firstKey].count += 1;
    } else if (details && typeof details === "object" && Object.keys(details).length > 0) {
      // Formato heredado: { efectivo: 1000, nequi: 500, ... }
      let firstKey: string | null = null;
      for (const [k, v] of Object.entries(details)) {
        // Ignorar claves de control que no son medios de pago
        if (k === "split" || k === "splits") continue;
        const key = bump(k, Number(v) || 0);
        if (!firstKey) firstKey = key;
      }
      if (firstKey) out[firstKey].count += 1;
      else {
        const key = bump(s.payment_method || "otros", Number(s.total) || 0);
        out[key].count += 1;
      }
    } else {
      const key = bump(s.payment_method || "otros", Number(s.total) || 0);
      out[key].count += 1;
    }
  }
  return out;
}

export function normalizeMethod(m: string): string {
  const s = m.toLowerCase().trim();
  if (s.includes("efectivo") || s === "cash") return "efectivo";
  if (s.includes("nequi")) return "nequi";
  if (s.includes("bancolom")) return "bancolombia";
  if (s.includes("tarjeta") || s.includes("card")) return "tarjeta";
  if (s.includes("transfer")) return "transferencia";
  if (s === "mixto" || s === "split" || s === "splits" || s.includes("dividido") || s.includes("combinado")) return "mixto";
  return s || "otros";
}

export function serviceBreakdown(sales: SaleRow[]): Record<string, { count: number; amount: number }> {
  const map: Record<string, { count: number; amount: number }> = {};
  for (const s of sales) {
    if (s.status === "cancelled") continue;
    const key = (s.order_type || s.source || "mesa") as string;
    if (!map[key]) map[key] = { count: 0, amount: 0 };
    map[key].count += 1;
    map[key].amount += Number(s.total) || 0;
  }
  return map;
}

export function computeFinancialSummary(
  sales: SaleRow[],
  expenses: ExpenseRow[],
  cashSessions: CashSessionRow[],
  purchases: PurchaseRow[] = [],
): FinancialSummary {
  const activeSales = sales.filter((s) => s.status !== "cancelled");
  const cancelledSales = sales.filter((s) => s.status === "cancelled");
  const salesTotal = activeSales.reduce((a, s) => a + (Number(s.total) || 0), 0);
  const transactions = activeSales.length;
  const tips = activeSales.reduce((a, s) => a + (Number(s.tip_amount) || 0), 0);

  let entries = 0, exits = 0, expensesAmt = 0, refunds = 0, income = 0, withdrawals = 0;
  for (const e of expenses) {
    const cat = (e.category || "").toLowerCase();
    if (CATEGORY_INCOME.has(cat)) { entries += Number(e.amount) || 0; income += Number(e.amount) || 0; }
    else if (CATEGORY_WITHDRAWAL.has(cat)) {
      exits += Number(e.amount) || 0;
      if (cat === "retiro") withdrawals += Number(e.amount) || 0;
    }
    else if (CATEGORY_REFUND.has(cat)) refunds += Number(e.amount) || 0;
    else expensesAmt += Number(e.amount) || 0;
  }
  const purchasesAmt = purchases.reduce((a, p) => a + (Number(p.total) || 0), 0);

  const cashExpected = cashSessions.reduce((a, c) => a + (Number(c.expected_amount) || 0), 0);
  const declared = cashSessions.reduce((a, c) => a + (Number(c.counted_amount) || 0), 0);
  const difference = declared - cashExpected;

  return {
    salesTotal,
    transactions,
    averageTicket: transactions > 0 ? salesTotal / transactions : 0,
    income,
    entries,
    expenses: expensesAmt + purchasesAmt,
    exits,
    withdrawals,
    refunds,
    tips,
    courtesies: 0,
    cancelled: cancelledSales.length,
    cancelledValue: cancelledSales.reduce((a, s) => a + (Number(s.total) || 0), 0),
    netBalance: salesTotal - expensesAmt - purchasesAmt - refunds + entries - exits,
    cashExpected,
    declared,
    difference,
  };
}

export interface ProductAggregate {
  productId: string | null;
  name: string;
  qty: number;
  total: number;
}

/**
 * Agrupa productos vendidos por producto principal, excluyendo modificadores
 * (por heurística de nombre, por catálogo de modificadores, y por IDs de
 * productos que en el catálogo del negocio se usan como modificadores).
 * También incorpora el precio de los modificadores (columna jsonb `modifiers`)
 * al total del producto principal en el que fueron seleccionados.
 */
export function aggregateProducts(
  items: SaleItemRow[],
  opts?: { modifierNames?: Set<string>; modifierProductIds?: Set<string> },
): ProductAggregate[] {
  const modNames = opts?.modifierNames;
  const modIds = opts?.modifierProductIds;
  const stripModifiers = (n: string) => (n ?? "").split(/\s*[+(]/)[0].trim() || n;
  const map = new Map<string, ProductAggregate>();
  for (const it of items) {
    const rawName = (it.product_name ?? "").toString();
    const nameKey = rawName.trim().toLowerCase();
    // Filtrar modificadores registrados como filas independientes
    if (isModifierName(rawName)) continue;
    if (modIds && it.product_id && modIds.has(it.product_id)) continue;
    // Cualquier fila cuyo nombre coincida con un modificador del catálogo se
    // excluye (tenga o no product_id), para que salidas, adiciones y toppings
    // no aparezcan como productos independientes.
    if (modNames && modNames.has(nameKey)) continue;

    const baseName = stripModifiers(rawName);
    const key = it.product_id ?? `name:${baseName.toLowerCase()}`;
    const qty = Number(it.qty) || 0;
    // El subtotal de la fila ya incluye el precio de los modificadores
    // (pos-screen suma el extra al unit_price, y el RPC create_public_order
    // recalcula subtotal = (base + Σ modifiers) * qty).
    const total = Number(it.subtotal) || 0;
    const prev = map.get(key);
    if (prev) {
      prev.qty += qty;
      prev.total += total;
    } else {
      map.set(key, {
        productId: it.product_id,
        name: baseName,
        qty,
        total,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.qty !== a.qty) return b.qty - a.qty;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });
}

export function courtesiesFromItems(items: SaleItemRow[]): { qty: number; count: number } {
  let qty = 0;
  let count = 0;
  for (const it of items) {
    if ((Number(it.unit_price) || 0) === 0 && (Number(it.subtotal) || 0) === 0) {
      qty += Number(it.qty) || 0;
      count += 1;
    }
  }
  return { qty, count };
}
