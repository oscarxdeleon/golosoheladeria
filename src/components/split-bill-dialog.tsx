import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Minus, Plus, Banknote, Users, Package, X, Check, Flame } from "lucide-react";
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
  lines: SplitLineForPicker[];
  paying?: boolean;
  onConfirm: (splits: SplitPart[]) => Promise<void> | void;
}

const round0 = (n: number) => Math.max(0, Math.round(n));

// Paleta Sunset Blaze por método de pago
const METHOD_STYLE: Record<SplitMethod, { bg: string; color: string; shadow: string; ring: string; soft: string }> = {
  Efectivo: {
    bg: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
    color: "#fff",
    shadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 14px -6px rgba(79,70,229,0.55)",
    ring: "#4f46e5",
    soft: "rgba(79,70,229,0.10)",
  },
  Nequi: {
    bg: "linear-gradient(135deg, #818cf8 0%, #4338ca 100%)",
    color: "#fff",
    shadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 14px -6px rgba(129,140,248,0.55)",
    ring: "#818cf8",
    soft: "rgba(129,140,248,0.10)",
  },
  Bancolombia: {
    bg: "linear-gradient(135deg, #4338ca 0%, #312e81 100%)",
    color: "#fff",
    shadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 14px -6px rgba(67,56,202,0.55)",
    ring: "#4338ca",
    soft: "rgba(67,56,202,0.10)",
  },
};

