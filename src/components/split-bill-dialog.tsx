import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Minus, Plus, Banknote, Users, Package, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

export type SplitMethod = "Efectivo" | "Nequi" | "Bancolombia";
export const SPLIT_METHODS: SplitMethod[] = ["Efectivo", "Nequi", "Bancolombia"];

export interface SplitPart {
  method: SplitMethod;
  amount: number;
  items?: { name: string; qty: number; unit_price: number }[];
}

export interface SplitLineForPicker {
  key: string;
  name: string;
  unit_price: number;
  qty: number;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  total: number;
  lines: SplitLineForPicker[]; // productos del pedido para la modalidad "POR PRODUCTO"
  paying?: boolean;
  onConfirm: (splits: SplitPart[]) => Promise<void> | void;
}

const round0 = (n: number) => Math.max(0, Math.round(n));

export function SplitBillDialog({ open, onOpenChange, total, lines, paying, onConfirm }: Props) {
  const [tab, setTab] = useState<"cantidad" | "producto">("cantidad");

  // --- POR CANTIDAD ---
  const [parts, setParts] = useState(2);
  const [amounts, setAmounts] = useState<number[]>([]);
  const [methods, setMethods] = useState<SplitMethod[]>([]);

  useEffect(() => {
    if (!open) return;
    // reset defaults al abrir
    setTab("cantidad");
    setParts(2);
    const base = Math.floor(total / 2);
    setAmounts([base, total - base]);
    setMethods(["Efectivo", "Efectivo"]);
    // productos
    setPicked(
      lines.map((l) => ({ key: l.key, name: l.name, unit_price: l.unit_price, qty: 0, max: l.qty })),
    );
    setBucketMethod("Efectivo");
    setCommittedBuckets([]);
  }, [open, total, lines]);

  useEffect(() => {
    // ajusta arrays al cambiar cantidad de partes, repartiendo el total equitativamente
    setAmounts((prev) => {
      const next = Array.from({ length: parts }, (_, i) => prev[i] ?? 0);
      const base = Math.floor(total / parts);
      const rem = total - base * parts;
      for (let i = 0; i < parts; i++) next[i] = base + (i === parts - 1 ? rem : 0);
      return next;
    });
    setMethods((prev) => Array.from({ length: parts }, (_, i) => prev[i] ?? "Efectivo"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, total]);

  const cantidadTotal = amounts.reduce((a, b) => a + Number(b || 0), 0);
  const cantidadPending = total - cantidadTotal;

  // --- POR PRODUCTO ---
  interface PickRow { key: string; name: string; unit_price: number; qty: number; max: number }
  const [picked, setPicked] = useState<PickRow[]>([]);
  const [bucketMethod, setBucketMethod] = useState<SplitMethod>("Efectivo");
  interface Bucket { method: SplitMethod; amount: number; items: { name: string; qty: number; unit_price: number }[] }
  const [committedBuckets, setCommittedBuckets] = useState<Bucket[]>([]);

  const currentBucketTotal = useMemo(
    () => picked.reduce((s, r) => s + r.unit_price * r.qty, 0),
    [picked],
  );
  const alreadyCharged = useMemo(() => committedBuckets.reduce((s, b) => s + b.amount, 0), [committedBuckets]);
  const productoPending = total - alreadyCharged - currentBucketTotal;

  function commitBucket() {
    if (currentBucketTotal <= 0) return toast.error("Selecciona productos primero");
    setCommittedBuckets((prev) => [
      ...prev,
      {
        method: bucketMethod,
        amount: round0(currentBucketTotal),
        items: picked.filter((p) => p.qty > 0).map(({ name, qty, unit_price }) => ({ name, qty, unit_price })),
      },
    ]);
    // reduce max de cada línea por lo que ya se cobró
    setPicked((prev) => prev.map((r) => ({ ...r, max: r.max - r.qty, qty: 0 })));
  }

  async function handleConfirm() {
    if (tab === "cantidad") {
      if (cantidadPending !== 0) return toast.error(`Pendiente ${formatMoney(cantidadPending)}. Ajusta los valores.`);
      const splits: SplitPart[] = amounts
        .map((a, i) => ({ method: methods[i], amount: round0(a) }))
        .filter((s) => s.amount > 0);
      if (splits.length < 2) return toast.error("Debes dividir en al menos 2 pagos");
      await onConfirm(splits);
    } else {
      let all = committedBuckets;
      if (currentBucketTotal > 0) {
        all = [
          ...committedBuckets,
          {
            method: bucketMethod,
            amount: round0(currentBucketTotal),
            items: picked.filter((p) => p.qty > 0).map(({ name, qty, unit_price }) => ({ name, qty, unit_price })),
          },
        ];
      }
      const sum = all.reduce((s, b) => s + b.amount, 0);
      if (sum !== total) return toast.error(`Aún faltan ${formatMoney(total - sum)} por cobrar`);
      if (all.length < 2) return toast.error("Debes dividir en al menos 2 pagos");
      await onConfirm(all.map((b) => ({ method: b.method, amount: b.amount, items: b.items })));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!paying) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 flex flex-col max-h-[92vh] overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-center text-xl font-display flex items-center justify-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Dividir cuenta
          </DialogTitle>
          <DialogDescription className="text-center text-xs">
            Divide por número de personas o asigna productos por medio de pago.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "cantidad" | "producto")}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="cantidad"><Users className="h-4 w-4 mr-1" />Por cantidad</TabsTrigger>
              <TabsTrigger value="producto"><Package className="h-4 w-4 mr-1" />Por producto</TabsTrigger>
            </TabsList>

            <TabsContent value="cantidad" className="space-y-4 pt-4">
              <div className="text-center space-y-1">
                <div className="text-lg font-display">A cobrar: <span className="text-primary font-bold">{formatMoney(total)}</span></div>
                <div className={`text-sm ${cantidadPending === 0 ? "text-success" : "text-destructive"}`}>
                  Pendiente: {formatMoney(cantidadPending)}
                </div>
              </div>

              <div>
                <div className="text-sm text-center text-muted-foreground mb-2">¿En cuántas personas o pagos dividir?</div>
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setParts((p) => Math.max(2, p - 1))}
                    disabled={parts <= 2}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <div className="font-display text-3xl font-bold w-10 text-center">{parts}</div>
                  <Button
                    size="icon"
                    onClick={() => setParts((p) => Math.min(10, p + 1))}
                    disabled={parts >= 10}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {amounts.map((amt, i) => (
                  <div key={i} className="rounded-xl border p-3 space-y-2 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-primary" />
                      <span className="text-xs font-medium text-muted-foreground">Pago {i + 1}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={methods[i]} onValueChange={(v) => {
                        setMethods((prev) => prev.map((m, idx) => idx === i ? (v as SplitMethod) : m));
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SPLIT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <Input
                          inputMode="numeric"
                          className="pl-6 text-right font-display font-semibold"
                          value={amt === 0 ? "" : Number(amt).toLocaleString("es-CO")}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "");
                            const n = digits === "" ? 0 : Math.min(total, Number(digits));
                            setAmounts((prev) => {
                              const next = prev.map((a, idx) => (idx === i ? n : a));
                              // Auto-balance: ajusta el último pago distinto para que la suma sea igual al total
                              const others = next.reduce((s, v, idx) => (idx === i ? s : s + Number(v || 0)), 0);
                              const remaining = Math.max(0, total - n);
                              // Encuentra el índice a ajustar (el último que no sea "i")
                              const adjIdx = next.length - 1 === i ? Math.max(0, next.length - 2) : next.length - 1;
                              if (next.length >= 2 && others !== remaining) {
                                // Reparte el remanente en el índice adjIdx (y resetea los demás a 0 si sobra)
                                const rest = next.map((v, idx) => (idx === i ? n : idx === adjIdx ? 0 : Number(v || 0)));
                                const usedByOthers = rest.reduce((s, v, idx) => (idx === i || idx === adjIdx ? s : s + Number(v || 0)), 0);
                                rest[adjIdx] = Math.max(0, total - n - usedByOthers);
                                return rest;
                              }
                              return next;
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="producto" className="space-y-4 pt-4">
              <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-semibold">{formatMoney(total)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Cobrado</span><span>{formatMoney(alreadyCharged)}</span></div>
                <div className="flex justify-between font-medium"><span>Pendiente</span><span className={productoPending === 0 ? "text-success" : "text-destructive"}>{formatMoney(productoPending)}</span></div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Productos disponibles</div>
                <div className="space-y-2">
                  {picked.filter((p) => p.max > 0).length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-2">Todos los productos ya fueron asignados.</div>
                  )}
                  {picked.map((row, idx) => row.max > 0 && (
                    <div key={row.key} className="flex items-center gap-2 rounded-lg border p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{row.name}</div>
                        <div className="text-[11px] text-muted-foreground">{formatMoney(row.unit_price)} · {row.qty} de {row.max}</div>
                      </div>
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => {
                        setPicked((prev) => prev.map((r, i) => i === idx ? { ...r, qty: Math.max(0, r.qty - 1) } : r));
                      }}><Minus className="h-3 w-3" /></Button>
                      <div className="w-6 text-center text-sm font-semibold">{row.qty}</div>
                      <Button size="icon" className="h-7 w-7" onClick={() => {
                        setPicked((prev) => prev.map((r, i) => i === idx ? { ...r, qty: Math.min(r.max, r.qty + 1) } : r));
                      }}><Plus className="h-3 w-3" /></Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border-2 border-primary/30 p-3 space-y-2 bg-primary/5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cobrar seleccionados</div>
                <div className="flex items-center gap-2">
                  <Select value={bucketMethod} onValueChange={(v) => setBucketMethod(v as SplitMethod)}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SPLIT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="font-display text-lg font-bold">{formatMoney(currentBucketTotal)}</div>
                </div>
                <Button size="sm" className="w-full" onClick={commitBucket} disabled={currentBucketTotal <= 0}>
                  Agregar pago
                </Button>
              </div>

              {committedBuckets.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Pagos asignados</div>
                  <div className="space-y-2">
                    {committedBuckets.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border p-2 bg-muted/30">
                        <Badge variant="secondary">{b.method}</Badge>
                        <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
                          {b.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}
                        </div>
                        <div className="font-display font-bold">{formatMoney(b.amount)}</div>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                          setCommittedBuckets((prev) => prev.filter((_, idx) => idx !== i));
                          // devolver stock a picked
                          setPicked((prev) => {
                            const next = [...prev];
                            for (const it of b.items) {
                              const row = next.find((r) => r.name === it.name && r.unit_price === it.unit_price);
                              if (row) row.max += it.qty;
                            }
                            return next;
                          });
                        }}><X className="h-3 w-3" /></Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={paying}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={paying}>
            {paying ? "Cobrando…" : "Cobrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
