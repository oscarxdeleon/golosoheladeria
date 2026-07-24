import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { toUpperText } from "@/lib/text-transform";
import {
  Search, UserPlus, CreditCard, HandCoins, ArrowLeft, Check,
  User, Phone, MapPin, FileText, Calendar, Wallet, Sparkles, ShieldCheck,
} from "lucide-react";

export interface CreditCustomer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  neighborhood: string | null;
}

interface Credit {
  id: string;
  ticket_number: number | null;
  total: number;
  balance: number;
  status: "pendiente" | "parcial" | "pagado";
  created_at: string;
}

/* =========================================================
   Premium 3D pill buttons — Abonar / A Crédito
   ========================================================= */
export function CreditActionButtons({
  disabledCredit,
  onAbonar,
  onCredito,
}: {
  disabledCredit: boolean;
  onAbonar: () => void;
  onCredito: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onAbonar}
        className="group relative flex h-11 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-sm font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5"
        style={{
          background: "linear-gradient(180deg, #fbbf24 0%, #d97706 100%)",
          color: "#ffffff",
          boxShadow:
            "inset 0 2px 0 rgba(255,255,255,0.5), inset 0 -4px 0 rgba(0,0,0,0.22), 0 8px 18px -6px rgba(217,119,6,0.55)",
          textShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25">
          <HandCoins className="h-3 w-3" strokeWidth={2.75} />
        </span>
        Abonar
      </button>
      <button
        type="button"
        disabled={disabledCredit}
        onClick={onCredito}
        className="group relative flex h-11 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-sm font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: "linear-gradient(180deg, #f472b6 0%, #be185d 100%)",
          color: "#ffffff",
          boxShadow:
            "inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -4px 0 rgba(0,0,0,0.25), 0 8px 18px -6px rgba(190,24,93,0.55)",
          textShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25">
          <CreditCard className="h-3 w-3" strokeWidth={2.75} />
        </span>
        A Crédito
      </button>
    </div>
  );
}

/* =========================================================
   Shared header — premium gradient with icon
   ========================================================= */
function PremiumHeader({
  icon: Icon,
  title,
  subtitle,
  gradient,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  subtitle?: string;
  gradient: string;
}) {
  return (
    <div
      className="relative -m-6 mb-2 overflow-hidden rounded-t-lg p-5 text-white"
      style={{ background: gradient }}
    >
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -bottom-6 -left-6 h-24 w-24 rounded-full bg-white/10 blur-xl" />
      <div className="relative flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm ring-1 ring-white/30">
          <Icon className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-black tracking-tight" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.25)" }}>
            {title}
          </h2>
          {subtitle && <p className="truncate text-sm font-medium text-white/85">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Customer picker (search + create)
   ========================================================= */
function CustomerPicker({
  onSelect,
  onClose,
  accent = "pink",
}: {
  onSelect: (c: CreditCustomer) => void;
  onClose: () => void;
  accent?: "pink" | "amber";
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreditCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", document: "", address: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const accentGrad = accent === "pink"
    ? "linear-gradient(135deg, #ec4899 0%, #be185d 100%)"
    : "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)";
  const accentRing = accent === "pink" ? "focus-within:ring-pink-500/40" : "focus-within:ring-amber-500/40";

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      const q = query.trim();
      if (!q) { setResults([]); return; }
      setLoading(true);
      const digits = q.replace(/[^0-9]/g, "");
      let req = supabase.from("customers").select("id,name,phone,address,neighborhood").limit(15);
      if (digits.length >= 3) req = req.ilike("phone", `%${digits}%`);
      else req = req.ilike("name", `%${q}%`);
      const { data } = await req;
      if (!alive) return;
      setResults((data ?? []) as CreditCustomer[]);
      setLoading(false);
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  async function createCustomer() {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Nombre y celular son obligatorios");
      return;
    }
    setSaving(true);
    const phone = form.phone.replace(/[^0-9]/g, "");
    const { data, error } = await supabase.from("customers").insert({
      name: toUpperText(form.name.trim()),
      phone,
      address: form.address.trim() ? toUpperText(form.address.trim()) : null,
      notes: [form.document.trim() ? `Doc: ${toUpperText(form.document.trim())}` : "", form.notes.trim() ? toUpperText(form.notes.trim()) : ""].filter(Boolean).join(" · ") || null,
    }).select("id,name,phone,address,neighborhood").maybeSingle();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message ?? "No se pudo crear el cliente");
      return;
    }
    toast.success("Cliente creado exitosamente");
    onSelect(data as CreditCustomer);
  }

  if (creating) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setCreating(false)}
          className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a búsqueda
        </button>
        <div className="rounded-xl border-2 border-dashed border-primary/25 bg-primary/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
              <UserPlus className="h-4 w-4 text-primary" strokeWidth={2.5} />
            </div>
            <h3 className="text-base font-black">Nuevo Cliente</h3>
          </div>
          <div className="grid gap-2.5">
            <FieldInput icon={User} placeholder="Nombre completo *" value={form.name} onChange={(v) => setForm({ ...form, name: toUpperText(v) })} />
            <FieldInput icon={Phone} placeholder="Celular *" inputMode="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v.replace(/[^0-9+ \-()]/g, "") })} />
            <FieldInput icon={FileText} placeholder="Documento (opcional)" value={form.document} onChange={(v) => setForm({ ...form, document: toUpperText(v) })} />
            <FieldInput icon={MapPin} placeholder="Dirección (opcional)" value={form.address} onChange={(v) => setForm({ ...form, address: toUpperText(v) })} />
            <Textarea placeholder="Observaciones (opcional)" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: toUpperText(e.target.value) })} className="rounded-lg" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="font-bold">Cancelar</Button>
          <Button onClick={createCustomer} disabled={saving} className="font-black shadow-lg" style={{ background: accentGrad }}>
            {saving ? "Guardando…" : "Crear y continuar"}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={`relative rounded-xl border-2 bg-background transition ${accentRing} focus-within:ring-4`}>
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          placeholder="Buscar por nombre o celular…"
          className="h-11 w-full rounded-xl bg-transparent pl-10 pr-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-xl border-2 bg-muted/30">
        {loading && <div className="p-6 text-center text-xs font-semibold text-muted-foreground">Buscando…</div>}
        {!loading && results.length === 0 && query.trim() && (
          <div className="p-6 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Sin resultados</p>
            <p className="mt-1 text-xs text-muted-foreground">Crea un nuevo cliente abajo</p>
          </div>
        )}
        {!loading && !query.trim() && (
          <div className="p-8 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">Escribe un nombre o celular</p>
          </div>
        )}
        {results.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="group flex w-full items-center gap-3 border-b border-border/60 bg-background/60 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-primary/10"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 font-black text-primary">
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{c.name}</div>
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Phone className="h-3 w-3" /> {c.phone ?? "Sin teléfono"}
              </div>
            </div>
            <Check className="h-4 w-4 text-primary opacity-0 transition group-hover:opacity-100" />
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          setForm((f) => ({
            ...f,
            name: query.replace(/[0-9]/g, "").trim() || f.name,
            phone: query.replace(/[^0-9]/g, "") || f.phone,
          }));
          setCreating(true);
        }}
        className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0"
        style={{ background: accentGrad }}
      >
        <UserPlus className="h-4 w-4" strokeWidth={2.5} />
        Crear Nuevo Cliente
        <Sparkles className="h-3.5 w-3.5 opacity-70" />
      </button>
    </div>
  );
}

