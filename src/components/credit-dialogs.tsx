import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Search, UserPlus, CreditCard, HandCoins, ArrowLeft, Check } from "lucide-react";

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
        className="group relative flex h-10 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-sm font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5"
        style={{
          background: "linear-gradient(180deg, #fbbf24 0%, #d97706 100%)",
          color: "#ffffff",
          boxShadow:
            "inset 0 2px 0 rgba(255,255,255,0.5), inset 0 -4px 0 rgba(0,0,0,0.22), 0 6px 14px -5px rgba(217,119,6,0.6)",
          textShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
          <HandCoins className="h-3 w-3" strokeWidth={2.5} />
        </span>
        Abonar
      </button>
      <button
        type="button"
        disabled={disabledCredit}
        onClick={onCredito}
        className="group relative flex h-10 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-sm font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: "linear-gradient(180deg, #f472b6 0%, #be185d 100%)",
          color: "#ffffff",
          boxShadow:
            "inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -4px 0 rgba(0,0,0,0.25), 0 6px 14px -5px rgba(190,24,93,0.6)",
          textShadow: "0 1px 2px rgba(0,0,0,0.25)",
        }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
          <CreditCard className="h-3 w-3" strokeWidth={2.5} />
        </span>
        A Crédito
      </button>
    </div>
  );
}

/* =========================================================
   Customer picker (search + create)
   ========================================================= */
function CustomerPicker({
  onSelect,
  onClose,
}: {
  onSelect: (c: CreditCustomer) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreditCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", document: "", address: "", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      const q = query.trim();
      if (!q) { setResults([]); return; }
      setLoading(true);
      const digits = q.replace(/[^0-9]/g, "");
      let req = supabase.from("customers").select("id,name,phone,address,neighborhood").limit(15);
      if (digits.length >= 3) {
        req = req.ilike("phone", `%${digits}%`);
      } else {
        req = req.ilike("name", `%${q}%`);
      }
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
      name: form.name.trim(),
      phone,
      address: form.address.trim() || null,
      notes: [form.document.trim() ? `Doc: ${form.document.trim()}` : "", form.notes.trim()].filter(Boolean).join(" · ") || null,
    }).select("id,name,phone,address,neighborhood").maybeSingle();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message ?? "No se pudo crear el cliente");
      return;
    }
    toast.success("Cliente creado");
    onSelect(data as CreditCustomer);
  }

  if (creating) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
          <h3 className="font-medium">Nuevo cliente</h3>
        </div>
        <div className="grid gap-2">
          <Input placeholder="Nombre completo *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Celular *" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input placeholder="Documento (opcional)" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
          <Input placeholder="Dirección (opcional)" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Textarea placeholder="Observaciones (opcional)" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={createCustomer} disabled={saving}>
            {saving ? "Guardando…" : "Crear y continuar"}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input autoFocus placeholder="Buscar por nombre o celular…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {loading && <div className="p-3 text-center text-xs text-muted-foreground">Buscando…</div>}
        {!loading && results.length === 0 && query.trim() && (
          <div className="p-4 text-center text-sm text-muted-foreground">Sin resultados</div>
        )}
        {!loading && !query.trim() && (
          <div className="p-4 text-center text-xs text-muted-foreground">Escribe un nombre o celular para buscar</div>
        )}
        {results.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="flex w-full items-center justify-between border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
          >
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.phone ?? "Sin teléfono"}</div>
            </div>
            <Check className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100" />
          </button>
        ))}
      </div>
      <Button variant="outline" className="w-full" onClick={() => { setForm((f) => ({ ...f, name: query.replace(/[0-9]/g, "").trim() || f.name, phone: query.replace(/[^0-9]/g, "") || f.phone })); setCreating(true); }}>
        <UserPlus className="h-4 w-4 mr-2" /> Crear nuevo cliente
      </Button>
    </div>
  );
}

/* =========================================================
   Dialog: A Crédito — select customer, then callback
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-pink-600" /> Venta a Crédito · {formatMoney(total)}
          </DialogTitle>
          <DialogDescription>Selecciona el cliente al que se le asignará la deuda.</DialogDescription>
        </DialogHeader>
        <CustomerPicker onSelect={onConfirm} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
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

  async function submit() {
    if (!selectedCredit) return;
    if (amtNum <= 0) return toast.error("Ingresa un valor válido");
    if (amtNum > maxAmount + 0.01) return toast.error("El abono no puede superar el saldo");
    setSaving(true);
    const { data, error } = await supabase.rpc("register_credit_payment", {
      _credit_id: selectedCredit.id,
      _amount: amtNum,
      _method: method,
      _notes: notes || null,
      _cash_session_id: cashSessionId,
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HandCoins className="h-5 w-5 text-amber-600" /> Registrar Abono
          </DialogTitle>
          <DialogDescription>
            {customer ? `Cliente: ${customer.name}` : "Busca al cliente que va a abonar."}
          </DialogDescription>
        </DialogHeader>

        {!customer && (
          <CustomerPicker onSelect={setCustomer} onClose={() => onOpenChange(false)} />
        )}

        {customer && !selectedCredit && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Cambiar cliente
              </Button>
              <span className="text-xs text-muted-foreground">{credits.length} crédito(s) activos</span>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              {loadingCredits && <div className="p-3 text-center text-xs text-muted-foreground">Cargando…</div>}
              {!loadingCredits && credits.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">Este cliente no tiene créditos pendientes</div>
              )}
              {credits.map((c) => (
                <button key={c.id} onClick={() => { setSelectedCredit(c); setAmount(String(c.balance)); }}
                  className="flex w-full items-center justify-between border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted">
                  <div>
                    <div className="font-medium">Factura #{c.ticket_number ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(c.created_at)} · Total {formatMoney(c.total)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-amber-700">{formatMoney(c.balance)}</div>
                    <Badge variant={c.status === "parcial" ? "secondary" : "outline"} className="text-[10px]">{c.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {customer && selectedCredit && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setSelectedCredit(null)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Cambiar crédito
              </Button>
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Factura</span><span className="font-mono">#{selectedCredit.ticket_number ?? "—"}</span></div>
              <div className="flex justify-between"><span>Fecha</span><span>{formatDate(selectedCredit.created_at)}</span></div>
              <div className="flex justify-between"><span>Total crédito</span><span className="font-medium">{formatMoney(selectedCredit.total)}</span></div>
              <div className="flex justify-between"><span>Saldo pendiente</span><span className="font-bold text-amber-700">{formatMoney(selectedCredit.balance)}</span></div>
              <div className="flex justify-between"><span>Estado</span><Badge variant="outline">{selectedCredit.status}</Badge></div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Valor del abono</label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              <div className="flex gap-1 flex-wrap">
                {[0.25, 0.5, 1].map((f) => (
                  <Button key={f} type="button" variant="outline" size="sm" onClick={() => setAmount(String(Math.round(maxAmount * f)))}>
                    {f === 1 ? "Saldar todo" : `${Math.round(f * 100)}%`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Medio de pago</label>
              <div className="flex gap-1">
                {["Efectivo", "Nequi", "Bancolombia"].map((m) => (
                  <Button key={m} type="button" variant={method === m ? "default" : "outline"} size="sm" onClick={() => setMethod(m)}>{m}</Button>
                ))}
              </div>
            </div>
            <Textarea placeholder="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={saving || amtNum <= 0}>
                {saving ? "Registrando…" : `Confirmar ${formatMoney(amtNum)}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
