// Apertura automática del cajón monedero — helper único.
//
// Centraliza la lectura de las banderas por impresora de caja
// (`drawer_master_enabled` + `drawer_on_cash_*`) y evita aperturas
// duplicadas por doble clic o reintentos rápidos.

import { supabase } from "@/integrations/supabase/client";
import { kickCashDrawer } from "@/lib/print-client";

export type CashDrawerEvent =
  | "cash_sale"
  | "cash_deposit"
  | "cash_expense"
  | "cash_close"
  | "cash_open"
  | "manual";

type PrinterRow = {
  ip: string | null;
  port: number | null;
  name: string | null;
  drawer_master_enabled: boolean | null;
  drawer_on_cash_sale: boolean | null;
  drawer_on_cash_deposit: boolean | null;
  drawer_on_cash_expense: boolean | null;
  drawer_on_cash_close: boolean | null;
  drawer_on_cash_open: boolean | null;
};

const FLAG_BY_EVENT: Record<Exclude<CashDrawerEvent, "manual">, keyof PrinterRow> = {
  cash_sale: "drawer_on_cash_sale",
  cash_deposit: "drawer_on_cash_deposit",
  cash_expense: "drawer_on_cash_expense",
  cash_close: "drawer_on_cash_close",
  cash_open: "drawer_on_cash_open",
};

// Debounce por evento+operación para evitar múltiples pulsos por doble clic
// o reintentos automáticos.
const _recentFires = new Map<string, number>();
const DEDUP_WINDOW_MS = 3_000;

function looksLikeIp(v?: string | null) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(v ?? "").trim());
}

async function loadCajaPrinter(): Promise<PrinterRow | null> {
  try {
    const { getActivePrintBranchId } = await import("@/lib/print-client");
    const branchId = getActivePrintBranchId();

    const { data: printers } = await supabase
      .from("printers")
      .select(
        "name,ip,port,branch_id,drawer_master_enabled,drawer_on_cash_sale,drawer_on_cash_deposit,drawer_on_cash_expense,drawer_on_cash_close,drawer_on_cash_open",
      )
      .eq("active", true)
      .eq("area", "caja")
      .order("created_at", { ascending: false });

    const scopedPrinters = ((printers as Array<PrinterRow & { branch_id?: string | null }> | null) ?? [])
      .filter((p) => !branchId || p.branch_id === branchId || p.branch_id == null);
    const printer = scopedPrinters.find((p) => branchId && p.branch_id === branchId) ?? scopedPrinters[0] ?? null;

    if (!branchId) return printer;

    const { data: branchSettings } = await supabase
      .from("branch_print_settings")
      .select("cashier_printer_ip,cashier_printer_port")
      .eq("branch_id", branchId)
      .maybeSingle();

    const target = branchSettings as { cashier_printer_ip?: string | null; cashier_printer_port?: number | null } | null;
    const branchIp = target?.cashier_printer_ip?.trim();
    if (branchIp) {
      return {
        name: printer?.name ?? null,
        ip: branchIp,
        port: target?.cashier_printer_port ?? printer?.port ?? 9100,
        drawer_master_enabled: printer?.drawer_master_enabled ?? true,
        drawer_on_cash_sale: printer?.drawer_on_cash_sale ?? true,
        drawer_on_cash_deposit: printer?.drawer_on_cash_deposit ?? true,
        drawer_on_cash_expense: printer?.drawer_on_cash_expense ?? true,
        drawer_on_cash_close: printer?.drawer_on_cash_close ?? true,
        drawer_on_cash_open: printer?.drawer_on_cash_open ?? false,
      };
    }

    return printer;
  } catch (e) {
    console.warn("[cash-drawer] no se pudo leer impresora de caja", e);
    return null;
  }
}

export type OpenDrawerOptions = {
  event: CashDrawerEvent;
  /** Identificador único de la operación (venta, gasto…) para deduplicar pulsos. */
  operationId?: string | null;
  /** Si true, ignora las banderas y abre siempre (apertura manual autorizada). */
  force?: boolean;
};

export type OpenDrawerResult = {
  fired: boolean;
  reason?: "disabled" | "event_disabled" | "no_printer" | "dedup" | "error" | "ok";
};

/**
 * Envía el pulso de apertura del cajón para una operación en efectivo.
 * Devuelve `{ fired: false }` cuando las banderas del administrador lo
 * desactivan; nunca lanza excepción.
 */
export async function openCashDrawer(opts: OpenDrawerOptions): Promise<OpenDrawerResult> {
  const { event, operationId, force } = opts;

  // Dedup: misma operación + mismo evento no dispara dos pulsos.
  const key = `${event}:${operationId ?? "_none"}`;
  const now = Date.now();
  const last = _recentFires.get(key) ?? 0;
  if (!force && now - last < DEDUP_WINDOW_MS) {
    return { fired: false, reason: "dedup" };
  }

  const printer = await loadCajaPrinter();
  if (!printer) return { fired: false, reason: "no_printer" };

  if (!force) {
    if (printer.drawer_master_enabled === false) return { fired: false, reason: "disabled" };
    if (event !== "manual") {
      const flag = printer[FLAG_BY_EVENT[event]] as boolean | null | undefined;
      if (flag === false) return { fired: false, reason: "event_disabled" };
    }
  }

  const ip =
    printer.ip?.trim() ||
    (looksLikeIp(printer.name) ? String(printer.name).trim() : undefined);
  const port = printer.port ?? 9100;

  _recentFires.set(key, now);
  try {
    await kickCashDrawer({ printer_ip: ip, printer_port: port });
    return { fired: true, reason: "ok" };
  } catch (e) {
    console.warn("[cash-drawer] fallo al abrir cajón", e);
    return { fired: false, reason: "error" };
  }
}

/**
 * Devuelve `true` si el medio de pago corresponde a efectivo (o mixto que
 * incluye efectivo). Se usa para decidir si abrir el cajón en pagos.
 */
export function isCashPaymentMethod(method: string | null | undefined): boolean {
  const v = String(method ?? "").trim().toLowerCase();
  if (!v) return false;
  if (v.startsWith("cortes")) return false; // cortesía
  return v.includes("efectivo") || v === "cash" || v === "mixto" || v.includes("mixto");
}