export function SplitBillDialog({ open, onOpenChange, total, lines, paying, onConfirm }: Props) {
  const [tab, setTab] = useState<"cantidad" | "producto">("cantidad");

  // --- POR CANTIDAD (flujo secuencial: aplicar pago → saldo automático) ---
  interface CashPayment { method: SplitMethod; amount: number }
  const [cashPayments, setCashPayments] = useState<CashPayment[]>([]);
  const [draftAmount, setDraftAmount] = useState<number>(0);
  const [draftMethod, setDraftMethod] = useState<SplitMethod>("Efectivo");
  const [showDraft, setShowDraft] = useState<boolean>(true);

  useEffect(() => {
    if (!open) return;
    setTab("cantidad");
    setCashPayments([]);
    setDraftAmount(total);
    setDraftMethod("Efectivo");
    setShowDraft(true);
    setPicked(
      lines.map((l) => ({ key: l.key, name: l.name, unit_price: l.unit_price, qty: Math.min(1, l.qty), max: l.qty })),
    );
    setStaged([]);
    setMethodSheetOpen(false);
    setCommittedBuckets([]);
  }, [open, total, lines]);

  const cantidadPaid = cashPayments.reduce((s, p) => s + p.amount, 0);
  const cantidadPending = Math.max(0, total - cantidadPaid);

  function applyDraftPayment() {
    const n = round0(draftAmount);
    if (n <= 0) return toast.error("Ingresa un valor a pagar");
    if (n > cantidadPending) return toast.error(`El pago no puede superar ${formatMoney(cantidadPending)}`);
    const next = [...cashPayments, { method: draftMethod, amount: n }];
    setCashPayments(next);
    const newPending = total - next.reduce((s, p) => s + p.amount, 0);
    setDraftAmount(newPending);
    // Mantener el formulario visible con el saldo restante pre-cargado para
    // que el cajero solo tenga que elegir método y presionar aplicar.
    setShowDraft(newPending > 0);
  }

  function removeCashPayment(idx: number) {
    const next = cashPayments.filter((_, i) => i !== idx);
    setCashPayments(next);
    const newPending = total - next.reduce((s, p) => s + p.amount, 0);
    setDraftAmount(newPending);
  }


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
      if (cantidadPending !== 0) return toast.error(`Aún faltan ${formatMoney(cantidadPending)} por cobrar`);
      if (cashPayments.length < 2) return toast.error("Debes dividir en al menos 2 pagos");
      await onConfirm(cashPayments.map((p) => ({ method: p.method, amount: p.amount })));
    } else {
      if (staged.length > 0) return toast.error("Aún tienes productos sin cobrar. Presiona COBRAR para asignarles un método de pago.");
      const all = committedBuckets;
      const sum = all.reduce((s, b) => s + b.amount, 0);
      if (sum !== total) return toast.error(`Aún faltan ${formatMoney(total - sum)} por cobrar`);
      if (all.length < 2) return toast.error("Debes dividir en al menos 2 pagos");
      await onConfirm(all.map((b) => ({ method: b.method, amount: b.amount, items: b.items })));
    }
  }

  function MethodPicker({ value, onChange }: { value: SplitMethod; onChange: (m: SplitMethod) => void }) {
    return (
      <div className="grid grid-cols-3 gap-1">
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
                : { background: "rgba(20,20,50,0.85)", color: "#94a3b8", border: "1px solid rgba(79,70,229,0.18)" }}
              className={`sunset-display flex items-center justify-center gap-1 rounded-lg h-8 text-[13px] tracking-wider transition-all duration-150 ${active ? "scale-[1.02]" : "hover:opacity-90"}`}
            >
              {active && <Check className="h-3 w-3" strokeWidth={3} />}
              <span className="truncate">{m}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!paying) onOpenChange(o); }}>
      <DialogContent className="sunset-theme sm:max-w-md p-0 gap-0 flex flex-col max-h-[92vh] overflow-hidden border-0" style={{ background: "linear-gradient(180deg, #0a0a1a 0%, #141432 100%)" }}>
        {/* HERO — compacto */}
        <div className="relative shrink-0 overflow-hidden px-4 pt-3 pb-4" style={{ background: "var(--sunset-gradient)", color: "#fff" }}>
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#1e1e5a]/15 blur-2xl" />
          <div className="pointer-events-none absolute -left-6 -bottom-6 h-24 w-24 rounded-full bg-[#1e1e5a]/10 blur-2xl" />
          <DialogHeader className="relative space-y-0.5">
            <DialogTitle className="sunset-display text-center text-2xl leading-none flex items-center justify-center gap-2">
              <Flame className="h-4 w-4" />
              DIVIDIR CUENTA
              <Flame className="h-4 w-4" />
            </DialogTitle>
            <DialogDescription className="text-center text-[11px] text-white/80 sunset-body">
              Por personas o por producto
            </DialogDescription>
          </DialogHeader>
          <div className="relative mt-2 flex items-baseline justify-center gap-1">
            <span className="text-base font-bold opacity-80">$</span>
            <span className="sunset-display text-4xl leading-none tabular-nums drop-shadow-sm">
              {Number(total).toLocaleString("es-CO")}
            </span>
          </div>
          <div className={`mt-1 flex items-center justify-center gap-1.5 text-[11px] sunset-body font-semibold`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${((tab === "cantidad" ? cantidadPending : productoPending) === 0) ? "bg-emerald-300" : "bg-amber-200"} animate-pulse`} />
            {tab === "cantidad" ? (cantidadPending === 0 ? "Cuadrado" : `Pendiente ${formatMoney(cantidadPending)}`) : (productoPending === 0 ? "Cuadrado" : `Pendiente ${formatMoney(productoPending)}`)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "cantidad" | "producto")}>
            <TabsList className="grid grid-cols-2 w-full h-9 rounded-lg p-0.5" style={{ background: "rgba(79,70,229,0.10)" }}>
              <TabsTrigger value="cantidad" className="sunset-display tracking-wider text-[13px] rounded-md data-[state=active]:text-white data-[state=active]:shadow-md" style={{ ["--tw-shadow-color" as string]: "rgba(79,70,229,0.4)" }}>
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />CANTIDAD</span>
              </TabsTrigger>
              <TabsTrigger value="producto" className="sunset-display tracking-wider text-[13px] rounded-md data-[state=active]:text-white data-[state=active]:shadow-md">
                <span className="flex items-center gap-1"><Package className="h-3.5 w-3.5" />PRODUCTO</span>
              </TabsTrigger>
            </TabsList>

            {/* estilo activo dinámico para los tabs */}
            <style>{`
              .sunset-theme [data-state="active"][role="tab"] { background: var(--sunset-gradient-warm); }
            `}</style>

            <TabsContent value="cantidad" className="space-y-3 pt-3">
              {/* Resumen: Total / Pagado / Restante */}
              <div className="rounded-xl p-2.5 grid grid-cols-3 gap-2 text-center" style={{ background: "linear-gradient(135deg, rgba(79,70,229,0.08), rgba(129,140,248,0.08))", border: "1px solid rgba(79,70,229,0.18)" }}>
                <div>
                  <div className="sunset-body text-[10px] uppercase tracking-wide" style={{ color: "#94a3b8" }}>Total</div>
                  <div className="sunset-display text-base leading-none mt-0.5" style={{ color: "#e8ecf1" }}>{formatMoney(total)}</div>
                </div>
                <div>
                  <div className="sunset-body text-[10px] uppercase tracking-wide" style={{ color: "#94a3b8" }}>Pagado</div>
                  <div className="sunset-display text-base leading-none mt-0.5" style={{ color: "#16a34a" }}>{formatMoney(cantidadPaid)}</div>
                </div>
                <div>
                  <div className="sunset-body text-[10px] uppercase tracking-wide" style={{ color: "#94a3b8" }}>Restante</div>
                  <div className="sunset-display text-base leading-none mt-0.5" style={{ color: cantidadPending === 0 ? "#16a34a" : "#4f46e5" }}>{formatMoney(cantidadPending)}</div>
                </div>
              </div>

              {/* Pagos aplicados */}
              {cashPayments.length > 0 && (
                <div className="space-y-1.5">
                  <div className="sunset-display text-[11px] uppercase tracking-[0.18em]" style={{ color: "#94a3b8" }}>Pagos aplicados</div>
                  {cashPayments.map((p, i) => {
                    const s = METHOD_STYLE[p.method];
                    return (
                      <div key={i} className="flex items-center gap-2 rounded-lg p-2" style={{ border: `1.5px solid ${s.ring}55`, background: s.soft }}>
                        <div
                          className="sunset-display flex h-7 w-7 items-center justify-center rounded-full text-sm"
                          style={{ background: s.bg, color: s.color, boxShadow: s.shadow }}
                        >
                          {i + 1}
                        </div>
                        <div className="sunset-display flex-1 text-[13px] tracking-wider" style={{ color: s.ring }}>{p.method}</div>
                        <div className="sunset-display tabular-nums text-base" style={{ color: s.ring }}>{formatMoney(p.amount)}</div>
                        <button
                          className="h-6 w-6 rounded-full flex items-center justify-center"
                          onClick={() => removeCashPayment(i)}
                          aria-label="Quitar pago"
                        >
                          <X className="h-3.5 w-3.5" style={{ color: "#818cf8" }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Formulario de nuevo pago */}
              {cantidadPending > 0 && showDraft && (
                <div
                  className="rounded-xl p-2.5 space-y-2"
                  style={{ border: `1.5px solid ${METHOD_STYLE[draftMethod].ring}44`, background: METHOD_STYLE[draftMethod].soft }}
                >
                  <div className="flex items-center justify-between">
                    <span className="sunset-body text-[11px] font-bold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
                      Nuevo pago
                    </span>
                    <span className="sunset-body text-[11px]" style={{ color: "#94a3b8" }}>
                      Restante: <span className="sunset-display" style={{ color: METHOD_STYLE[draftMethod].ring }}>{formatMoney(cantidadPending)}</span>
                    </span>
                  </div>

                  <MethodPicker value={draftMethod} onChange={setDraftMethod} />

                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 sunset-display text-lg" style={{ color: "#94a3b8" }}>$</span>
                    <Input
                      inputMode="numeric"
                      autoFocus
                      className="pl-8 h-11 text-right sunset-display text-xl tabular-nums rounded-lg bg-[#1e1e5a] shadow-inner"
                      style={{ border: `1.5px solid ${METHOD_STYLE[draftMethod].ring}55` }}
                      value={draftAmount === 0 ? "" : Number(draftAmount).toLocaleString("es-CO")}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        const n = digits === "" ? 0 : Math.min(cantidadPending, Number(digits));
                        setDraftAmount(n);
                      }}
                      placeholder={formatMoney(cantidadPending).replace(/\D/g, "")}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={applyDraftPayment}
                    disabled={draftAmount <= 0 || draftAmount > cantidadPending}
                    className="sunset-display w-full h-10 rounded-full tracking-wider text-white text-[13px] flex items-center justify-center gap-2 disabled:opacity-40"
                    style={{ background: "var(--sunset-gradient-warm)", boxShadow: "0 6px 14px -5px rgba(79,70,229,0.55)" }}
                  >
                    <Check className="h-4 w-4" />
                    APLICAR PAGO {formatMoney(draftAmount || 0)}
                  </button>
                </div>
              )}

              {/* Botón "Agregar pago" cuando el formulario está oculto y aún queda saldo */}
              {cantidadPending > 0 && !showDraft && (
                <button
                  type="button"
                  onClick={() => { setDraftAmount(cantidadPending); setShowDraft(true); }}
                  className="sunset-display w-full h-11 rounded-full tracking-wider text-white text-[13px] flex items-center justify-center gap-2"
                  style={{ background: "var(--sunset-gradient-cool)", boxShadow: "0 6px 14px -5px rgba(129,140,248,0.55)" }}
                >
                  <Plus className="h-4 w-4" />
                  AGREGAR PAGO · Restan {formatMoney(cantidadPending)}
                </button>
              )}

              {cantidadPending === 0 && cashPayments.length > 0 && (
                <div className="rounded-lg p-2.5 text-center sunset-display text-[13px] tracking-wider" style={{ background: "rgba(22,163,74,0.12)", border: "1.5px solid rgba(22,163,74,0.4)", color: "#16a34a" }}>
                  ✓ SALDO CUBIERTO — LISTO PARA COBRAR
                </div>
              )}
            </TabsContent>


            <TabsContent value="producto" className="space-y-3 pt-3">
              {/* Resumen compacto */}
              <div className="rounded-xl p-2.5 grid grid-cols-3 gap-2 text-center" style={{ background: "linear-gradient(135deg, rgba(79,70,229,0.08), rgba(129,140,248,0.08))", border: "1px solid rgba(79,70,229,0.18)" }}>
                <div>
                  <div className="sunset-body text-[10px] uppercase tracking-wide" style={{ color: "#94a3b8" }}>Total</div>
                  <div className="sunset-display text-base leading-none mt-0.5" style={{ color: "#e8ecf1" }}>{formatMoney(total)}</div>
                </div>
                <div>
                  <div className="sunset-body text-[10px] uppercase tracking-wide" style={{ color: "#94a3b8" }}>Cobrado</div>
                  <div className="sunset-display text-base leading-none mt-0.5" style={{ color: "#16a34a" }}>{formatMoney(alreadyCharged)}</div>
                </div>
                <div>
                  <div className="sunset-body text-[10px] uppercase tracking-wide" style={{ color: "#94a3b8" }}>Pendiente</div>
                  <div className="sunset-display text-base leading-none mt-0.5" style={{ color: productoPending === 0 ? "#16a34a" : "#4f46e5" }}>{formatMoney(productoPending)}</div>
                </div>
              </div>

              <div>
                <div className="sunset-display text-[11px] uppercase tracking-[0.18em] mb-1.5" style={{ color: "#94a3b8" }}>Disponibles</div>
                <div className="space-y-1.5">
                  {picked.filter((p) => p.max > 0).length === 0 && (
                    <div className="rounded-lg p-3 text-[11px] text-center sunset-body" style={{ border: "1.5px dashed rgba(79,70,229,0.3)", color: "#94a3b8" }}>
                      Todos los productos ya fueron asignados ✓
                    </div>
                  )}
                  {picked.map((row, idx) => row.max > 0 && (
                    <div key={row.key} className="rounded-lg p-2 bg-[#1e1e5a] space-y-1.5" style={{ border: "1.5px solid rgba(79,70,229,0.18)" }}>
                      <div className="min-w-0 flex items-baseline justify-between gap-2">
                        <div className="sunset-body text-[13px] font-semibold truncate" style={{ color: "#e8ecf1" }}>{row.name}</div>
                        <div className="sunset-display text-xs whitespace-nowrap" style={{ color: "#4f46e5" }}>{formatMoney(row.unit_price)}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button className="h-7 w-7 rounded-full flex items-center justify-center" style={{ background: "#1e1e5a", border: "1.5px solid rgba(79,70,229,0.4)", color: "#4f46e5" }} onClick={() => {
                          setPicked((prev) => prev.map((r, i) => i === idx ? { ...r, qty: Math.max(1, r.qty - 1) } : r));
                        }}><Minus className="h-3.5 w-3.5" /></button>
                        <div className="sunset-display w-7 text-center text-base" style={{ color: "#4f46e5" }}>{row.qty}</div>
                        <button className="h-7 w-7 rounded-full flex items-center justify-center text-white" style={{ background: "var(--sunset-gradient-warm)" }} onClick={() => {
                          setPicked((prev) => prev.map((r, i) => i === idx ? { ...r, qty: Math.min(r.max, r.qty + 1) } : r));
                        }}><Plus className="h-3.5 w-3.5" /></button>
                        <div className="sunset-body text-[10px] ml-1" style={{ color: "#94a3b8" }}>de {row.max}</div>
                        <button
                          className="sunset-display ml-auto h-7 rounded-full px-3 text-[12px] tracking-wider text-white"
                          style={{ background: "var(--sunset-gradient-cool)", boxShadow: "0 4px 10px -4px rgba(129,140,248,0.5)" }}
                          onClick={() => addRowToStaged(idx)}
                        >
                          AGREGAR
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Staged */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="sunset-display text-sm tracking-wider" style={{ color: "#e8ecf1" }}>A COBRAR</div>
                    <div className="sunset-body text-[11px]" style={{ color: "#94a3b8" }}>Subtotal: <span className="sunset-display" style={{ color: "#e8ecf1" }}>{formatMoney(stagedTotal)}</span></div>
                  </div>
                  <button
                    onClick={() => setMethodSheetOpen(true)}
                    disabled={stagedTotal <= 0}
                    className="sunset-display h-9 rounded-full px-4 text-[13px] tracking-wider text-white disabled:opacity-40 flex items-center gap-1.5"
                    style={{ background: "var(--sunset-gradient-warm)", boxShadow: "0 6px 14px -5px rgba(79,70,229,0.6)" }}
                  >
                    COBRAR <Banknote className="h-3.5 w-3.5" />
                  </button>
                </div>
                {staged.length === 0 ? (
                  <div className="rounded-lg p-2.5 text-[11px] text-center sunset-body" style={{ border: "1.5px dashed rgba(79,70,229,0.3)", color: "#94a3b8" }}>
                    Agrega productos y elige un método de pago
                  </div>
                ) : (
                  <div className="space-y-1">
                    {staged.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-lg p-2 bg-[#1e1e5a]" style={{ border: "1.5px solid rgba(79,70,229,0.18)" }}>
                        <div className="flex-1 min-w-0">
                          <div className="sunset-body text-[13px] font-semibold truncate" style={{ color: "#e8ecf1" }}>{it.name}</div>
                          <div className="sunset-body text-[10px]" style={{ color: "#94a3b8" }}>{it.qty}× · {formatMoney(it.unit_price * it.qty)}</div>
                        </div>
                        <button className="sunset-display h-7 rounded-full px-3 text-[11px] tracking-wider" style={{ color: "#818cf8", border: "1.5px solid rgba(129,140,248,0.35)" }} onClick={() => removeStaged(idx)}>
                          QUITAR
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Method sheet */}
              {methodSheetOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setMethodSheetOpen(false)}>
                  <div className="sunset-theme w-full sm:max-w-sm bg-[#1e1e5a] rounded-t-2xl sm:rounded-2xl p-4 space-y-2 shadow-2xl animate-in slide-in-from-bottom" onClick={(e) => e.stopPropagation()}>
                    <div className="text-center">
                      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-200 sm:hidden" />
                      <div className="sunset-display text-lg tracking-wider" style={{ color: "#e8ecf1" }}>MÉTODO DE PAGO</div>
                      <div className="sunset-body text-[11px]" style={{ color: "#94a3b8" }}>Total: <span className="sunset-display" style={{ color: "#e8ecf1" }}>{formatMoney(stagedTotal)}</span></div>
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {SPLIT_METHODS.map((m) => {
                        const s = METHOD_STYLE[m];
                        return (
                          <button
                            key={m}
                            onClick={() => commitStagedAs(m)}
                            className="w-full flex items-center gap-2.5 rounded-xl p-2.5"
                            style={{ border: `1.5px solid ${s.ring}44`, background: s.soft }}
                          >
                            <div className="h-9 w-9 rounded-full flex items-center justify-center" style={{ background: s.bg, color: s.color, boxShadow: s.shadow }}>
                              <Banknote className="h-4 w-4" />
                            </div>
                            <div className="sunset-display flex-1 text-left text-base tracking-wider" style={{ color: s.ring }}>{m}</div>
                            <Check className="h-4 w-4" style={{ color: s.ring }} />
                          </button>
                        );
                      })}
                    </div>
                    <Button variant="outline" className="w-full h-9 rounded-full sunset-display tracking-wider" onClick={() => setMethodSheetOpen(false)}>CANCELAR</Button>
                  </div>
                </div>
              )}

              {committedBuckets.length > 0 && (
                <div>
                  <div className="sunset-display text-[11px] uppercase tracking-[0.18em] mb-1.5" style={{ color: "#94a3b8" }}>Pagos asignados</div>
                  <div className="space-y-1">
                    {committedBuckets.map((b, i) => {
                      const s = METHOD_STYLE[b.method];
                      return (
                        <div key={i} className="flex items-center gap-2 rounded-lg p-2" style={{ border: `1.5px solid ${s.ring}55`, background: s.soft }}>
                          <div
                            className="sunset-display px-2.5 py-0.5 rounded-full text-[10px] tracking-wider"
                            style={{ background: s.bg, color: s.color, boxShadow: s.shadow }}
                          >
                            {b.method}
                          </div>
                          <div className="flex-1 min-w-0 sunset-body text-[11px] truncate" style={{ color: "#94a3b8" }}>
                            {b.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}
                          </div>
                          <div className="sunset-display tabular-nums text-sm" style={{ color: s.ring }}>{formatMoney(b.amount)}</div>
                          <button className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-red-50" onClick={() => {
                            setCommittedBuckets((prev) => prev.filter((_, idx) => idx !== i));
                            setPicked((prev) => {
                              const next = [...prev];
                              for (const it of b.items) {
                                const row = next.find((r) => r.name === it.name && r.unit_price === it.unit_price);
                                if (row) row.max += it.qty;
                              }
                              return next;
                            });
                          }}><X className="h-3 w-3" style={{ color: "#818cf8" }} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 border-t px-4 py-2.5 gap-2 sm:gap-2" style={{ background: "rgba(20,20,50,0.85)", borderColor: "rgba(79,70,229,0.18)" }}>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={paying} className="sunset-display h-10 rounded-full tracking-wider">
            CANCELAR
          </Button>
          <button
            onClick={handleConfirm}
            disabled={paying}
            className="sunset-display h-10 flex-1 rounded-full tracking-wider text-white text-[15px] flex items-center justify-center gap-2 disabled:opacity-50 transition-transform hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: "var(--sunset-gradient)", boxShadow: "0 8px 20px -6px rgba(129,140,248,0.55), inset 0 1px 0 rgba(255,255,255,0.35)" }}
          >
            <Banknote className="h-4 w-4" />
            {paying ? "COBRANDO…" : `COBRAR ${formatMoney(total)}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