function FieldInput({
  icon: Icon, placeholder, value, onChange, inputMode,
}: { icon: React.ComponentType<{ className?: string }>; placeholder: string; value: string; onChange: (v: string) => void; inputMode?: "tel" | "decimal" | "text" }) {
  return (
    <div className="relative rounded-lg border bg-background transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
      <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        className="h-10 w-full bg-transparent pl-9 pr-3 text-sm font-medium outline-none placeholder:text-muted-foreground"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
      />
    </div>
  );
}

/* =========================================================
   Dialog: A Crédito — pick customer → confirmation screen
   ========================================================= */
export function CreditSaleDialog({
  open,
  onOpenChange,
  total,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  total: number;
  onConfirm: (customer: CreditCustomer) => void;
}) {
  const [customer, setCustomer] = useState<CreditCustomer | null>(null);

  useEffect(() => { if (!open) setCustomer(null); }, [open]);

  const now = new Date();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-6 sm:max-w-md">
        <PremiumHeader
          icon={CreditCard}
          title="Venta a Crédito"
          subtitle={`Total: ${formatMoney(total)}`}
          gradient="linear-gradient(135deg, #ec4899 0%, #9d174d 100%)"
        />

        {!customer && (
          <div className="pt-2">
            <p className="mb-3 text-sm font-semibold text-muted-foreground">
              Selecciona el cliente que asumirá la deuda.
            </p>
            <CustomerPicker onSelect={setCustomer} onClose={() => onOpenChange(false)} accent="pink" />
          </div>
        )}

        {customer && (
          <div className="space-y-4 pt-2">
            <button
              onClick={() => setCustomer(null)}
              className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Cambiar cliente
            </button>

            <div className="relative overflow-hidden rounded-2xl border-2 border-pink-200 bg-gradient-to-br from-pink-50 via-white to-rose-50 p-5 shadow-md dark:border-pink-900/50 dark:from-pink-950/40 dark:via-background dark:to-rose-950/40">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 text-xl font-black text-white shadow-lg">
                  {customer.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-black">{customer.name}</div>
                  <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <Phone className="h-3 w-3" /> {customer.phone ?? "Sin teléfono"}
                  </div>
                </div>
                <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-600" strokeWidth={2.5} />
              </div>

              <div className="grid gap-2 border-t border-pink-200/60 pt-3 dark:border-pink-900/40">
                <Row icon={Calendar} label="Fecha" value={now.toLocaleString()} />
                <Row icon={Wallet} label="Valor del crédito" value={formatMoney(total)} highlight />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="font-bold">Cancelar</Button>
              <Button
                onClick={() => onConfirm(customer)}
                className="font-black uppercase tracking-wide text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
                style={{ background: "linear-gradient(135deg, #ec4899 0%, #be185d 100%)" }}
              >
                <CreditCard className="mr-1.5 h-4 w-4" /> Confirmar Crédito
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  icon: Icon, label, value, highlight,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={highlight ? "text-lg font-black text-pink-700 dark:text-pink-400" : "text-sm font-bold"}>{value}</div>
    </div>
  );
}

/* =========================================================
   Dialog: Abonar — pick customer, pick credit, enter amount
   ========================================================= */
export function CreditPaymentDialog({
  open,
  onOpenChange,
  cashSessionId,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cashSessionId: string | null;
  onPaid?: () => void;
}) {
  const [customer, setCustomer] = useState<CreditCustomer | null>(null);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Efectivo");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setCustomer(null); setCredits([]); setSelectedCredit(null);
      setAmount(""); setMethod("Efectivo"); setNotes("");
    }
  }, [open]);

  useEffect(() => {
    if (!customer) return;
    let alive = true;
    (async () => {
      setLoadingCredits(true);
      const { data } = await supabase
        .from("credits")
        .select("id,ticket_number,total,balance,status,created_at")
        .eq("customer_id", customer.id)
        .neq("status", "pagado")
        .order("created_at", { ascending: false });
      if (!alive) return;
      setCredits((data ?? []) as Credit[]);
      setLoadingCredits(false);
    })();
    return () => { alive = false; };
  }, [customer]);

  const maxAmount = selectedCredit?.balance ?? 0;
  const amtNum = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const newBalance = Math.max(0, maxAmount - amtNum);

  async function submit() {
    if (!selectedCredit) return;
    if (amtNum <= 0) return toast.error("Ingresa un valor válido");
    if (amtNum > maxAmount + 0.01) return toast.error("El abono no puede superar el saldo");
    setSaving(true);
    const { data, error } = await supabase.rpc("register_credit_payment", {
      _credit_id: selectedCredit.id,
      _amount: amtNum,
      _method: method,
      _notes: notes || undefined,
      _cash_session_id: cashSessionId ?? undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    const res = data as { status: string; balance: number };
    toast.success(res.status === "pagado" ? "¡Crédito pagado en su totalidad!" : `Abono registrado · Saldo: ${formatMoney(res.balance)}`);
    onPaid?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-6 sm:max-w-md">
        <PremiumHeader
          icon={HandCoins}
          title="Registrar Abono"
          subtitle={customer ? customer.name : "Busca al cliente que va a abonar"}
          gradient="linear-gradient(135deg, #f59e0b 0%, #b45309 100%)"
        />

        {!customer && (
          <div className="pt-2">
            <CustomerPicker onSelect={setCustomer} onClose={() => onOpenChange(false)} accent="amber" />
          </div>
        )}

        {customer && !selectedCredit && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <button onClick={() => setCustomer(null)} className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" /> Cambiar cliente
              </button>
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                {credits.length} crédito(s)
              </span>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {loadingCredits && <div className="p-4 text-center text-xs font-semibold text-muted-foreground">Cargando…</div>}
              {!loadingCredits && credits.length === 0 && (
                <div className="rounded-xl border-2 border-dashed p-6 text-center">
                  <p className="text-sm font-bold">Sin créditos pendientes</p>
                  <p className="mt-1 text-xs text-muted-foreground">Este cliente no tiene deudas activas.</p>
                </div>
              )}
              {credits.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedCredit(c); setAmount(String(c.balance)); }}
                  className="group flex w-full items-center gap-3 rounded-xl border-2 border-border bg-background p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 text-amber-800 dark:from-amber-900/40 dark:to-amber-800/40 dark:text-amber-300">
                    <FileText className="h-5 w-5" strokeWidth={2.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black">Factura #{c.ticket_number ?? "—"}</div>
                    <div className="text-xs font-medium text-muted-foreground">{formatDate(c.created_at)} · Total {formatMoney(c.total)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-base font-black text-amber-700 dark:text-amber-400">{formatMoney(c.balance)}</div>
                    <StatusPill status={c.status} size="xs" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {customer && selectedCredit && (
          <div className="space-y-4 pt-2">
            <button onClick={() => setSelectedCredit(null)} className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Cambiar crédito
            </button>

            <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm dark:border-amber-900/50 dark:from-amber-950/30 dark:to-orange-950/30">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-800/70 dark:text-amber-400/70">Factura</div>
                  <div className="font-mono text-lg font-black">#{selectedCredit.ticket_number ?? "—"}</div>
                </div>
                <StatusPill status={selectedCredit.status} />
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-amber-200/60 pt-3 dark:border-amber-900/40">
                <Stat label="Total" value={formatMoney(selectedCredit.total)} />
                <Stat label="Saldo" value={formatMoney(selectedCredit.balance)} accent="amber" big />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Valor del abono</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-muted-foreground">$</span>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="h-14 rounded-xl border-2 pl-8 text-2xl font-black tracking-tight focus-visible:border-amber-500 focus-visible:ring-amber-500/30"
                />
              </div>
              <div className="flex gap-1.5">
                {[0.25, 0.5, 1].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setAmount(String(Math.round(maxAmount * f)))}
                    className="flex-1 rounded-lg border-2 bg-background px-3 py-1.5 text-xs font-black uppercase transition hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  >
                    {f === 1 ? "Pagar todo" : `${Math.round(f * 100)}%`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wider text-muted-foreground">Medio de pago</label>
              <div className="grid grid-cols-3 gap-1.5">
                {["Efectivo", "Nequi", "Bancolombia"].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`rounded-lg border-2 px-2 py-2 text-xs font-black transition ${method === m ? "border-amber-500 bg-amber-500 text-white shadow-md" : "border-border bg-background hover:border-amber-300"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {amtNum > 0 && (
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  <span>Saldo después del abono</span>
                  <span className="font-mono text-base font-black">{formatMoney(newBalance)}</span>
                </div>
              </div>
            )}

            <Textarea placeholder="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-lg" />

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="font-bold">Cancelar</Button>
              <Button
                onClick={submit}
                disabled={saving || amtNum <= 0}
                className="font-black uppercase tracking-wide text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)" }}
              >
                {saving ? "Registrando…" : `Confirmar ${formatMoney(amtNum)}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent, big }: { label: string; value: string; accent?: "amber" | "rose"; big?: boolean }) {
  const color = accent === "amber" ? "text-amber-700 dark:text-amber-400"
    : accent === "rose" ? "text-rose-700 dark:text-rose-400"
    : "text-foreground";
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono font-black ${big ? "text-xl" : "text-base"} ${color}`}>{value}</div>
    </div>
  );
}

export function StatusPill({ status, size = "sm" }: { status: string; size?: "xs" | "sm" }) {
  const map: Record<string, { label: string; cls: string }> = {
    pagado: { label: "Pagado", cls: "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white ring-emerald-400/30" },
    parcial: { label: "Parcial", cls: "bg-gradient-to-r from-amber-400 to-amber-500 text-white ring-amber-400/30" },
    pendiente: { label: "Pendiente", cls: "bg-gradient-to-r from-rose-500 to-red-600 text-white ring-rose-400/30" },
  };
  const s = map[status] ?? map.pendiente;
  const sz = size === "xs" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <Badge className={`${s.cls} ${sz} font-black uppercase tracking-wider shadow-sm ring-2`}>
      {s.label}
    </Badge>
  );
}
