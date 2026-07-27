import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { AlertTriangle } from "lucide-react";

type Method = "Efectivo" | "Nequi" | "Bancolombia";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sale: { id: string; ticket_number: number; total: number; payment_method: string } | null;
  onSuccess?: () => void;
}

export function ChangePaymentMethodDialog({ open, onOpenChange, sale, onSuccess }: Props) {
  const [method, setMethod] = useState<Method>("Efectivo");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (!sale) return null;

  const disabled = reason.trim().length < 5 || method === sale.payment_method || saving;

  async function apply() {
    if (!sale) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("admin_change_sale_payment_method", {
        _sale_id: sale.id,
        _new_method: method,
        _reason: reason.trim(),
      } as never);
      if (error) throw error;
      toast.success(`Medio de pago actualizado a ${method}`, {
        description: `Ticket #${sale.ticket_number} · ${formatMoney(sale.total)}`,
      });
      onSuccess?.();
      onOpenChange(false);
      setReason("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo actualizar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar medio de pago</DialogTitle>
          <DialogDescription>
            Ticket <b>#{sale.ticket_number}</b> · Total <b>{formatMoney(sale.total)}</b> · Actual: <b>{sale.payment_method}</b>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-xs flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            El sistema restará este valor del medio anterior y lo sumará al nuevo. La caja debe estar <b>abierta</b>. Queda registro permanente en Auditoría.
          </div>
        </div>

        <div className="space-y-2">
          <Label>Nuevo medio de pago</Label>
          <RadioGroup value={method} onValueChange={(v) => setMethod(v as Method)} className="grid grid-cols-3 gap-2">
            {(["Efectivo", "Nequi", "Bancolombia"] as Method[]).map((m) => (
              <label
                key={m}
                className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer ${method === m ? "border-primary bg-primary/5" : ""} ${m === sale.payment_method ? "opacity-50" : ""}`}
              >
                <RadioGroupItem value={m} disabled={m === sale.payment_method} />
                <span className="text-sm">{m}</span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label>Motivo del cambio (obligatorio)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: El cliente pagó en efectivo pero se registró como Nequi."
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={apply} disabled={disabled}>{saving ? "Aplicando..." : "Aplicar cambio"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
