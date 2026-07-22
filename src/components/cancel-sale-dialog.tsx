import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, XCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  cancelSaleRequest,
  CANCEL_REASON_OPTIONS,
  type CancelReasonCode,
} from "@/lib/sales-cancellation";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saleId: string | null;
  ticketLabel?: string;
  onCancelled?: () => void;
}

export function CancelSaleDialog({ open, onOpenChange, saleId, ticketLabel, onCancelled }: Props) {
  const [code, setCode] = useState<CancelReasonCode>("arrepentimiento");
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const opt = CANCEL_REASON_OPTIONS.find((o) => o.code === code);
      const label = opt?.label ?? "Anulación";
      const reason = notes.trim() ? `${label} — ${notes.trim()}` : label;
      return cancelSaleRequest({ saleId, reason, reasonCode: code });
    },
    onSuccess: (res) => {
      toast.success(res.already_cancelled ? "El pedido ya estaba anulado" : "Pedido anulado correctamente");
      qc.invalidateQueries({ queryKey: ["todos-pedidos"] });
      qc.invalidateQueries({ queryKey: ["sales-history"] });
      qc.invalidateQueries({ queryKey: ["pending-deliveries"] });
      qc.invalidateQueries({ queryKey: ["llevar-pendientes"] });
      onCancelled?.();
      onOpenChange(false);
      setNotes("");
      setCode("arrepentimiento");
    },
    onError: (err: Error) => toast.error(err.message || "No se pudo anular el pedido"),
  });

  const needsNotes = code === "otro";
  const disabled = mutation.isPending || !saleId || (needsNotes && notes.trim().length < 3);

  return (
    <Dialog open={open} onOpenChange={(v) => !mutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-rose-600" />
            Anular pedido # {ticketLabel ?? ""}
          </DialogTitle>
          <DialogDescription>
            Motivo de la Anulación
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup value={code} onValueChange={(v) => setCode(v as CancelReasonCode)}>
            <div className="grid gap-2">
              {CANCEL_REASON_OPTIONS.map((opt) => (
                <label
                  key={opt.code}
                  htmlFor={`reason-${opt.code}`}
                  className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
                >
                  <RadioGroupItem id={`reason-${opt.code}`} value={opt.code} />
                  <span className="text-lg">{opt.emoji}</span>
                  <span className="text-sm font-medium uppercase">{opt.label}</span>
                </label>
              ))}
            </div>
          </RadioGroup>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-notes" className="text-sm">
              Nota adicional {needsNotes ? <span className="text-rose-600">*</span> : <span className="text-muted-foreground">(opcional)</span>}
            </Label>
            <Textarea
              id="cancel-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={needsNotes ? "Describe el motivo con al menos 3 caracteres" : "Detalle opcional"}
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cerrar
          </Button>
          <Button variant="destructive" disabled={disabled} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
            Anular pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
