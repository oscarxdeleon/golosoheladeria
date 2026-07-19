import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Wand2, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { VoiceMicButton } from "@/components/voice-input";
import { parseOrderWithAI, type ParsedOrder, type ParsedOrderItem } from "@/lib/ai-order-parser.functions";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId: string | null;
  /** Devuelve los ítems parseados al carrito. Cada item ya trae product_id, qty y notes. */
  onConfirm: (items: ParsedOrderItem[], target: ParsedOrder["target"]) => void;
}

export function AiOrderDialog({ open, onOpenChange, branchId, onConfirm }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedOrder | null>(null);
  const parseFn = useServerFn(parseOrderWithAI);

  const reset = useCallback(() => {
    setText("");
    setResult(null);
    setLoading(false);
  }, []);

  const handleClose = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  async function interpret() {
    if (!text.trim()) { toast.info("Dicta o escribe la comanda primero"); return; }
    if (!branchId) { toast.error("Selecciona una sede"); return; }
    setLoading(true);
    try {
      const r = await parseFn({ data: { text: text.trim(), branchId } });
      setResult(r);
      if (r.items.length === 0) toast.warning("No se reconocieron productos");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al interpretar");
    } finally {
      setLoading(false);
    }
  }

  function updateQty(idx: number, delta: number) {
    setResult((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it, i) => i === idx ? { ...it, qty: Math.max(1, it.qty + delta) } : it);
      return { ...prev, items };
    });
  }
  function removeItem(idx: number) {
    setResult((prev) => prev ? { ...prev, items: prev.items.filter((_, i) => i !== idx) } : prev);
  }

  function confirm() {
    if (!result || result.items.length === 0) return;
    onConfirm(result.items, result.target);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Comanda con IA
          </DialogTitle>
          <DialogDescription>
            Dicta o escribe el pedido como si hablaras. Ej: "Dos malteadas de fresa, una sin azúcar, para la mesa 4".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2 items-start">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Toca el micrófono y habla, o escribe aquí…"
              rows={3}
              className="flex-1"
              autoFocus
            />
            <VoiceMicButton
              lang="es-CO"
              title="Dictar comanda"
              onTranscript={(t, isFinal) => {
                setText(t);
                if (isFinal) { /* keep text; user confirms */ }
              }}
            />
          </div>

          <Button onClick={interpret} disabled={loading || !text.trim()} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
            Interpretar con IA
          </Button>

          {result && (
            <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Vista previa</div>
                <Badge variant="outline">
                  {result.target.type === "mesa" && result.target.tableNumber
                    ? `Mesa ${result.target.tableNumber}`
                    : result.target.type === "llevar" ? "Para llevar"
                    : result.target.type === "domicilio" ? "Domicilio"
                    : "Sin destino"}
                </Badge>
              </div>

              {result.items.length === 0 && (
                <p className="text-sm text-muted-foreground">No se reconocieron productos.</p>
              )}

              <ul className="space-y-1">
                {result.items.map((it, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm bg-background rounded-md px-2 py-1.5 border">
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{it.name}</div>
                      {it.notes && <div className="text-xs text-muted-foreground truncate">{it.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(idx, -1)}>–</Button>
                      <span className="w-6 text-center font-mono">{it.qty}</span>
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(idx, +1)}>+</Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>

              {result.warnings.length > 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5 pt-1">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <div>{result.warnings.join(" · ")}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
          <Button onClick={confirm} disabled={!result || result.items.length === 0}>
            Agregar al pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
