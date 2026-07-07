import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import { toast } from "sonner";
import {
  Search, Eye, Wallet, Printer, HandCoins, CreditCard, TrendingUp, TrendingDown,
  Users, Truck, Calendar, User, Phone, MapPin, FileText, Clock, DollarSign,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBranchCashSession } from "@/hooks/use-branch-cash-session";
import { useBranch } from "@/contexts/branch-context";
import { StatusPill } from "@/components/credit-dialogs";

export const Route = createFileRoute("/_authenticated/deudas")({
  head: () => ({ meta: [{ title: "Deudas · Goloso POS" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
  },
  component: DeudasPage,
});

type Status = "pendiente" | "parcial" | "pagado" | "todos";

interface CreditRow {
  id: string;
  ticket_number: number | null;
  total: number;
  balance: number;
  status: "pendiente" | "parcial" | "pagado";
  created_at: string;
  customer_id: string;
  created_by_name: string | null;
  customers: { name: string; phone: string | null } | null;
  credit_payments: { amount: number; created_at: string }[];
}

interface SupplierRow {
  id: string;
  supplier: string;
  invoice_number: string | null;
  total: number;
  balance: number;
  status: "pendiente" | "parcial" | "pagado";
  created_at: string;
  created_by_name: string | null;
  supplier_credit_payments: { amount: number; created_at: string }[];
  purchase_id: string | null;
}

/* =========================================================
   Page
   ========================================================= */
function DeudasPage() {
  const { isAdmin, primaryRole, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin && primaryRole !== "cajero") {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-2xl border-2 border-dashed p-8 text-center">
        <p className="text-sm font-bold">No tienes permisos para ver esta sección.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-lg">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-gradient-to-br from-pink-500/30 to-amber-500/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-gradient-to-tr from-emerald-500/20 to-blue-500/20 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/25 backdrop-blur-sm">
            <DollarSign className="h-7 w-7" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">Centro de Deudas</h1>
            <p className="mt-0.5 text-sm font-medium text-white/70">
              Administra cuentas por cobrar a clientes y por pagar a proveedores.
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="cobrar" className="w-full">
        <TabsList className="grid h-12 w-full max-w-lg grid-cols-2 rounded-xl bg-muted p-1">
          <TabsTrigger value="cobrar" className="h-full gap-2 rounded-lg text-sm font-black data-[state=active]:bg-background data-[state=active]:shadow-md">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            Por Cobrar
          </TabsTrigger>
          <TabsTrigger value="pagar" className="h-full gap-2 rounded-lg text-sm font-black data-[state=active]:bg-background data-[state=active]:shadow-md">
            <TrendingDown className="h-4 w-4 text-rose-600" />
            Por Pagar
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cobrar" className="mt-5 animate-in fade-in-50"><PorCobrar /></TabsContent>
        <TabsContent value="pagar" className="mt-5 animate-in fade-in-50"><PorPagar /></TabsContent>
      </Tabs>
    </div>
  );
}

/* =========================================================
   Shared UI helpers
   ========================================================= */
function KpiCard({
  label, value, icon: Icon, tone,
}: { label: string; value: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; tone: "emerald" | "amber" | "rose" | "sky" }) {
  const tones = {
    emerald: { bg: "from-emerald-500 to-emerald-700", text: "text-emerald-700 dark:text-emerald-400", ring: "ring-emerald-500/20" },
    amber: { bg: "from-amber-500 to-orange-600", text: "text-amber-700 dark:text-amber-400", ring: "ring-amber-500/20" },
    rose: { bg: "from-rose-500 to-red-600", text: "text-rose-700 dark:text-rose-400", ring: "ring-rose-500/20" },
    sky: { bg: "from-sky-500 to-blue-600", text: "text-sky-700 dark:text-sky-400", ring: "ring-sky-500/20" },
  }[tone];
  return (
    <div className={`relative overflow-hidden rounded-2xl border-2 bg-background p-4 shadow-sm ring-4 ${tones.ring} transition hover:-translate-y-0.5 hover:shadow-md`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={`mt-1 font-mono text-xl font-black ${tones.text}`}>{value}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${tones.bg} text-white shadow-md`}>
          <Icon className="h-5 w-5" strokeWidth={2.5} />
        </div>
      </div>
    </div>
  );
}

function FiltersBar({
  search, setSearch, status, setStatus, dateFrom, setDateFrom, dateTo, setDateTo, placeholder,
}: {
  search: string; setSearch: (v: string) => void;
  status: Status; setStatus: (s: Status) => void;
  dateFrom: string; setDateFrom: (v: string) => void;
  dateTo: string; setDateTo: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="rounded-2xl border-2 bg-background p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="relative rounded-xl border-2 bg-background transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/20">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder={placeholder}
            className="h-11 w-full rounded-xl bg-transparent pl-10 pr-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger className="h-11 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="parcial">Parcial</SelectItem>
            <SelectItem value="pagado">Pagado</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-11 rounded-xl border-2 font-semibold" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-11 rounded-xl border-2 font-semibold" />
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   POR COBRAR
   ========================================================= */
function PorCobrar() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<CreditRow | null>(null);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["credits-list", status, dateFrom, dateTo],
    refetchInterval: 8000,
    queryFn: async () => {
      let q = supabase.from("credits").select(`
        id, ticket_number, total, balance, status, created_at, customer_id, created_by_name,
        customers ( name, phone ),
        credit_payments ( amount, created_at )
      `).order("created_at", { ascending: false }).limit(500);
      if (status !== "todos") q = q.eq("status", status);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59");
      const { data } = await q;
      return (data ?? []) as unknown as CreditRow[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const name = r.customers?.name?.toLowerCase() ?? "";
      const phone = r.customers?.phone ?? "";
      const ticket = String(r.ticket_number ?? "");
      return name.includes(s) || phone.includes(s) || ticket.includes(s);
    });
  }, [rows, search]);

  const totalPend = filtered.reduce((s, r) => s + Number(r.balance), 0);
  const totalCob = filtered.reduce((s, r) => s + (Number(r.total) - Number(r.balance)), 0);
  const pendientes = filtered.filter((r) => r.status !== "pagado").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Créditos" value={String(filtered.length)} icon={Users} tone="sky" />
        <KpiCard label="Pendientes" value={String(pendientes)} icon={Clock} tone="amber" />
        <KpiCard label="Total Cobrado" value={formatMoney(totalCob)} icon={TrendingUp} tone="emerald" />
        <KpiCard label="Saldo por Cobrar" value={formatMoney(totalPend)} icon={Wallet} tone="rose" />
      </div>

      <FiltersBar
        search={search} setSearch={setSearch}
        status={status} setStatus={setStatus}
        dateFrom={dateFrom} setDateFrom={setDateFrom}
        dateTo={dateTo} setDateTo={setDateTo}
        placeholder="Buscar por cliente, celular o factura…"
      />

      <div className="flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
        <span>{filtered.length} registros</span>
        {isFetching && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> actualizando…</span>}
      </div>

      {/* Card list — modern rows */}
      <div className="space-y-2.5">
        {filtered.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed py-14 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Wallet className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-bold">Sin registros</p>
            <p className="text-xs text-muted-foreground">Ajusta los filtros para ver más resultados.</p>
          </div>
        )}
        {filtered.map((r) => {
          const abonado = Number(r.total) - Number(r.balance);
          const pct = Number(r.total) > 0 ? Math.min(100, (abonado / Number(r.total)) * 100) : 0;
          const last = r.credit_payments?.length ? r.credit_payments.reduce((a, b) => (a.created_at > b.created_at ? a : b)) : null;
          return (
            <div
              key={r.id}
              className="group relative overflow-hidden rounded-2xl border-2 bg-background p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-center">
                {/* Customer */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 text-base font-black text-white shadow">
                    {(r.customers?.name ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black">{r.customers?.name ?? "—"}</div>
                    <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Phone className="h-3 w-3" /> {r.customers?.phone ?? "—"}
                    </div>
                  </div>
                </div>

                {/* Factura / fecha */}
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Factura</div>
                  <div className="font-mono text-sm font-black">#{r.ticket_number ?? "—"}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <Calendar className="h-3 w-3" /> {formatDate(r.created_at)}
                  </div>
                </div>

                {/* Amounts + progress */}
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Saldo</div>
                      <div className="font-mono text-lg font-black text-amber-700 dark:text-amber-400">{formatMoney(r.balance)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Abonado</div>
                      <div className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">{formatMoney(abonado)}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                    <span>Total {formatMoney(r.total)}</span>
                    <span>{Math.round(pct)}% pagado</span>
                  </div>
                </div>

                {/* Status + action */}
                <div className="flex items-center gap-2 md:flex-col md:items-end">
                  <StatusPill status={r.status} />
                  <Button
                    size="sm"
                    onClick={() => setSelected(r)}
                    className="h-9 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 px-3 font-black text-white shadow-md hover:from-slate-700 hover:to-slate-800"
                  >
                    <Eye className="mr-1.5 h-4 w-4" /> Ver Detalle
                  </Button>
                </div>
              </div>
              {last && (
                <div className="mt-2 border-t pt-2 text-[11px] font-medium text-muted-foreground">
                  Último abono: <span className="font-bold text-foreground">{formatDate(last.created_at)}</span>
                  {r.created_by_name && <> · Vendedor: <span className="font-bold text-foreground">{r.created_by_name}</span></>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && <CreditDetailDialog creditId={selected.id} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* =========================================================
   Credit Detail Dialog
   ========================================================= */
function CreditDetailDialog({ creditId, onClose }: { creditId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { session } = useBranchCashSession(activeBranchId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Efectivo");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  type CreditDetail = Omit<CreditRow, "customers" | "credit_payments"> & {
    customers: { name: string; phone: string | null; address: string | null; neighborhood: string | null } | null;
    credit_payments: { id: string; amount: number; payment_method: string; user_name: string; notes: string | null; created_at: string }[];
  };

  const { data, refetch } = useQuery({
    queryKey: ["credit-detail", creditId],
    queryFn: async () => {
      const { data: c } = await supabase.from("credits").select(`
        *, customers (name, phone, address, neighborhood),
        credit_payments (id, amount, payment_method, user_name, notes, created_at)
      `).eq("id", creditId).maybeSingle();
      return c as unknown as CreditDetail | null;
    },
  });

  const amt = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const max = Number(data?.balance ?? 0);
  const abonado = data ? Number(data.total) - Number(data.balance) : 0;
  const pct = data && Number(data.total) > 0 ? Math.min(100, (abonado / Number(data.total)) * 100) : 0;

  async function submit() {
    if (amt <= 0) return toast.error("Ingresa un valor válido");
    if (amt > max + 0.01) return toast.error("El abono supera el saldo");
    setSaving(true);
    const { error } = await supabase.rpc("register_credit_payment", {
      _credit_id: creditId, _amount: amt, _method: method, _notes: notes || undefined, _cash_session_id: session?.id ?? undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Abono registrado");
    setAmount(""); setNotes("");
    refetch();
    qc.invalidateQueries({ queryKey: ["credits-list"] });
  }

  function printReceipt(pay: { amount: number; payment_method: string; user_name: string; created_at: string }) {
    const w = window.open("", "_blank", "width=380,height=520");
    if (!w) return;
    w.document.write(`<html><head><title>Comprobante de Abono</title>
      <style>body{font-family:monospace;padding:12px;font-size:12px}h2{text-align:center;margin:4px 0}hr{border:none;border-top:1px dashed #999;margin:6px 0}</style>
      </head><body>
      <h2>COMPROBANTE DE ABONO</h2><hr/>
      <div>Cliente: ${data?.customers?.name ?? ""}</div>
      <div>Celular: ${data?.customers?.phone ?? ""}</div>
      <div>Factura: #${data?.ticket_number ?? ""}</div><hr/>
      <div>Fecha: ${new Date(pay.created_at).toLocaleString()}</div>
      <div>Método: ${pay.payment_method}</div>
      <div>Recibido por: ${pay.user_name}</div>
      <h2>${formatMoney(pay.amount)}</h2><hr/>
      <div>Saldo actual: ${formatMoney(data?.balance ?? 0)}</div>
      <script>window.print();</script></body></html>`);
    w.document.close();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-3xl">
        {/* Header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-pink-600 via-rose-600 to-red-700 p-6 text-white">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl font-black ring-1 ring-white/30 backdrop-blur-sm">
              {(data?.customers?.name ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black uppercase tracking-widest text-white/70">Cuenta por Cobrar</div>
              <h2 className="mt-0.5 truncate text-2xl font-black tracking-tight" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.25)" }}>
                {data?.customers?.name ?? "—"}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-semibold text-white/85">
                <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> Factura #{data?.ticket_number ?? "—"}</span>
                <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {data?.customers?.phone ?? "—"}</span>
                <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> {data ? formatDate(data.created_at) : "—"}</span>
              </div>
            </div>
            {data && <StatusPill status={data.status} />}
          </div>
        </div>

        {data && (
          <div className="space-y-5 p-6">
            {/* Amounts */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border-2 bg-muted/30 p-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Total</div>
                <div className="font-mono text-xl font-black">{formatMoney(data.total)}</div>
              </div>
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-800/80 dark:text-emerald-400/80">Abonado</div>
                <div className="font-mono text-xl font-black text-emerald-700 dark:text-emerald-400">{formatMoney(abonado)}</div>
              </div>
              <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                <div className="text-[10px] font-black uppercase tracking-wider text-amber-800/80 dark:text-amber-400/80">Saldo</div>
                <div className="font-mono text-xl font-black text-amber-700 dark:text-amber-400">{formatMoney(data.balance)}</div>
              </div>
            </div>
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-right text-xs font-bold text-muted-foreground">{Math.round(pct)}% pagado</div>
            </div>

            {/* Customer info */}
            <div className="grid gap-2 rounded-xl border-2 bg-muted/20 p-4 text-sm sm:grid-cols-2">
              <InfoRow icon={User} label="Cliente" value={data.customers?.name ?? "—"} />
              <InfoRow icon={Phone} label="Celular" value={data.customers?.phone ?? "—"} />
              <InfoRow icon={MapPin} label="Dirección" value={data.customers?.address ?? "—"} />
              <InfoRow icon={MapPin} label="Barrio" value={data.customers?.neighborhood ?? "—"} />
              <InfoRow icon={User} label="Vendedor" value={data.created_by_name ?? "—"} />
              <InfoRow icon={Calendar} label="Fecha crédito" value={formatDate(data.created_at)} />
            </div>

            {/* Payment history */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                  <Clock className="h-4 w-4" strokeWidth={2.5} />
                </div>
                <h3 className="text-sm font-black uppercase tracking-wide">Historial de Abonos</h3>
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-black">{data.credit_payments.length}</span>
              </div>
              {data.credit_payments.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed py-8 text-center text-xs font-semibold text-muted-foreground">
                  Sin abonos registrados
                </div>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {data.credit_payments.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl border-2 bg-background p-3 shadow-sm transition hover:border-emerald-300 hover:shadow-md">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow">
                        <HandCoins className="h-5 w-5" strokeWidth={2.5} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-black text-emerald-700 dark:text-emerald-400">{formatMoney(p.amount)}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black uppercase">{p.payment_method}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                          <span className="font-bold">{p.user_name}</span> · {new Date(p.created_at).toLocaleString()}
                        </div>
                        {p.notes && <div className="mt-0.5 text-[11px] italic text-muted-foreground">"{p.notes}"</div>}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => printReceipt(p)} className="shrink-0 rounded-lg font-bold">
                        <Printer className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Register payment */}
            {data.status !== "pagado" && (
              <div className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4 dark:border-amber-900/50 dark:from-amber-950/30 dark:via-background dark:to-orange-950/30">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow">
                    <Wallet className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Registrar Abono</h3>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Valor</label>
                    <div className="relative mt-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-muted-foreground">$</span>
                      <Input
                        inputMode="decimal"
                        placeholder="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="h-12 rounded-xl border-2 pl-8 text-xl font-black focus-visible:border-amber-500 focus-visible:ring-amber-500/30"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Medio de pago</label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger className="mt-1 h-12 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Efectivo">Efectivo</SelectItem>
                        <SelectItem value="Nequi">Nequi</SelectItem>
                        <SelectItem value="Bancolombia">Bancolombia</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Textarea rows={2} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-3 rounded-xl" />

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setAmount(String(max))}
                    className="rounded-lg border-2 font-black hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  >
                    Saldar todo ({formatMoney(max)})
                  </Button>
                  <Button
                    onClick={submit}
                    disabled={saving || amt <= 0}
                    className="ml-auto rounded-lg font-black uppercase tracking-wide text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)" }}
                  >
                    {saving ? "Registrando…" : `Confirmar ${formatMoney(amt)}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="border-t bg-muted/30 px-6 py-3">
          <Button variant="outline" onClick={onClose} className="rounded-lg font-bold">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-bold">{value}</div>
      </div>
    </div>
  );
}

/* =========================================================
   POR PAGAR
   ========================================================= */
function PorPagar() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<SupplierRow | null>(null);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["supplier-credits", status, dateFrom, dateTo],
    refetchInterval: 8000,
    queryFn: async () => {
      let q = supabase.from("supplier_credits").select(`
        id, supplier, invoice_number, total, balance, status, created_at, created_by_name, purchase_id,
        supplier_credit_payments ( amount, created_at )
      `).order("created_at", { ascending: false }).limit(500);
      if (status !== "todos") q = q.eq("status", status);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59");
      const { data } = await q;
      return (data ?? []) as unknown as SupplierRow[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => (r.supplier ?? "").toLowerCase().includes(s) || (r.invoice_number ?? "").toLowerCase().includes(s));
  }, [rows, search]);

  const totalPend = filtered.reduce((s, r) => s + Number(r.balance), 0);
  const totalPag = filtered.reduce((s, r) => s + (Number(r.total) - Number(r.balance)), 0);
  const pendientes = filtered.filter((r) => r.status !== "pagado").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Deudas" value={String(filtered.length)} icon={Truck} tone="sky" />
        <KpiCard label="Pendientes" value={String(pendientes)} icon={Clock} tone="amber" />
        <KpiCard label="Total Pagado" value={formatMoney(totalPag)} icon={TrendingUp} tone="emerald" />
        <KpiCard label="Saldo por Pagar" value={formatMoney(totalPend)} icon={CreditCard} tone="rose" />
      </div>

      <FiltersBar
        search={search} setSearch={setSearch}
        status={status} setStatus={setStatus}
        dateFrom={dateFrom} setDateFrom={setDateFrom}
        dateTo={dateTo} setDateTo={setDateTo}
        placeholder="Buscar por proveedor o factura…"
      />

      <div className="flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
        <span>{filtered.length} registros</span>
        {isFetching && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> actualizando…</span>}
      </div>

      <div className="space-y-2.5">
        {filtered.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed py-14 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-bold">Sin registros</p>
          </div>
        )}
        {filtered.map((r) => {
          const abonado = Number(r.total) - Number(r.balance);
          const pct = Number(r.total) > 0 ? Math.min(100, (abonado / Number(r.total)) * 100) : 0;
          const last = r.supplier_credit_payments?.length ? r.supplier_credit_payments.reduce((a, b) => (a.created_at > b.created_at ? a : b)) : null;
          return (
            <div key={r.id} className="group relative overflow-hidden rounded-2xl border-2 bg-background p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-center">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow">
                    <Truck className="h-5 w-5" strokeWidth={2.5} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black">{r.supplier || "—"}</div>
                    <div className="text-xs font-medium text-muted-foreground">Registrado por {r.created_by_name ?? "—"}</div>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Factura</div>
                  <div className="font-mono text-sm font-black">{r.invoice_number ?? "—"}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <Calendar className="h-3 w-3" /> {formatDate(r.created_at)}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Saldo</div>
                      <div className="font-mono text-lg font-black text-rose-700 dark:text-rose-400">{formatMoney(r.balance)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Pagado</div>
                      <div className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">{formatMoney(abonado)}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                    <span>Total {formatMoney(r.total)}</span>
                    <span>{Math.round(pct)}% pagado</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 md:flex-col md:items-end">
                  <StatusPill status={r.status} />
                  <Button
                    size="sm"
                    onClick={() => setSelected(r)}
                    className="h-9 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 px-3 font-black text-white shadow-md hover:from-slate-700 hover:to-slate-800"
                  >
                    <Eye className="mr-1.5 h-4 w-4" /> Ver Detalle
                  </Button>
                </div>
              </div>
              {last && (
                <div className="mt-2 border-t pt-2 text-[11px] font-medium text-muted-foreground">
                  Último pago: <span className="font-bold text-foreground">{formatDate(last.created_at)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && <SupplierDetailDialog creditId={selected.id} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* =========================================================
   Supplier Detail Dialog
   ========================================================= */
function SupplierDetailDialog({ creditId, onClose }: { creditId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { session } = useBranchCashSession(activeBranchId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Efectivo");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  type SupplierDetail = Omit<SupplierRow, "supplier_credit_payments"> & {
    notes: string | null;
    supplier_credit_payments: { id: string; amount: number; payment_method: string; user_name: string; notes: string | null; created_at: string }[];
  };
  type PurchaseItem = { id: string; item_name: string; quantity: number; unit_cost: number };

  const { data, refetch } = useQuery({
    queryKey: ["supplier-credit-detail", creditId],
    queryFn: async () => {
      const { data: c } = await supabase.from("supplier_credits").select(`
        *, supplier_credit_payments (id, amount, payment_method, user_name, notes, created_at)
      `).eq("id", creditId).maybeSingle();
      if (!c) return null;
      let items: PurchaseItem[] = [];
      if ((c as { purchase_id: string | null }).purchase_id) {
        const { data: pit } = await supabase.from("purchase_items").select("id, item_name, quantity, unit_cost").eq("purchase_id", (c as { purchase_id: string }).purchase_id);
        items = (pit ?? []) as unknown as PurchaseItem[];
      }
      return { credit: c as unknown as SupplierDetail, items };
    },
  });

  const amt = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const max = Number(data?.credit?.balance ?? 0);
  const abonado = data ? Number(data.credit.total) - Number(data.credit.balance) : 0;
  const pct = data && Number(data.credit.total) > 0 ? Math.min(100, (abonado / Number(data.credit.total)) * 100) : 0;

  async function submit() {
    if (amt <= 0) return toast.error("Ingresa un valor válido");
    if (amt > max + 0.01) return toast.error("El pago supera el saldo");
    setSaving(true);
    const { error } = await supabase.rpc("register_supplier_payment", {
      _supplier_credit_id: creditId, _amount: amt, _method: method, _notes: notes || undefined, _cash_session_id: session?.id ?? undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Pago registrado");
    setAmount(""); setNotes("");
    refetch();
    qc.invalidateQueries({ queryKey: ["supplier-credits"] });
  }

  function printReceipt(pay: { amount: number; payment_method: string; user_name: string; created_at: string }) {
    const w = window.open("", "_blank", "width=380,height=520");
    if (!w || !data) return;
    w.document.write(`<html><head><title>Comprobante de Pago</title>
      <style>body{font-family:monospace;padding:12px;font-size:12px}h2{text-align:center;margin:4px 0}hr{border:none;border-top:1px dashed #999;margin:6px 0}</style>
      </head><body>
      <h2>COMPROBANTE DE PAGO</h2><hr/>
      <div>Proveedor: ${data.credit.supplier}</div>
      <div>Factura: ${data.credit.invoice_number ?? ""}</div><hr/>
      <div>Fecha: ${new Date(pay.created_at).toLocaleString()}</div>
      <div>Método: ${pay.payment_method}</div>
      <div>Pagado por: ${pay.user_name}</div>
      <h2>${formatMoney(pay.amount)}</h2><hr/>
      <div>Saldo actual: ${formatMoney(data.credit.balance)}</div>
      <script>window.print();</script></body></html>`);
    w.document.close();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-3xl">
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-black p-6 text-white">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-rose-500/20 blur-3xl" />
          <div className="relative flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/25 backdrop-blur-sm">
              <Truck className="h-7 w-7" strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black uppercase tracking-widest text-white/70">Cuenta por Pagar</div>
              <h2 className="mt-0.5 truncate text-2xl font-black tracking-tight">{data?.credit.supplier ?? "—"}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-semibold text-white/85">
                <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> Factura {data?.credit.invoice_number ?? "—"}</span>
                <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> {data ? formatDate(data.credit.created_at) : "—"}</span>
              </div>
            </div>
            {data && <StatusPill status={data.credit.status} />}
          </div>
        </div>

        {data && (
          <div className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border-2 bg-muted/30 p-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Total</div>
                <div className="font-mono text-xl font-black">{formatMoney(data.credit.total)}</div>
              </div>
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-800/80 dark:text-emerald-400/80">Pagado</div>
                <div className="font-mono text-xl font-black text-emerald-700 dark:text-emerald-400">{formatMoney(abonado)}</div>
              </div>
              <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-3 dark:border-rose-900/50 dark:bg-rose-950/30">
                <div className="text-[10px] font-black uppercase tracking-wider text-rose-800/80 dark:text-rose-400/80">Saldo</div>
                <div className="font-mono text-xl font-black text-rose-700 dark:text-rose-400">{formatMoney(data.credit.balance)}</div>
              </div>
            </div>
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-right text-xs font-bold text-muted-foreground">{Math.round(pct)}% pagado</div>
            </div>

            {data.items.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400">
                    <FileText className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Productos Comprados</h3>
                </div>
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {data.items.map((i) => (
                    <div key={i.id} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                      <span className="truncate font-semibold">{i.item_name}</span>
                      <div className="flex items-center gap-3 shrink-0 text-xs">
                        <span className="font-bold">×{i.quantity}</span>
                        <span className="font-mono font-black">{formatMoney(i.unit_cost)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                  <Clock className="h-4 w-4" strokeWidth={2.5} />
                </div>
                <h3 className="text-sm font-black uppercase tracking-wide">Historial de Pagos</h3>
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-black">{data.credit.supplier_credit_payments.length}</span>
              </div>
              {data.credit.supplier_credit_payments.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed py-8 text-center text-xs font-semibold text-muted-foreground">
                  Sin pagos registrados
                </div>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {data.credit.supplier_credit_payments.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl border-2 bg-background p-3 shadow-sm transition hover:border-emerald-300">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow">
                        <HandCoins className="h-5 w-5" strokeWidth={2.5} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-black text-emerald-700 dark:text-emerald-400">{formatMoney(p.amount)}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-black uppercase">{p.payment_method}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                          <span className="font-bold">{p.user_name}</span> · {new Date(p.created_at).toLocaleString()}
                        </div>
                        {p.notes && <div className="mt-0.5 text-[11px] italic text-muted-foreground">"{p.notes}"</div>}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => printReceipt(p)} className="shrink-0 rounded-lg">
                        <Printer className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data.credit.status !== "pagado" && (
              <div className="rounded-2xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 via-white to-red-50 p-4 dark:border-rose-900/50 dark:from-rose-950/30 dark:via-background dark:to-red-950/30">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-red-600 text-white shadow">
                    <Wallet className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Registrar Pago</h3>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Valor</label>
                    <div className="relative mt-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-black text-muted-foreground">$</span>
                      <Input
                        inputMode="decimal"
                        placeholder="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="h-12 rounded-xl border-2 pl-8 text-xl font-black focus-visible:border-rose-500 focus-visible:ring-rose-500/30"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Medio de pago</label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger className="mt-1 h-12 rounded-xl border-2 font-bold"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Efectivo">Efectivo</SelectItem>
                        <SelectItem value="Nequi">Nequi</SelectItem>
                        <SelectItem value="Bancolombia">Bancolombia</SelectItem>
                        <SelectItem value="Transferencia">Transferencia</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Textarea rows={2} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-3 rounded-xl" />

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setAmount(String(max))}
                    className="rounded-lg border-2 font-black hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  >
                    Saldar todo ({formatMoney(max)})
                  </Button>
                  <Button
                    onClick={submit}
                    disabled={saving || amt <= 0}
                    className="ml-auto rounded-lg font-black uppercase tracking-wide text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #f43f5e 0%, #b91c1c 100%)" }}
                  >
                    {saving ? "Registrando…" : `Confirmar ${formatMoney(amt)}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="border-t bg-muted/30 px-6 py-3">
          <Button variant="outline" onClick={onClose} className="rounded-lg font-bold">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
