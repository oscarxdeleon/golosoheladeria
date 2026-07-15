import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  supLogin, supValidate, supLogout, supDashboard, supCashList, supCashDetail,
  type SupContext, type SupDashboard, type SupCashListItem, type SupCashDetail,
} from "@/lib/supervisor-v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck, LogOut, RefreshCw, Building2, TrendingUp, ShoppingBag, Wallet,
  CreditCard, DollarSign, Eye, Users, ChefHat, Bike, Utensils, Clock,
  ArrowDownLeft, ArrowUpRight, ReceiptText, PiggyBank,
} from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const SESSION_KEY = "goloso.supervisor.session.v2";

export const Route = createFileRoute("/supervisor")({
  ssr: false,
  head: () => ({ meta: [{ title: "Modo Supervisor · Goloso" }, { name: "robots", content: "noindex" }] }),
  component: SupervisorPage,
});

type Stored = { session_token: string; expires_at: string; display_name: string };

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (new Date(s.expires_at).getTime() < Date.now()) return null;
    return s;
  } catch { return null; }
}

function SupervisorPage() {
  const [stored, setStored] = useState<Stored | null>(() => loadStored());
  const [ctx, setCtx] = useState<SupContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);

  useEffect(() => {
    if (!stored) { setCtx(null); return; }
    let cancelled = false;
    setLoadingCtx(true);
    supValidate(stored.session_token)
      .then((c) => { if (!cancelled) setCtx(c); })
      .catch(() => { if (!cancelled) { localStorage.removeItem(SESSION_KEY); setStored(null); setCtx(null); } })
      .finally(() => { if (!cancelled) setLoadingCtx(false); });
    return () => { cancelled = true; };
  }, [stored]);

  const onLoggedIn = useCallback((s: Stored) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setStored(s);
  }, []);

  const onLogout = useCallback(async () => {
    if (stored) { try { await supLogout(stored.session_token); } catch { /* noop */ } }
    localStorage.removeItem(SESSION_KEY);
    setStored(null); setCtx(null);
  }, [stored]);

  if (!stored) return <LoginScreen onLoggedIn={onLoggedIn} />;
  if (loadingCtx || !ctx) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;
  return <SupervisorShell stored={stored} ctx={ctx} onLogout={onLogout} />;
}

