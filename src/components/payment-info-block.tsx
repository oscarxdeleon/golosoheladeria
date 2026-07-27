import { Banknote, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/format";

type Details = Record<string, unknown> | null | undefined;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface PaymentInfoBlockProps {
  method: string | null | undefined;
  details?: Details;
  /** Total del pedido; sirve para calcular el cambio si el detalle no lo trae. */
  total?: number | null;
  /** Compacto para tarjetas. */
  compact?: boolean;
  className?: string;
}

/**
 * Bloque "Información de pago" para tarjetas y detalles del POS.
 * Muestra el método y, si aplica, "Paga con" y "Cambio" para efectivo,
 * o el número/cuenta para Nequi/Bancolombia.
 */
export function PaymentInfoBlock({ method, details, total, compact = false, className }: PaymentInfoBlockProps) {
  const m = (method ?? "").trim();
  if (!m) return null;
  const d = (details ?? {}) as Record<string, unknown>;
  const isCash = /efectivo|cash/i.test(m);
  const isNequi = /nequi/i.test(m);
  const isBanco = /bancolombia/i.test(m);

  const received = num(d.cash_received) ?? num(d.cash_tendered) ?? num(d.paga_con);
  let change = num(d.change);
  if (isCash && change === null && received !== null && typeof total === "number") {
    change = Math.max(0, received - total);
  }
  const nequi = typeof d.nequi_number === "string" ? d.nequi_number : null;
  const banco = typeof d.bancolombia_account === "string" ? d.bancolombia_account : null;

  const Icon = isCash ? Banknote : Wallet;

  return (
    <div
      className={
        "rounded-md border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/10 dark:border-emerald-900/40 " +
        (compact ? "px-2 py-1.5 text-xs " : "p-2.5 text-sm ") +
        (className ?? "")
      }
    >
      <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
        <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Información de pago
      </div>
      <div className="mt-0.5 grid gap-0.5">
        <div>
          <span className="text-muted-foreground">Medio de pago: </span>
          <span className="font-semibold">{m}</span>
        </div>
        {isCash && received !== null && (
          <div>
            <span className="text-muted-foreground">Paga con: </span>
            <span className="font-semibold">{formatMoney(received)}</span>
          </div>
        )}
        {isCash && change !== null && (
          <div>
            <span className="text-muted-foreground">Cambio: </span>
            <span className="font-semibold">{formatMoney(change)}</span>
          </div>
        )}
        {isNequi && nequi && (
          <div>
            <span className="text-muted-foreground">Nequi: </span>
            <span className="font-semibold">{nequi}</span>
          </div>
        )}
        {isBanco && banco && (
          <div>
            <span className="text-muted-foreground">Cuenta: </span>
            <span className="font-semibold">{banco}</span>
          </div>
        )}
      </div>
    </div>
  );
}
