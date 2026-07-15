import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supervisorLogin, supervisorLogout, supervisorDashboard } from "@/lib/supervisor-client";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, LogOut, RefreshCw, TrendingUp, ShoppingBag, Wallet, CreditCard, Users, Bike, Utensils, ChefHat, ShieldCheck, Eye, ArrowDownLeft, ArrowUpRight, ReceiptText, AlertTriangle, CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatMoney as formatCurrency } from "@/lib/format";

const SESSION_KEY = "goloso.supervisor.session";

export const Route = createFileRoute("/supervisor")({
  ssr: false,
  head: () => ({ meta: [{ title: "Modo Supervisor · Goloso" }, { name: "robots", content: "noindex" }] }),
  component: SupervisorPage,
});

interface StoredSession {
  session_token: string;
  expires_at: string;
  display_name: string;
  username: string;
}

function SupervisorPage() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s: StoredSession = JSON.parse(raw);
        if (new Date(s.expires_at) > new Date()) setSession(s);
        else localStorage.removeItem(SESSION_KEY);
      }
    } catch { /* noop */ }
    setReady(true);
  }, []);

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Cargando…</div>;
  if (!session) return <SupervisorLogin onSuccess={(s) => { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); setSession(s); }} />;
  return <SupervisorDashboard session={session} onLogout={() => { localStorage.removeItem(SESSION_KEY); setSession(null); }} />;
}