// ==================== LOGIN ====================
function LoginScreen({ onLoggedIn }: { onLoggedIn: (s: Stored) => void }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!/^\d{4}$/.test(pin)) { toast.error("El PIN debe ser de 4 dígitos"); return; }
    setBusy(true);
    try {
      const s = await supLogin(name.trim(), pin);
      onLoggedIn({ session_token: s.session_token, expires_at: s.expires_at, display_name: s.display_name });
      toast.success(`Bienvenido/a, ${s.display_name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto rounded-full bg-primary/10 p-3 w-fit">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Modo Supervisor</CardTitle>
          <p className="text-sm text-muted-foreground">Acceso de solo lectura · Goloso Heladería</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Nombre</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Nombre del supervisor" required />
            </div>
            <div>
              <Label>PIN (4 dígitos)</Label>
              <Input
                inputMode="numeric" pattern="\d{4}" maxLength={4}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••" required
                className="text-center text-2xl tracking-[0.5em] font-mono"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Ingresando..." : "Ingresar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== SHELL ====================
function SupervisorShell({ stored, ctx, onLogout }: { stored: Stored; ctx: SupContext; onLogout: () => void }) {
  const [branchId, setBranchId] = useState<string>(ctx.default_branch_id ?? ctx.branches[0]?.id ?? "");
  const [tab, setTab] = useState<"dashboard" | "cierres">("dashboard");
  const activeBranch = useMemo(() => ctx.branches.find((b) => b.id === branchId) ?? null, [ctx.branches, branchId]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="rounded-lg bg-primary/10 p-2"><ShieldCheck className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-sm font-semibold leading-tight">{ctx.supervisor.display_name}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Modo Supervisor · Solo lectura</p>
            </div>
          </div>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-[220px]"><Building2 className="h-4 w-4 mr-2" /><SelectValue /></SelectTrigger>
            <SelectContent>
              {ctx.branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " · Principal" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onLogout}><LogOut className="h-4 w-4 mr-2" />Salir</Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "dashboard" | "cierres")}>
          <TabsList className="mb-4">
            <TabsTrigger value="dashboard"><TrendingUp className="h-4 w-4 mr-2" />Dashboard</TabsTrigger>
            <TabsTrigger value="cierres"><ReceiptText className="h-4 w-4 mr-2" />Cierres de Caja</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard">
            {branchId ? <DashboardView token={stored.session_token} branchId={branchId} branchName={activeBranch?.name ?? ""} /> : null}
          </TabsContent>
          <TabsContent value="cierres">
            {branchId ? <CierresView token={stored.session_token} branchId={branchId} /> : null}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ==================== DASHBOARD ====================
type Range = "hoy" | "ayer" | "semana" | "mes";

function DashboardView({ token, branchId, branchName }: { token: string; branchId: string; branchName: string }) {
  const [range, setRange] = useState<Range>("hoy");
  const [data, setData] = useState<SupDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await supDashboard(token, branchId, range)); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Error al cargar"); }
    finally { setLoading(false); }
  }, [token, branchId, range]);

  useEffect(() => { load(); }, [load, refreshTick]);

  // Realtime + auto-refresh
  useEffect(() => {
    const channel = supabase
      .channel(`sup-dash-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${branchId}` }, () => setRefreshTick((t) => t + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `branch_id=eq.${branchId}` }, () => setRefreshTick((t) => t + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_deposits", filter: `branch_id=eq.${branchId}` }, () => setRefreshTick((t) => t + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${branchId}` }, () => setRefreshTick((t) => t + 1))
      .subscribe();
    const interval = setInterval(() => setRefreshTick((t) => t + 1), 45_000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [branchId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hoy">Hoy</SelectItem>
            <SelectItem value="ayer">Ayer</SelectItem>
            <SelectItem value="semana">Últimos 7 días</SelectItem>
            <SelectItem value="mes">Últimos 30 días</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setRefreshTick((t) => t + 1)}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Actualizar
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">{branchName}</div>
      </div>

      {loading && !data ? <SkeletonGrid /> : data ? <DashboardBody data={data} /> : null}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
    </div>
  );
}

