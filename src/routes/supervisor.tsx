import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  supervisorLogin,
  supervisorLogout,
  supervisorDashboard,
  supervisorSessionDetail,
  type SupervisorSessionDetail,
  type SupervisorMovement,
} from "@/lib/supervisor-client";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Building2, LogOut, RefreshCw, TrendingUp, ShoppingBag, Wallet, CreditCard,
  Users, Bike, Utensils, ChefHat, ShieldCheck, Eye, ArrowDownLeft, ArrowUpRight,
  ReceiptText, AlertTriangle, CalendarIcon, PiggyBank, ArrowUpDown, ArrowRightLeft,
} from "lucide-react";
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

// ==================== LABELS DE MÉTODOS ====================
const METHOD_LABEL: Record<string, string> = {
  efectivo: "EFECTIVO",
  nequi: "NEQUI",
  bancolombia: "BANCOLOMBIA",
  daviplata: "DAVIPLATA",
  bcolombia: "BANCOLOMBIA",
  tarjeta: "TARJETA",
  transferencia: "TRANSFERENCIA",
  qr: "QR",
  mixto: "PAGO MIXTO",
  otro: "OTRO",
};
const methodLabel = (k: string) => METHOD_LABEL[k.toLowerCase()] ?? k.toUpperCase();

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
                type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
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

function toBogotaDateStr(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value ?? "";
  const m = parts.find(p => p.type === "month")?.value ?? "";
  const day = parts.find(p => p.type === "day")?.value ?? "";
  return `${y}-${m}-${day}`;
}

