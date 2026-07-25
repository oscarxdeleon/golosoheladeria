import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";

type Props = {
  open: boolean;
  method: string | null;
  total: number;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (last4: string) => void;
};

/**
 * Diálogo para capturar los últimos 4 dígitos de la transacción cuando el
 * medio de pago es Nequi o Bancolombia. Bloquea la venta hasta que el cajero
 * ingrese 4 dígitos válidos. El valor se almacena junto al pedido y se imprime
 * en un comprobante térmico compacto para la conciliación de caja.
 */
export function ElectronicPaymentDialog({ open, method, total, loading, onCancel, onConfirm }: Props) {
  const [digits, setDigits] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDigits("");
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [open, method]);

  const valid = /^[0-9]{4}$/.test(digits);
  const isNequi = (method ?? "").toLowerCase().includes("nequi");
  const accent = isNequi ? "text-sky-700" : "text-yellow-800";
  const accentBg = isNequi
    ? "bg-gradient-to-br from-sky-50 to-sky-100 border-sky-300"
    : "bg-gradient-to-br from-yellow-50 to-amber-100 border-amber-300";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar pago electrónico</DialogTitle>
        </DialogHeader>

        <div className={`rounded-lg border-2 ${accentBg} p-4 text-center`}>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Medio de pago</div>
          <div className={`text-2xl font-black uppercase ${accent}`}>{method ?? "—"}</div>
          <div className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">Total a cobrar</div>
          <div className="text-3xl font-black">{formatMoney(total)}</div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Últimos 4 dígitos de la transacción
          </label>
          <input
            ref={inputRef}
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            value={digits}
            onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !loading) onConfirm(digits);
              if (e.key === "Escape" && !loading) onCancel();
            }}
            placeholder="0000"
            aria-label="Últimos 4 dígitos"
            className="w-full text-center text-5xl font-black tracking-[0.6em] py-4 rounded-lg border-2 border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground text-center">
            Estos dígitos se guardan junto al pedido y se imprimen en el comprobante
            para conciliar el cierre de caja.
          </p>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={() => valid && onConfirm(digits)}
            disabled={!valid || loading}
            className="min-w-32"
          >
            {loading ? "Cobrando…" : "Confirmar pago"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