function DashboardBody({ data }: { data: SupDashboard }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<DollarSign className="h-4 w-4" />} label="Ventas" value={formatMoney(data.total)} />
        <Kpi icon={<ShoppingBag className="h-4 w-4" />} label="Órdenes" value={data.txs.toLocaleString()} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Ticket promedio" value={formatMoney(data.avg)} />
        <Kpi icon={<Wallet className="h-4 w-4" />} label="Utilidad neta" value={formatMoney(data.utilidad)} accent={data.utilidad >= 0 ? "text-emerald-600" : "text-red-600"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<ReceiptText className="h-4 w-4" />} label="Gastos + Compras" value={formatMoney(data.gastos)} accent="text-red-600" />
        <Kpi icon={<Users className="h-4 w-4" />} label="Mesas ocupadas" value={data.pending.tables_occupied.toString()} />
        <Kpi icon={<Utensils className="h-4 w-4" />} label="Para llevar" value={data.pending.pending_llevar.toString()} />
        <Kpi icon={<Bike className="h-4 w-4" />} label="Domicilios" value={data.pending.pending_domicilio.toString()} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" />Métodos de pago</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.methods.length === 0 && <p className="text-sm text-muted-foreground">Sin movimientos.</p>}
            {data.methods.map((m) => (
              <div key={m.name} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                <span className="capitalize font-medium">{m.name}</span>
                <div className="text-right">
                  <div className="text-emerald-600 font-semibold">{formatMoney(m.ingresos)}</div>
                  {m.egresos > 0 && <div className="text-[11px] text-red-600">-{formatMoney(m.egresos)}</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ChefHat className="h-4 w-4" />Top productos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.top.length === 0 && <p className="text-sm text-muted-foreground">Sin ventas.</p>}
            {data.top.map((p) => (
              <div key={p.name} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{p.qty} und</div>
                </div>
                <div className="font-semibold">{formatMoney(p.total)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {data.real_cash && data.real_cash.cajasCerradas > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><PiggyBank className="h-4 w-4" />Arqueo real (cajas cerradas: {data.real_cash.cajasCerradas})</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <CashRow label="Efectivo" counted={data.real_cash.efectivo} expected={data.real_cash.efectivoEsperado} diff={data.real_cash.diferenciaEfectivo} />
            <CashRow label="Nequi" counted={data.real_cash.nequi} expected={data.real_cash.nequiEsperado} diff={data.real_cash.diferenciaNequi} />
            <CashRow label="Bancolombia" counted={data.real_cash.bancolombia} expected={data.real_cash.bancolombiaEsperado} diff={data.real_cash.diferenciaBanco} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className={`text-lg font-bold mt-1 ${accent ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function CashRow({ label, counted, expected, diff }: { label: string; counted: number; expected: number; diff: number }) {
  const color = diff === 0 ? "text-emerald-600" : diff > 0 ? "text-sky-600" : "text-red-600";
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground uppercase font-semibold">{label}</div>
      <div className="flex items-baseline justify-between mt-1">
        <span className="text-xs text-muted-foreground">Contado</span>
        <span className="font-semibold">{formatMoney(counted)}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Esperado</span>
        <span>{formatMoney(expected)}</span>
      </div>
      <div className="flex items-baseline justify-between border-t mt-1 pt-1">
        <span className="text-xs text-muted-foreground">Diferencia</span>
        <span className={`font-bold ${color}`}>{diff >= 0 ? "+" : ""}{formatMoney(diff)}</span>
      </div>
    </div>
  );
}

// ==================== CIERRES ====================
function CierresView({ token, branchId }: { token: string; branchId: string }) {
  const [tab, setTab] = useState<"hoy" | "ayer" | "todos">("hoy");
  const [items, setItems] = useState<SupCashListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    let from: string | undefined, to: string | undefined;
    if (tab === "hoy") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (tab === "ayer") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    }
    try { setItems(await supCashList(token, branchId, from, to)); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Error al cargar"); }
    finally { setLoading(false); }
  }, [token, branchId, tab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`sup-cierres-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${branchId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [branchId, load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="hoy">Hoy</TabsTrigger>
            <TabsTrigger value="ayer">Ayer</TabsTrigger>
            <TabsTrigger value="todos">Últimos 30 días</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Actualizar
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No hay cierres en este período.</CardContent></Card>
      ) : (
        <div className="grid gap-2">
          {items.map((it) => (
            <Card key={it.id} className="hover:bg-muted/40 transition">
              <CardContent className="p-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[180px]">
                  <div className="flex items-center gap-2">
                    <Badge variant={it.status === "closed" ? "default" : "secondary"}>{it.status === "closed" ? "Cerrado" : "Abierto"}</Badge>
                    <span className="text-sm font-semibold">{it.user_name ?? "Sin usuario"}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {format(new Date(it.opened_at), "dd MMM · HH:mm", { locale: es })}
                    {it.closed_at ? ` → ${format(new Date(it.closed_at), "HH:mm", { locale: es })}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Ventas</div>
                  <div className="font-semibold">{formatMoney(it.sales_total)}</div>
                </div>
                {it.difference !== null && it.status === "closed" && (
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Diferencia</div>
                    <div className={`font-semibold ${it.difference === 0 ? "text-emerald-600" : it.difference > 0 ? "text-sky-600" : "text-red-600"}`}>
                      {it.difference >= 0 ? "+" : ""}{formatMoney(it.difference)}
                    </div>
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={() => setOpenDetail(it.id)}>
                  <Eye className="h-4 w-4 mr-1" />Ver
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!openDetail} onOpenChange={(o) => !o && setOpenDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Detalle del cierre</DialogTitle></DialogHeader>
          {openDetail && <CierreDetail token={token} id={openDetail} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CierreDetail({ token, id }: { token: string; id: string }) {
  const [d, setD] = useState<SupCashDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    supCashDetail(token, id).then(setD).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [token, id]);

  if (loading || !d) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge variant={d.session.status === "closed" ? "default" : "secondary"}>{d.session.status}</Badge>
        <Badge variant="outline">{d.session.branch_name}</Badge>
        <Badge variant="outline">{d.session.user_name}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Ventas" value={formatMoney(d.summary.total_sales)} />
        <Stat label="Órdenes" value={d.summary.order_count.toString()} />
        <Stat label="Ticket prom." value={formatMoney(d.summary.avg_ticket)} />
        <Stat label="Anuladas" value={`${d.summary.cancelled_count} · ${formatMoney(d.summary.cancelled_value)}`} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Balance de efectivo</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <Row k="Apertura" v={formatMoney(d.summary.opening_amount)} />
          <Row k="+ Ventas efectivo" v={formatMoney(d.summary.cash_sales)} />
          <Row k="+ Entradas efectivo" v={formatMoney(d.summary.entries_cash)} />
          <Row k="- Gastos efectivo" v={formatMoney(d.summary.expenses_cash)} negative />
          <Row k="- Compras efectivo" v={formatMoney(d.summary.purchases_cash)} negative />
          <Row k="Esperado" v={formatMoney(d.summary.expected_cash)} bold />
          <Row k="Contado" v={formatMoney(d.summary.counted_amount)} bold />
          <Row k="Diferencia" v={`${d.summary.difference >= 0 ? "+" : ""}${formatMoney(d.summary.difference)}`} accent={d.summary.difference === 0 ? "text-emerald-600" : d.summary.difference > 0 ? "text-sky-600" : "text-red-600"} bold />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Métodos de pago</CardTitle></CardHeader>
        <CardContent>
          {Object.entries(d.payments).map(([k, v]) => (
            <Row key={k} k={<span className="capitalize">{k} · {v.count}</span>} v={formatMoney(v.amount)} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Productos vendidos</CardTitle></CardHeader>
        <CardContent className="max-h-64 overflow-y-auto">
          {d.products.map((p) => (
            <Row key={p.name} k={<span>{p.name} <span className="text-muted-foreground">×{p.qty}</span></span>} v={formatMoney(p.total)} />
          ))}
          {d.products.length === 0 && <p className="text-xs text-muted-foreground">Sin productos.</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MovList title="Entradas" icon={<ArrowDownLeft className="h-4 w-4 text-emerald-600" />} items={d.entradas} />
        <MovList title="Salidas / gastos" icon={<ArrowUpRight className="h-4 w-4 text-red-600" />} items={d.salidas} />
      </div>
      {d.devoluciones.length > 0 && <MovList title="Devoluciones" icon={<ArrowUpRight className="h-4 w-4" />} items={d.devoluciones} />}
      {d.deposits.length > 0 && <MovList title="Depósitos" icon={<PiggyBank className="h-4 w-4" />} items={d.deposits} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Row({ k, v, bold, negative, accent }: { k: React.ReactNode; v: React.ReactNode; bold?: boolean; negative?: boolean; accent?: string }) {
  return (
    <div className="flex justify-between border-b last:border-0 py-1">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className={`${bold ? "font-bold" : ""} ${negative ? "text-red-600" : ""} ${accent ?? ""}`}>{v}</span>
    </div>
  );
}

function MovList({ title, icon, items }: { title: string; icon: React.ReactNode; items: Array<{ id: string; amount: number; description?: string | null; category?: string | null; user_name?: string | null; created_at: string; method?: string | null }> }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">{icon}{title} ({items.length})</CardTitle></CardHeader>
      <CardContent className="max-h-64 overflow-y-auto space-y-1">
        {items.length === 0 && <p className="text-xs text-muted-foreground">Sin movimientos.</p>}
        {items.map((m) => (
          <div key={m.id} className="border-b last:border-0 py-1.5">
            <div className="flex justify-between">
              <span className="text-sm font-medium">{m.category ?? "—"}</span>
              <span className="font-semibold">{formatMoney(m.amount)}</span>
            </div>
            {m.description && <div className="text-[11px] text-muted-foreground">{m.description}</div>}
            <div className="text-[10px] text-muted-foreground flex gap-2">
              <Clock className="h-3 w-3" />{format(new Date(m.created_at), "HH:mm", { locale: es })}
              {m.user_name && <span>· {m.user_name}</span>}
              {m.method && <span>· {m.method}</span>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
