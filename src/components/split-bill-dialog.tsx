import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Minus, Plus, Banknote, Users, Package, X, Check, Sparkles } from "lucide-react";
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
      lines.map((l) => ({ key: l.key, name: l.name, unit_price: l.unit_price, qty: Math.min(1, l.qty), max: l.qty })),
    );
    setStaged([]);
    setMethodSheetOpen(false);
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
  interface StagedItem { key: string; name: string; unit_price: number; qty: number }
  interface Bucket { method: SplitMethod; amount: number; items: { name: string; qty: number; unit_price: number }[] }
  const [picked, setPicked] = useState<PickRow[]>([]);
  const [staged, setStaged] = useState<StagedItem[]>([]);
  const [methodSheetOpen, setMethodSheetOpen] = useState(false);
  const [committedBuckets, setCommittedBuckets] = useState<Bucket[]>([]);

  const stagedTotal = useMemo(() => staged.reduce((s, r) => s + r.unit_price * r.qty, 0), [staged]);
  const alreadyCharged = useMemo(() => committedBuckets.reduce((s, b) => s + b.amount, 0), [committedBuckets]);
  const productoPending = total - alreadyCharged;

  function addRowToStaged(rowIdx: number) {
    const row = picked[rowIdx];
    if (!row || row.qty <= 0 || row.max <= 0) return toast.error("Selecciona una cantidad");
    const q = Math.min(row.qty, row.max);
    setStaged((prev) => {
      const existing = prev.find((s) => s.key === row.key);
      if (existing) return prev.map((s) => s.key === row.key ? { ...s, qty: s.qty + q } : s);
      return [...prev, { key: row.key, name: row.name, unit_price: row.unit_price, qty: q }];
    });
    setPicked((prev) => prev.map((r, i) => i === rowIdx ? { ...r, max: r.max - q, qty: Math.min(1, r.max - q) } : r));
  }

  function removeStaged(idx: number) {
    const item = staged[idx];
    if (!item) return;
    setStaged((prev) => prev.filter((_, i) => i !== idx));
    setPicked((prev) => prev.map((r) => r.key === item.key ? { ...r, max: r.max + item.qty, qty: r.qty === 0 ? 1 : r.qty } : r));
  }

  function commitStagedAs(method: SplitMethod) {
    if (stagedTotal <= 0) return;
    setCommittedBuckets((prev) => [
      ...prev,
      { method, amount: round0(stagedTotal), items: staged.map(({ name, qty, unit_price }) => ({ name, qty, unit_price })) },
    ]);
    setStaged([]);
    setMethodSheetOpen(false);
  }

  async function handleConfirm() {
    if (tab === "cantidad") {
      // Auto-ajustar el último pago para que la suma cuadre exactamente
      const fixed = [...amounts];
      const sumOthers = fixed.slice(0, -1).reduce((s, a) => s + Number(a || 0), 0);
      fixed[fixed.length - 1] = Math.max(0, total - sumOthers);
      const finalSum = fixed.reduce((s, a) => s + Number(a || 0), 0);
      if (finalSum !== total) return toast.error(`Pendiente ${formatMoney(total - finalSum)}. Ajusta los valores.`);
      const splits: SplitPart[] = fixed
        .map((a, i) => ({ method: methods[i], amount: round0(a) }))
        .filter((s) => s.amount > 0);
      if (splits.length < 2) return toast.error("Debes dividir en al menos 2 pagos");
      await onConfirm(splits);
    } else {
      if (staged.length > 0) return toast.error("Aún tienes productos sin cobrar. Presiona COBRAR para asignarles un método de pago.");
      const all = committedBuckets;
      const sum = all.reduce((s, b) => s + b.amount, 0);
      if (sum !== total) return toast.error(`Aún faltan ${formatMoney(total - sum)} por cobrar`);
      if (all.length < 2) return toast.error("Debes dividir en al menos 2 pagos");
      await onConfirm(all.map((b) => ({ method: b.method, amount: b.amount, items: b.items })));
    }
  }

  // Estilos 3D por método de pago (mismos colores que POS)
  const METHOD_STYLE: Record<SplitMethod, { bg: string; color: string; shadow: string; ring: string; soft: string }> = {
    Efectivo: {
      bg: "linear-gradient(180deg, #4ade80 0%, #16a34a 100%)",
      color: "#ffffff",
      shadow: "inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -5px 0 rgba(0,0,0,0.22), 0 8px 18px -6px rgba(22,163,74,0.55)",
      ring: "#16a34a",
      soft: "rgba(22,163,74,0.08)",
    },
    Nequi: {
      bg: "linear-gradient(180deg, #bae6fd 0%, #38bdf8 100%)",
      color: "#0c4a6e",
      shadow: "inset 0 2px 0 rgba(255,255,255,0.85), inset 0 -5px 0 rgba(0,0,0,0.15), 0 8px 18px -6px rgba(14,165,233,0.55)",
      ring: "#0ea5e9",
      soft: "rgba(56,189,248,0.10)",
    },
    Bancolombia: {
      bg: "linear-gradient(180deg, #fde047 0%, #eab308 100%)",
      color: "#1a1a1a",
      shadow: "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -5px 0 rgba(0,0,0,0.2), 0 8px 18px -6px rgba(202,138,4,0.55)",
      ring: "#eab308",
      soft: "rgba(234,179,8,0.12)",
    },
  };

  function MethodPicker({ value, onChange, size = "md" }: { value: SplitMethod; onChange: (m: SplitMethod) => void; size?: "sm" | "md" }) {
    return (
      <div className={`grid grid-cols-3 gap-1.5 ${size === "sm" ? "" : ""}`}>
        {SPLIT_METHODS.map((m) => {
          const s = METHOD_STYLE[m];
          const active = value === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onChange(m)}
              style={active
                ? { background: s.bg, color: s.color, boxShadow: s.shadow }
                : { background: "#f3f4f6", color: "#374151" }}
              className={`relative flex items-center justify-center gap-1 rounded-full font-bold uppercase tracking-wide transition-all duration-150 ${size === "sm" ? "h-9 text-[11px]" : "h-11 text-xs"} ${active ? "scale-[1.02]" : "hover:scale-[1.01] opacity-70"}`}
            >
              {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              <span className="truncate">{m}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!paying) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 flex flex-col max-h-[92vh] overflow-hidden border-0 bg-gradient-to-b from-background via-background to-primary/5">
        {/* HERO HEADER con gradiente y total gigante */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-primary/70 px-5 pt-5 pb-6 text-primary-foreground">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -left-8 bottom-0 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <DialogHeader className="relative space-y-2">
            <DialogTitle className="text-center text-2xl font-display font-black tracking-tight flex items-center justify-center gap-2">
              <Sparkles className="h-5 w-5 opacity-90" />
              Dividir cuenta
              <Sparkles className="h-5 w-5 opacity-90" />
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-primary-foreground/80">
              Divide por número de personas o asigna productos por medio de pago
            </DialogDescription>
          </DialogHeader>
          <div className="relative mt-3 flex items-baseline justify-center gap-1">
            <span className="text-2xl font-bold opacity-80">$</span>
            <span className="font-display text-5xl font-black tabular-nums tracking-tight drop-shadow-sm">
              {Number(total).toLocaleString("es-CO")}
            </span>
          </div>
          <div className={`mt-1 flex items-center justify-center gap-1.5 text-xs font-semibold ${tab === "cantidad" ? (cantidadPending === 0 ? "text-emerald-100" : "text-amber-100") : (productoPending === 0 ? "text-emerald-100" : "text-amber-100")}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${((tab === "cantidad" ? cantidadPending : productoPending) === 0) ? "bg-emerald-300" : "bg-amber-300"} animate-pulse`} />
            {tab === "cantidad" ? (cantidadPending === 0 ? "Cuadrado" : `Pendiente ${formatMoney(cantidadPending)}`) : (productoPending === 0 ? "Cuadrado" : `Pendiente ${formatMoney(productoPending)}`)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "cantidad" | "producto")}>
            <TabsList className="grid grid-cols-2 w-full h-11 rounded-full bg-muted/60 p-1">
              <TabsTrigger value="cantidad" className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:text-primary font-semibold">
                <Users className="h-4 w-4 mr-1.5" />Por cantidad
              </TabsTrigger>
              <TabsTrigger value="producto" className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:text-primary font-semibold">
                <Package className="h-4 w-4 mr-1.5" />Por producto
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cantidad" className="space-y-4 pt-4">
              {/* SELECTOR DE PARTES */}
              <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-4 text-center">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-3">¿En cuántos pagos dividir?</div>
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 rounded-full border-2 shadow-sm hover:scale-105 transition-transform"
                    onClick={() => setParts((p) => Math.max(2, p - 1))}
                    disabled={parts <= 2}
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                  <div className="relative">
                    <div className="font-display text-6xl font-black text-primary tabular-nums leading-none drop-shadow-sm">{parts}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center mt-1">Personas</div>
                  </div>
                  <Button
                    size="icon"
                    className="h-12 w-12 rounded-full shadow-md hover:scale-105 transition-transform bg-gradient-to-br from-primary to-primary/80"
                    onClick={() => setParts((p) => Math.min(10, p + 1))}
                    disabled={parts >= 10}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              {/* PAGOS INDIVIDUALES */}
              <div className="space-y-2.5">
                {amounts.map((amt, i) => {
                  const st = METHOD_STYLE[methods[i] ?? "Efectivo"];
                  return (
                    <div
                      key={i}
                      className="relative rounded-2xl border-2 p-3 space-y-2.5 transition-all"
                      style={{ borderColor: `${st.ring}55`, background: st.soft }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-8 w-8 items-center justify-center rounded-full font-display font-black text-sm"
                            style={{ background: st.bg, color: st.color, boxShadow: st.shadow }}
                          >
                            {i + 1}
                          </div>
                          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Pago {i + 1}</span>
                        </div>
                        <div className="font-display text-lg font-black tabular-nums" style={{ color: st.ring }}>
                          {formatMoney(amt || 0)}
                        </div>
                      </div>

                      <MethodPicker
                        value={methods[i] ?? "Efectivo"}
                        onChange={(v) => setMethods((prev) => prev.map((m, idx) => idx === i ? v : m))}
                        size="sm"
                      />

                      <div className="relative">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-muted-foreground">$</span>
                        <Input
                          inputMode="numeric"
                          className="pl-10 h-14 text-right font-display text-2xl font-black tabular-nums border-2 rounded-xl bg-background shadow-inner focus-visible:ring-2"
                          style={{ borderColor: `${st.ring}44` }}
                          value={amt === 0 ? "" : Number(amt).toLocaleString("es-CO")}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "");
                            const n = digits === "" ? 0 : Math.min(total, Number(digits));
                            setAmounts((prev) => {
                              const next = prev.map((a, idx) => (idx === i ? n : a));
                              const adjIdx = next.length - 1 === i ? Math.max(0, next.length - 2) : next.length - 1;
                              if (next.length >= 2) {
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
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="producto" className="space-y-4 pt-4">
              <div className="rounded-2xl bg-gradient-to-br from-muted/60 to-muted/30 p-4 space-y-1.5 border">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total</span><span className="font-display font-bold">{formatMoney(total)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Cobrado</span><span className="font-display font-bold text-emerald-600">{formatMoney(alreadyCharged)}</span></div>
                <div className="h-px bg-border my-1" />
                <div className="flex justify-between text-base font-bold">
                  <span>Pendiente</span>
                  <span className={`font-display ${productoPending === 0 ? "text-emerald-600" : "text-amber-600"}`}>{formatMoney(productoPending)}</span>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">Productos disponibles</div>
                <div className="space-y-1.5">
                  {picked.filter((p) => p.max > 0).length === 0 && (
                    <div className="rounded-xl border-2 border-dashed p-4 text-xs text-muted-foreground text-center">
                      Todos los productos ya fueron asignados ✓
                    </div>
                  )}
                  {picked.map((row, idx) => row.max > 0 && (
                    <div key={row.key} className="rounded-xl border-2 p-2.5 bg-background hover:border-primary/40 transition-colors space-y-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{row.name} <span className="text-muted-foreground font-normal">({formatMoney(row.unit_price)})</span></div>
                        <div className="text-[11px] text-muted-foreground">0 de {row.max}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="icon" variant="outline" className="h-9 w-9 rounded-full" onClick={() => {
                          setPicked((prev) => prev.map((r, i) => i === idx ? { ...r, qty: Math.max(1, r.qty - 1) } : r));
                        }}><Minus className="h-4 w-4" /></Button>
                        <div className="w-10 text-center font-display font-black text-primary text-lg">{row.qty}</div>
                        <Button size="icon" className="h-9 w-9 rounded-full" onClick={() => {
                          setPicked((prev) => prev.map((r, i) => i === idx ? { ...r, qty: Math.min(r.max, r.qty + 1) } : r));
                        }}><Plus className="h-4 w-4" /></Button>
                        <Button
                          variant="outline"
                          className="ml-auto h-9 rounded-full px-4 font-bold uppercase tracking-wide border-2 border-primary/60 text-primary hover:bg-primary hover:text-primary-foreground"
                          onClick={() => addRowToStaged(idx)}
                        >
                          Agregar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* PRODUCTOS A COBRAR (staged) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-black">Productos a cobrar</div>
                    <div className="text-xs text-muted-foreground">Total a cobrar: <span className="font-display font-bold text-foreground">{formatMoney(stagedTotal)}</span></div>
                  </div>
                  <Button
                    onClick={() => setMethodSheetOpen(true)}
                    disabled={stagedTotal <= 0}
                    className="h-11 rounded-full px-6 font-black uppercase tracking-wide shadow-md bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white disabled:opacity-40"
                  >
                    Cobrar <Banknote className="h-4 w-4 ml-1.5" />
                  </Button>
                </div>
                {staged.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed p-4 text-xs text-muted-foreground text-center">
                    Agrega productos para cobrarlos con un método de pago
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {staged.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-xl border-2 p-2.5 bg-background">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{it.name} <span className="text-muted-foreground font-normal">({formatMoney(it.unit_price)})</span></div>
                          <div className="text-[11px] text-muted-foreground">Cantidad {it.qty} · {formatMoney(it.unit_price * it.qty)}</div>
                        </div>
                        <Button variant="outline" className="h-9 rounded-full px-4 font-bold uppercase text-xs border-2 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive" onClick={() => removeStaged(idx)}>
                          Eliminar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* METHOD SHEET */}
              {methodSheetOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setMethodSheetOpen(false)}>
                  <div className="w-full sm:max-w-md bg-background rounded-t-3xl sm:rounded-3xl p-5 space-y-3 shadow-2xl animate-in slide-in-from-bottom" onClick={(e) => e.stopPropagation()}>
                    <div className="text-center">
                      <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-muted sm:hidden" />
                      <div className="text-lg font-black">Selecciona método de pago</div>
                      <div className="text-xs text-muted-foreground">Total: <span className="font-display font-bold text-foreground">{formatMoney(stagedTotal)}</span></div>
                    </div>
                    <div className="space-y-2 pt-1">
                      {SPLIT_METHODS.map((m) => {
                        const s = METHOD_STYLE[m];
                        return (
                          <button
                            key={m}
                            onClick={() => commitStagedAs(m)}
                            className="w-full flex items-center gap-3 rounded-2xl border-2 p-3 hover:scale-[1.01] transition-transform"
                            style={{ borderColor: `${s.ring}55`, background: s.soft }}
                          >
                            <div className="h-11 w-11 rounded-full flex items-center justify-center font-black" style={{ background: s.bg, color: s.color, boxShadow: s.shadow }}>
                              <Banknote className="h-5 w-5" />
                            </div>
                            <div className="flex-1 text-left font-black uppercase tracking-wide" style={{ color: s.ring }}>{m}</div>
                            <Check className="h-4 w-4 text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                    <Button variant="outline" className="w-full h-11 rounded-full font-semibold" onClick={() => setMethodSheetOpen(false)}>Cancelar</Button>
                  </div>
                </div>
              )}

              {committedBuckets.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">Pagos asignados</div>
                  <div className="space-y-1.5">
                    {committedBuckets.map((b, i) => {
                      const s = METHOD_STYLE[b.method];
                      return (
                        <div key={i} className="flex items-center gap-2 rounded-xl border-2 p-2.5" style={{ borderColor: `${s.ring}66`, background: s.soft }}>
                          <div
                            className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide"
                            style={{ background: s.bg, color: s.color, boxShadow: s.shadow }}
                          >
                            {b.method}
                          </div>
                          <div className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">
                            {b.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}
                          </div>
                          <div className="font-display font-black tabular-nums" style={{ color: s.ring }}>{formatMoney(b.amount)}</div>
                          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full hover:bg-destructive/10 hover:text-destructive" onClick={() => {
                            setCommittedBuckets((prev) => prev.filter((_, idx) => idx !== i));
                            setPicked((prev) => {
                              const next = [...prev];
                              for (const it of b.items) {
                                const row = next.find((r) => r.name === it.name && r.unit_price === it.unit_price);
                                if (row) row.max += it.qty;
                              }
                              return next;
                            });
                          }}><X className="h-3.5 w-3.5" /></Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t bg-background/95 backdrop-blur px-5 py-3 gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={paying} className="h-12 rounded-full font-semibold">
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={paying}
            className="h-12 flex-1 rounded-full font-black uppercase tracking-wide text-base shadow-lg bg-gradient-to-r from-primary via-primary to-primary/80 hover:scale-[1.01] transition-transform"
          >
            <Banknote className="h-5 w-5 mr-2" />
            {paying ? "Cobrando…" : `Cobrar ${formatMoney(total)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