function SupervisorDashboard({ session, onLogout }: { session: StoredSession; onLogout: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof supervisorDashboard>> | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const todayStr = toBogotaDateStr(new Date());
  const yesterday = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; }, []);
  const yesterdayStr = toBogotaDateStr(yesterday);
  const selectedStr = toBogotaDateStr(selectedDate);
  const isToday = selectedStr === todayStr;
  const isYesterday = selectedStr === yesterdayStr;

  const load = useCallback(async (bid: string | null, dateStr: string | null, logSwitch = false) => {
    setLoading(true);
    try {
      const res = await supervisorDashboard({ session_token: session.session_token, branch_id: bid, log_switch: logSwitch, date: dateStr });
      setData(res);
      setBranchId(res.active_branch_id);
      setLoadError(null);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.toLowerCase().includes("sesión") || msg.toLowerCase().includes("acceso")) {
        toast.error(msg); onLogout();
      } else {
        setLoadError(msg || "No se pudo cargar la información del supervisor");
        toast.error(msg || "No se pudo cargar la información del supervisor");
      }
    } finally { setLoading(false); }
  }, [session.session_token, onLogout]);

  useEffect(() => {
    load(branchId, isToday ? null : selectedStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStr]);

  useEffect(() => {
    if (!isToday) return;
    const int = setInterval(() => load(branchId, null), 30_000);
    return () => clearInterval(int);
  }, [branchId, load, isToday]);

  useEffect(() => {
    if (!branchId || !isToday) return;
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => load(branchId, null), 350);
    };
    const channel = supabase
      .channel(`supervisor-live-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_deposits", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables", filter: `branch_id=eq.${branchId}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [branchId, load, isToday]);

  async function handleLogout() {
    try { await supervisorLogout({ session_token: session.session_token }); } catch { /* noop */ }
    onLogout();
  }

  async function switchBranch(id: string) {
    if (id === branchId) return;
    setData(null); setBranchId(id);
    await load(id, isToday ? null : selectedStr, true);
  }

  function pickDate(d: Date | undefined) {
    if (!d) return;
    setData(null); setSelectedDate(d);
  }

  const s = data?.summary;
  const hours = useMemo(() => data ? Object.entries(data.by_hour).sort(([a], [b]) => a.localeCompare(b)) : [], [data]);
  const maxHour = hours.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
  const scopeTitle = isToday ? "Hoy" : isYesterday ? "Ayer" : format(selectedDate, "PPP", { locale: es });

  const expectedCash = Number(s?.expected_cash ?? 0);
  const activeCashLabel = data?.active_cash
    ? (data.active_cash.status === "open" ? "Abierta" : "Cerrada")
    : null;

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
              <SelectTrigger className="h-10 min-w-[200px] gap-2 font-semibold border-2 border-primary/40 bg-primary/5">
                <Building2 className="h-4 w-4" />
                <SelectValue placeholder="Sede" />
              </SelectTrigger>
              <SelectContent>
                {data?.branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " · Principal" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant={isToday ? "default" : "outline"} className="h-10" onClick={() => pickDate(new Date())}>Hoy</Button>
            <Button size="sm" variant={isYesterday ? "default" : "outline"} className="h-10" onClick={() => pickDate(yesterday)}>Ayer</Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-10 gap-2 font-semibold", !isToday && !isYesterday && "border-primary text-primary")}>
                  <CalendarIcon className="h-4 w-4" />
                  {isToday ? "Hoy" : isYesterday ? "Ayer" : format(selectedDate, "d MMM yyyy", { locale: es })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar mode="single" selected={selectedDate} onSelect={pickDate} initialFocus locale={es} disabled={(d) => d > new Date()} className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={() => load(branchId, isToday ? null : selectedStr)} disabled={loading}>
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
          <Card><CardContent className="p-8 text-center space-y-3">
            <div className="font-semibold">No se pudo cargar la información.</div>
            <div className="text-sm text-muted-foreground">{loadError}</div>
            <Button variant="outline" onClick={() => load(branchId, isToday ? null : selectedStr)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Reintentar
            </Button>
          </CardContent></Card>
        )}

        {data && (
          <Tabs defaultValue="dashboard" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3 max-w-xl">
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="historial">Historial de Cajas</TabsTrigger>
              <TabsTrigger value="salidas">Salidas</TabsTrigger>
            </TabsList>

            {/* =============== DASHBOARD =============== */}
            <TabsContent value="dashboard" className="space-y-4">
              {isToday && !data.active_cash && (
                <Card className="border-amber-300 bg-amber-50">
                  <CardContent className="p-4 text-sm text-amber-900 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> No existe un turno activo actualmente en esta sede. Se muestra el resumen del día.
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi icon={TrendingUp} label={isToday ? "Ventas de hoy" : "Ventas del día"} value={formatCurrency(s?.total_sales ?? 0)} tone="from-emerald-500/15 to-emerald-500/5 text-emerald-700" />
                <Kpi icon={ShoppingBag} label="Pedidos" value={String(s?.order_count ?? 0)} tone="from-sky-500/15 to-sky-500/5 text-sky-700" />
                <Kpi icon={Wallet} label="Ticket promedio" value={formatCurrency(s?.avg_ticket ?? 0)} tone="from-amber-500/15 to-amber-500/5 text-amber-700" />
                <Kpi icon={CreditCard} label="Digital" value={formatCurrency(s?.digital_total ?? 0)} tone="from-violet-500/15 to-violet-500/5 text-violet-700" />
                <Kpi icon={Wallet} label="Ventas en efectivo" value={formatCurrency(s?.cash_total ?? 0)} tone="from-emerald-500/15 to-emerald-500/5 text-emerald-700" />
                <Kpi icon={PiggyBank} label="Efectivo esperado en caja" value={formatCurrency(expectedCash)} tone="from-teal-500/15 to-teal-500/5 text-teal-700" />
                <Kpi icon={ArrowDownLeft} label="Entradas y depósitos" value={formatCurrency(s?.deposits ?? 0)} tone="from-lime-500/15 to-lime-500/5 text-lime-700" />
                <Kpi icon={ArrowUpRight} label="Salidas y gastos" value={formatCurrency(s?.expenses ?? 0)} tone="from-rose-500/15 to-rose-500/5 text-rose-700" />
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
                      <div className="text-sm text-muted-foreground py-8 text-center">Aún no hay ventas registradas.</div>
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
                          <Badge className={data.active_cash.status === "open" ? "bg-emerald-600" : "bg-muted text-muted-foreground"}>{activeCashLabel}</Badge>
                          {data.active_cash.user_name && <span className="text-muted-foreground">Cajero: <b className="text-foreground">{data.active_cash.user_name}</b></span>}
                        </div>
                        <div className="text-xs text-muted-foreground">Apertura: {data.active_cash.opened_at ? new Date(data.active_cash.opened_at).toLocaleString() : "—"}</div>
                        <div className="text-xs text-muted-foreground">Monto inicial: {formatCurrency(Number(data.active_cash.opening_amount ?? 0))}</div>
                        <div className="text-xs text-muted-foreground">Efectivo esperado: <b className="text-foreground">{formatCurrency(expectedCash)}</b></div>
                        <div className="text-xs text-muted-foreground">Alcance: {scopeTitle}</div>
                        {data.active_cash.closed_at && <div className="text-xs text-muted-foreground">Cierre: {new Date(data.active_cash.closed_at).toLocaleString()}</div>}
                        <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setDetailId(data.active_cash!.id)}>
                          <ReceiptText className="h-4 w-4 mr-1" /> Ver detalle del turno
                        </Button>
                      </>
                    ) : <div className="text-muted-foreground">Sin caja registrada para esta fecha.</div>}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <BreakdownCard title="Por tipo de servicio" icon={Utensils} data={data.by_service} labelFn={(k) => k.toUpperCase()} />
                <BreakdownCard title="Por medio de pago" icon={CreditCard} data={data.by_payment} labelFn={methodLabel} />
                <Card>
                  <CardHeader><CardTitle className="text-base">Top productos</CardTitle></CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {data.top_products.length === 0 && <div className="text-muted-foreground">Sin datos.</div>}
                    {data.top_products.slice(0, 10).map((p, i) => (
                      <div key={p.name} className="flex justify-between border-b last:border-0 py-1 gap-2">
                        <span className="break-words"><span className="text-muted-foreground mr-2">{i + 1}.</span>{p.name}</span>
                        <span className="font-semibold text-right shrink-0">{p.qty} · {formatCurrency(Number(p.total ?? 0))}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* =============== HISTORIAL =============== */}
            <TabsContent value="historial" className="space-y-3">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><ReceiptText className="h-4 w-4" /> Cierres de caja · {scopeTitle}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(data.recent_closures ?? []).length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">Sin cierres registrados en esta fecha.</div>}
                  {(data.recent_closures ?? []).map((c) => {
                    const counted = Number(c.counted_amount ?? 0);
                    const expected = Number(c.expected_amount ?? 0);
                    const diff = counted - expected;
                    const turnNumber = c.id.slice(0, 3).toUpperCase();
                    return (
                      <div key={c.id} className="rounded-xl border p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono bg-muted rounded px-2 py-0.5">#{turnNumber}</span>
                            <span className="font-semibold">{c.user_name ?? "—"}</span>
                            <Badge className={c.status === "open" ? "bg-emerald-600" : "bg-muted text-muted-foreground"}>{c.status === "open" ? "Abierta" : "Cerrada"}</Badge>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => setDetailId(c.id)}>Ver detalle</Button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Apertura: {c.opened_at ? new Date(c.opened_at).toLocaleString() : "—"}
                          {" · "}Cierre: {c.closed_at ? new Date(c.closed_at).toLocaleString() : "en curso"}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <MiniStat label="Apertura" value={formatCurrency(Number(c.opening_amount ?? 0))} />
                          <MiniStat label="Esperado" value={formatCurrency(expected)} />
                          <MiniStat label="Declarado" value={formatCurrency(counted)} />
                          <MiniStat label="Diferencia" value={formatCurrency(diff)} tone={diff === 0 ? "text-emerald-700" : diff > 0 ? "text-sky-700" : "text-rose-700"} />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            {/* =============== SALIDAS =============== */}
            <TabsContent value="salidas" className="space-y-3">
              <MovementsView movements={data.movements ?? []} />
            </TabsContent>
          </Tabs>
        )}

        {data && (
          <div className="text-xs text-muted-foreground text-center pt-2">
            {scopeTitle} · Última actualización: {new Date(data.generated_at).toLocaleTimeString()} · Solo lectura
          </div>
        )}
      </main>

      <SessionDetailDialog
        open={!!detailId}
        onClose={() => setDetailId(null)}
        sessionToken={session.session_token}
        cashSessionId={detailId}
      />
    </div>
  );
}

// ==================== SUB-COMPONENTES ====================

function Kpi({ icon: Icon, label, value, tone }: { icon: typeof TrendingUp; label: string; value: string; tone: string }) {
  return (
    <Card className={`bg-gradient-to-br ${tone} border-0`}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className="rounded-xl bg-background/60 p-2 shrink-0"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted-foreground leading-tight">{label}</div>
          <div className="text-lg sm:text-xl font-bold leading-tight break-words">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, icon: Icon, data, labelFn }: { title: string; icon: typeof Utensils; data: Record<string, number>; labelFn?: (k: string) => string }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4" />{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {entries.length === 0 && <div className="text-muted-foreground">Sin datos.</div>}
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="flex justify-between text-xs mb-0.5 gap-2">
              <span className="font-medium">{labelFn ? labelFn(k) : k}</span>
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

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-bold", tone)}>{value}</div>
    </div>
  );
}

// ==================== DETALLE DE SALIDAS ====================

function categorizeMovement(m: SupervisorMovement): "gasto" | "deposito" | "retiro" | "devolucion" | "reembolso" | "salida" | "entrada" {
  const c = (m.category ?? "").toLowerCase();
  if (m.kind === "deposit") return c.includes("entrada") ? "entrada" : "deposito";
  if (c.includes("retiro")) return "retiro";
  if (c.includes("devol")) return "devolucion";
  if (c.includes("reembolso")) return "reembolso";
  if (c.includes("salida")) return "salida";
  return "gasto";
}

const MOV_LABEL: Record<string, string> = {
  gasto: "GASTO", deposito: "DEPÓSITO", retiro: "RETIRO",
  devolucion: "DEVOLUCIÓN", reembolso: "REEMBOLSO", salida: "SALIDA", entrada: "ENTRADA",
};

function MovementsView({ movements }: { movements: SupervisorMovement[] }) {
  const active = movements.filter((m) => (m.status ?? "active") === "active");
  const totals = active.reduce<Record<string, number>>((a, m) => {
    const t = categorizeMovement(m);
    a[t] = (a[t] ?? 0) + Number(m.amount || 0);
    return a;
  }, {});
  const totalGastos = totals.gasto ?? 0;
  const totalRetiros = totals.retiro ?? 0;
  const totalDevRee = (totals.devolucion ?? 0) + (totals.reembolso ?? 0);
  const totalOtras = (totals.salida ?? 0);
  const totalEntradas = (totals.entrada ?? 0) + (totals.deposito ?? 0);
  const totalGeneral = totalGastos + totalRetiros + totalDevRee + totalOtras;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumTile label="Total gastos" value={formatCurrency(totalGastos)} icon={ArrowUpRight} tone="text-rose-700 bg-rose-50" />
        <SumTile label="Total retiros" value={formatCurrency(totalRetiros)} icon={ArrowUpDown} tone="text-amber-700 bg-amber-50" />
        <SumTile label="Devoluciones / reembolsos" value={formatCurrency(totalDevRee)} icon={ArrowRightLeft} tone="text-orange-700 bg-orange-50" />
        <SumTile label="Otras salidas" value={formatCurrency(totalOtras)} icon={ArrowUpRight} tone="text-slate-700 bg-slate-50" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Detalle de movimientos</CardTitle>
          <div className="text-sm text-muted-foreground">Entradas: <b className="text-emerald-700">{formatCurrency(totalEntradas)}</b> · Salidas totales: <b className="text-rose-700">{formatCurrency(totalGeneral)}</b></div>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Sin movimientos registrados.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Usuario</th>
                    <th className="text-left py-2 px-2">Tipo</th>
                    <th className="text-left py-2 px-2">Categoría</th>
                    <th className="text-left py-2 px-2">Descripción</th>
                    <th className="text-left py-2 px-2">Medio</th>
                    <th className="text-right py-2 px-2">Valor</th>
                    <th className="text-left py-2 px-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => {
                    const tipo = categorizeMovement(m);
                    const inactive = (m.status ?? "active") !== "active";
                    return (
                      <tr key={m.id} className={cn("border-b last:border-0", inactive && "opacity-50 line-through")}>
                        <td className="py-2 px-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                        <td className="py-2 px-2">{m.user_name ?? "—"}</td>
                        <td className="py-2 px-2"><Badge variant="outline">{MOV_LABEL[tipo]}</Badge></td>
                        <td className="py-2 px-2 capitalize">{m.category ?? "—"}</td>
                        <td className="py-2 px-2 max-w-[280px]">{m.description ?? "—"}</td>
                        <td className="py-2 px-2 uppercase text-xs">{methodLabel(m.method ?? "efectivo")}</td>
                        <td className={cn("py-2 px-2 text-right font-semibold", m.kind === "deposit" ? "text-emerald-700" : "text-rose-700")}>{formatCurrency(Number(m.amount || 0))}</td>
                        <td className="py-2 px-2 text-xs">{m.status ?? "active"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function SumTile({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof ArrowUpRight; tone: string }) {
  return (
    <Card className={cn("border-0", tone)}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-lg bg-white/60 p-2"><Icon className="h-4 w-4" /></div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium leading-tight opacity-80">{label}</div>
          <div className="text-lg font-bold leading-tight break-words">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== DETALLE DE CIERRE ====================

function SessionDetailDialog({ open, onClose, sessionToken, cashSessionId }: {
  open: boolean; onClose: () => void; sessionToken: string; cashSessionId: string | null;
}) {
  const [detail, setDetail] = useState<SupervisorSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !cashSessionId) { setDetail(null); return; }
    setLoading(true); setError(null);
    supervisorSessionDetail({ session_token: sessionToken, cash_session_id: cashSessionId })
      .then(setDetail)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, cashSessionId, sessionToken]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalle del cierre</DialogTitle>
        </DialogHeader>
        {loading && <div className="py-8 text-center text-muted-foreground">Cargando…</div>}
        {error && <div className="py-8 text-center text-rose-600">{error}</div>}
        {detail && <SessionDetailView detail={detail} />}
      </DialogContent>
    </Dialog>
  );
}

function SessionDetailView({ detail }: { detail: SupervisorSessionDetail }) {
  const { session, summary, payments, services, products, movements, branch_name } = detail;
  const turnNumber = session.id.slice(0, 3).toUpperCase();
  const diff = summary.difference;
  const totalPayments = Object.values(payments).reduce((a, v) => a + v.amount, 0);
  const totalTx = Object.values(payments).reduce((a, v) => a + v.count, 0);
  const isOpen = session.status === "open";

  return (
    <Tabs defaultValue="resumen" className="space-y-4">
      <div>
        <div className="text-lg font-bold">Arqueo #{turnNumber} {isOpen && <Badge className="bg-emerald-600 ml-2">Turno en curso</Badge>}</div>
        <div className="text-sm text-muted-foreground">{branch_name} · {session.user_name ?? "—"}</div>
        <div className="text-xs text-muted-foreground">
          {new Date(session.opened_at).toLocaleString()} → {session.closed_at ? new Date(session.closed_at).toLocaleString() : "en curso"}
        </div>
      </div>

      <TabsList className="grid grid-cols-3">
        <TabsTrigger value="resumen">Resumen</TabsTrigger>
        <TabsTrigger value="productos">Productos</TabsTrigger>
        <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
      </TabsList>

      <TabsContent value="resumen" className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Pedidos" value={String(summary.order_count)} />
          <MiniStat label="Ventas totales" value={formatCurrency(summary.total_sales)} />
          <MiniStat label="Ticket promedio" value={formatCurrency(summary.avg_ticket)} />
          <MiniStat label="Cancelados" value={`${summary.cancelled_count} · ${formatCurrency(summary.cancelled_value)}`} />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm">Ventas por método de pago</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.entries(payments).length === 0 && <div className="text-muted-foreground">Sin datos.</div>}
            {Object.entries(payments).map(([k, v]) => (
              <div key={k} className="flex justify-between items-center border-b last:border-0 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{methodLabel(k)}</span>
                  <span className="text-xs bg-muted rounded-full px-2 py-0.5">{v.count} ventas</span>
                </div>
                <span className="font-bold">{formatCurrency(v.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 font-bold">
              <span>Total ({totalTx} transacciones)</span>
              <span className="text-emerald-700">{formatCurrency(totalPayments)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Ventas por tipo de servicio</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.entries(services).length === 0 && <div className="text-muted-foreground">Sin datos.</div>}
            {Object.entries(services).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b last:border-0 py-1.5">
                <span className="uppercase font-medium">{k}</span>
                <span><span className="text-xs text-muted-foreground mr-2">{v.count} pedidos</span><b>{formatCurrency(v.amount)}</b></span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Balance de efectivo en caja</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <BalanceRow label="Apertura de caja" value={formatCurrency(summary.opening_amount)} />
            <BalanceRow label="+ Ventas en efectivo" value={formatCurrency(summary.cash_total)} tone="text-emerald-700" />
            <BalanceRow label="+ Entradas y depósitos en efectivo" value={formatCurrency(summary.deposits_cash)} tone="text-emerald-700" />
            <BalanceRow label="− Gastos y salidas en efectivo" value={`−${formatCurrency(summary.expenses_cash)}`} tone="text-rose-700" />
            <div className="border-t pt-2 flex justify-between font-bold">
              <span>= Efectivo esperado</span><span className="text-teal-700">{formatCurrency(summary.expected_cash)}</span>
            </div>
            {!isOpen && (
              <>
                <div className="flex justify-between pt-1"><span>Declarado por el cajero</span><span className="font-bold">{formatCurrency(summary.counted_amount)}</span></div>
                <div className="flex justify-between font-bold border-t pt-2">
                  <span>Diferencia</span>
                  <span className={cn(diff === 0 ? "text-emerald-700" : diff > 0 ? "text-sky-700" : "text-rose-700")}>
                    {formatCurrency(diff)} · {diff === 0 ? "Cuadrado" : diff > 0 ? "Sobrante" : "Faltante"}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="productos">
        <Card>
          <CardHeader><CardTitle className="text-sm">Productos vendidos</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {products.length === 0 && <div className="text-muted-foreground">Sin datos.</div>}
            {products.map((p, i) => (
              <div key={p.name + i} className="flex justify-between border-b last:border-0 py-1.5 gap-2">
                <span><span className="text-muted-foreground mr-2">{i + 1}.</span>{p.name}</span>
                <span className="font-semibold shrink-0">{Number(p.qty)} · {formatCurrency(Number(p.total))}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="ajustes">
        <MovementsView movements={movements} />
      </TabsContent>
    </Tabs>
  );
}

function BalanceRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={cn("font-semibold", tone)}>{value}</span>
    </div>
  );
}