function SupervisorLogin({ onSuccess }: { onSuccess: (s: StoredSession) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const token = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("t") ?? undefined : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) return toast.error("El PIN debe tener 4 dígitos");
    if (!token && !displayName.trim()) return toast.error("Ingresa tu nombre");
    setLoading(true);
    try {
      const res = await supervisorLogin({ display_name: displayName.trim() || undefined, pin, token });
      onSuccess(res);
    } catch (err) {
      toast.error((err as Error).message);
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <Card className="w-full max-w-md shadow-xl border-2">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl font-display">Modo Supervisor</CardTitle>
          <p className="text-sm text-muted-foreground">Acceso exclusivo de solo lectura para Heladería Goloso.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus placeholder="Ej: Camilo Torres" />
            </div>
            <div className="space-y-2">
              <Label>PIN de 4 dígitos</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                autoComplete="one-time-code"
                className="text-center text-2xl tracking-[0.6em] font-mono"
              />
            </div>
            <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={loading || pin.length !== 4 || (!token && !displayName.trim())}>
              {loading ? "Verificando…" : "Ingresar"}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground pt-2">
              Este acceso no permite modificar información del sistema.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SupervisorDashboard({ session, onLogout }: { session: StoredSession; onLogout: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof supervisorDashboard>> | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (bid: string | null, logSwitch = false) => {
    setLoading(true);
    try {
      const res = await supervisorDashboard({ session_token: session.session_token, branch_id: bid, log_switch: logSwitch });
      setData(res);
      setBranchId(res.active_branch_id);
      setLoadError(null);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.toLowerCase().includes("sesión") || msg.toLowerCase().includes("acceso")) {
        toast.error(msg);
        onLogout();
      } else {
        setLoadError(msg || "No se pudo cargar la información del supervisor");
        toast.error(msg || "No se pudo cargar la información del supervisor");
      }
    } finally { setLoading(false); }
  }, [session.session_token, onLogout]);

  useEffect(() => { load(null); }, [load]);
  useEffect(() => {
    const int = setInterval(() => load(branchId), 30_000);
    return () => clearInterval(int);
  }, [branchId, load]);

  useEffect(() => {
    if (!branchId) return;
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => load(branchId), 350);
    };
    const channel = supabase
      .channel(`supervisor-live-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_deposits", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [branchId, load]);

  async function handleLogout() {
    try { await supervisorLogout({ session_token: session.session_token }); } catch { /* noop */ }
    onLogout();
  }

  async function switchBranch(id: string) {
    if (id === branchId) return;
    await load(id, true);
  }

  const s = data?.summary;
  const hours = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.by_hour).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);
  const maxHour = hours.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
  const scopeTitle = data?.scope?.kind === "active_cash_session" ? "Turno activo" : data?.scope?.kind === "latest_cash_session" ? "Último turno" : "Día actual";

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0">
              <Eye className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-widest text-primary">Modo Supervisor</div>
              <div className="font-semibold truncate">{session.display_name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={branchId ?? undefined} onValueChange={switchBranch}>
              <SelectTrigger className="h-10 min-w-[180px] gap-2 font-semibold border-2 border-primary/40 bg-primary/5">
                <Building2 className="h-4 w-4" />
                <SelectValue placeholder="Sede" />
              </SelectTrigger>
              <SelectContent>
                {data?.branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " · Principal" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => load(branchId)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-1" /> Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 space-y-4">
        {!data && !loadError && <Card><CardContent className="p-8 text-center text-muted-foreground">Cargando información…</CardContent></Card>}
        {!data && loadError && (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <div className="font-semibold">No se pudo cargar la información.</div>
              <div className="text-sm text-muted-foreground">{loadError}</div>
              <Button variant="outline" onClick={() => load(branchId)} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Reintentar
              </Button>
            </CardContent>
          </Card>
        )}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi icon={TrendingUp} label="Ventas del turno" value={formatCurrency(s?.total_sales ?? 0)} tone="from-emerald-500/15 to-emerald-500/5 text-emerald-700" />
              <Kpi icon={ShoppingBag} label="Pedidos" value={String(s?.order_count ?? 0)} tone="from-sky-500/15 to-sky-500/5 text-sky-700" />
              <Kpi icon={Wallet} label="Ticket promedio" value={formatCurrency(s?.avg_ticket ?? 0)} tone="from-amber-500/15 to-amber-500/5 text-amber-700" />
              <Kpi icon={CreditCard} label="Digital" value={formatCurrency(s?.digital_total ?? 0)} tone="from-violet-500/15 to-violet-500/5 text-violet-700" />
              <Kpi icon={Wallet} label="Efectivo" value={formatCurrency(s?.cash_total ?? 0)} tone="from-emerald-500/15 to-emerald-500/5 text-emerald-700" />
              <Kpi icon={ArrowDownLeft} label="Entradas" value={formatCurrency((s?.entries ?? 0) + (s?.deposits ?? 0))} tone="from-lime-500/15 to-lime-500/5 text-lime-700" />
              <Kpi icon={ArrowUpRight} label="Salidas/Gastos" value={formatCurrency((s?.exits ?? 0) + (s?.expenses ?? 0) + (s?.refunds ?? 0))} tone="from-rose-500/15 to-rose-500/5 text-rose-700" />
              <Kpi icon={AlertTriangle} label="Cancelados" value={`${s?.cancelled_count ?? 0} · ${formatCurrency(s?.cancelled_value ?? 0)}`} tone="from-slate-500/15 to-slate-500/5 text-slate-700" />
              <Kpi icon={Users} label="Mesas ocupadas" value={String(s?.tables_occupied ?? 0)} tone="from-rose-500/15 to-rose-500/5 text-rose-700" />
              <Kpi icon={ChefHat} label="En preparación" value={String(s?.preparing ?? 0)} tone="from-orange-500/15 to-orange-500/5 text-orange-700" />
              <Kpi icon={Bike} label="Domicilios pendientes" value={String(s?.pending_domicilio ?? 0)} tone="from-indigo-500/15 to-indigo-500/5 text-indigo-700" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-base">Ventas por hora</CardTitle></CardHeader>
                <CardContent>
                  {hours.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-8 text-center">Aún no hay ventas hoy.</div>
                  ) : (
                    <div className="flex items-end gap-1 h-40">
                      {hours.map(([h, v]) => (
                        <div key={h} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full bg-primary/80 rounded-t" style={{ height: `${(v / maxHour) * 100}%` }} title={formatCurrency(v)} />
                          <div className="text-[10px] text-muted-foreground">{h}h</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Caja actual</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {data.active_cash ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge className={data.active_cash.status === "open" ? "bg-emerald-600" : "bg-muted text-muted-foreground"}>
                          {data.active_cash.status === "open" ? "Abierta" : "Cerrada"}
                        </Badge>
                        {data.active_cash.user_name && <span className="text-muted-foreground">Cajero: <b className="text-foreground">{data.active_cash.user_name}</b></span>}
                      </div>
                      <div className="text-xs text-muted-foreground">Apertura: {data.active_cash.opened_at ? new Date(data.active_cash.opened_at).toLocaleString() : "—"}</div>
                      <div className="text-xs text-muted-foreground">Monto inicial: {formatCurrency(Number(data.active_cash.opening_amount ?? 0))}</div>
                      <div className="text-xs text-muted-foreground">Alcance: {scopeTitle}</div>
                      {data.active_cash.closed_at && <div className="text-xs text-muted-foreground">Cierre: {new Date(data.active_cash.closed_at).toLocaleString()}</div>}
                    </>
                  ) : <div className="text-muted-foreground">Sin caja registrada hoy.</div>}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <BreakdownCard title="Por tipo de servicio" icon={Utensils} data={data.by_service} />
              <BreakdownCard title="Por medio de pago" icon={CreditCard} data={data.by_payment} />
              <Card>
                <CardHeader><CardTitle className="text-base">Top productos</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {data.top_products.length === 0 && <div className="text-muted-foreground">Sin datos.</div>}
                  {data.top_products.map((p, i) => (
                    <div key={p.name} className="flex justify-between border-b last:border-0 py-1">
                      <span className="truncate"><span className="text-muted-foreground mr-2">{i + 1}.</span>{p.name}</span>
                      <span className="font-semibold text-right shrink-0">{p.qty} · {formatCurrency(Number(p.total ?? 0))}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><ReceiptText className="h-4 w-4" /> Cierres de caja</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {(data.recent_closures ?? []).length === 0 && <div className="text-muted-foreground">Sin cierres registrados.</div>}
                {(data.recent_closures ?? []).map((c) => {
                  const counted = Number(c.counted_amount ?? 0) || Number(c.cash_counted ?? 0) + Number(c.nequi_counted ?? 0) + Number(c.bancolombia_counted ?? 0);
                  const expected = Number(c.expected_amount ?? 0) || Number(c.cash_expected ?? 0) + Number(c.nequi_expected ?? 0) + Number(c.bancolombia_expected ?? 0);
                  return (
                    <div key={c.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                      <div>
                        <div className="font-semibold">{c.user_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.opened_at ? new Date(c.opened_at).toLocaleString() : "—"} → {c.closed_at ? new Date(c.closed_at).toLocaleString() : "abierta"}
                        </div>
                      </div>
                      <Badge className={c.status === "open" ? "bg-emerald-600" : "bg-muted text-muted-foreground"}>{c.status === "open" ? "Abierta" : "Cerrada"}</Badge>
                      <div className="text-xs text-muted-foreground sm:text-right">Esperado <b className="text-foreground">{formatCurrency(expected)}</b></div>
                      <div className="text-xs text-muted-foreground sm:text-right">Declarado <b className="text-foreground">{formatCurrency(counted)}</b></div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="text-xs text-muted-foreground text-center pt-2">
              {scopeTitle}: {data.scope?.start_at ? new Date(data.scope.start_at).toLocaleString() : "—"} · Última actualización: {new Date(data.generated_at).toLocaleTimeString()} · Solo lectura
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof TrendingUp; label: string; value: string; tone: string }) {
  return (
    <Card className={`bg-gradient-to-br ${tone} border-0`}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="rounded-xl bg-background/60 p-2"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground truncate">{label}</div>
          <div className="text-xl font-bold truncate">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, icon: Icon, data }: { title: string; icon: typeof Utensils; data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4" />{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {entries.length === 0 && <div className="text-muted-foreground">Sin datos.</div>}
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="capitalize">{k}</span>
              <span className="font-semibold">{formatCurrency(v)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${(v / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
