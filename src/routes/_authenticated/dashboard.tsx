import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { useBranch } from "@/contexts/branch-context";
import { useAuth } from "@/hooks/use-auth";
import { getSharedDashboardPayload } from "@/lib/dashboard.functions";
import {
  DollarSign, ShoppingBag, Target, TrendingUp, Calendar, Globe, CreditCard,
  Package, Clock, Lightbulb, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import welcomeBanner from "@/assets/welcome-goloso.webp";
import welcomeBannerParque from "@/assets/welcome-goloso-parque.webp";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Goloso POS" }] }),
  errorComponent: ({ error, reset }) => (
    <div className="space-y-3 p-6">
      <h2 className="text-lg font-bold">No se pudo cargar el Dashboard</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Reintentar</button>
    </div>
  ),
  component: DashboardPage,
});

const norm = (s?: string | null) => (s ?? "").toLowerCase().trim();

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const METHOD_COLORS: Record<string, string> = {
  efectivo:      "bg-[#A3D93A]",
  nequi:         "bg-[#3AB6C8]",
  bancolombia:   "bg-[#F2C42B]",
  daviplata:     "bg-[#E88A9A]",
  tarjeta:       "bg-[#6B3A1E]",
  transferencia: "bg-[#D6303A]",
};

type Range = "hoy" | "ayer" | "semana" | "mes";

function rangeFor(r: Range) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let start: Date;
  if (r === "hoy") start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (r === "ayer") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (r === "semana") start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  else start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  return { start: start.toISOString(), end: end.toISOString() };
}

function DashboardPage() {
  const queryClient = useQueryClient();
  const dashboardPayload = useServerFn(getSharedDashboardPayload);
  const { user, loading: authLoading, rolesLoading } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const [range, setRange] = useState<Range>("hoy");
  const [origen, setOrigen] = useState<string>("all");
  const [pago, setPago] = useState<string>("all");

  useEffect(() => {
    if (!activeBranchId) return;
    void queryClient.invalidateQueries({ queryKey: ["dashboard-shared"] });
    void queryClient.invalidateQueries({ queryKey: ["reportes.cajas.rpc"] });
    void queryClient.invalidateQueries({ queryKey: ["reportes.session.detail"] });
    void queryClient.invalidateQueries({ queryKey: ["reportes.sales"] });
    void queryClient.invalidateQueries({ queryKey: ["reportes.expenses"] });
    void queryClient.invalidateQueries({ queryKey: ["reportes.purchases"] });
    void queryClient.invalidateQueries({ queryKey: ["reportes.sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["stats-all"] });
  }, [activeBranchId, queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-shared", user?.id ?? "anon", activeBranchId, range, origen, pago],
    enabled: !authLoading && !rolesLoading && !!user?.id && !!activeBranchId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: 10_000,
    queryFn: async (): Promise<{
      total: number; txs: number; avg: number; gastos: number; utilidad: number; qtyVendida: number;
      top: Array<{ name: string; qty: number; total: number }>;
      methods: Array<{ name: string; ingresos: number; egresos: number; neto: number; total: number }>;
      hourly: Array<{ hour: number; total: number }>;
      bestDays: Array<{ dow: number; name: string; total: number }>;
      valleys: number[];
      realCash: { efectivo: number; nequi: number; bancolombia: number; efectivoEsperado: number; nequiEsperado: number; bancolombiaEsperado: number; diferenciaEfectivo: number; diferenciaNequi: number; diferenciaBanco: number; cajasCerradas: number };
      activeCash: { id: string | null; userName: string | null; openedAt: string | null; openingAmount: number; status: string | null };
      pending: { tablesOccupied: number; pendingLlevar: number; pendingDomicilio: number; preparing: number };
    }> => {
      const raw = await dashboardPayload({
        data: { branchId: activeBranchId!, range, origen, pago },
      });
      const p = (raw ?? {}) as any;

      const hourlyArr: { hour: number; total: number }[] = Array.isArray(p.hourly) ? p.hourly : [];
      const hourly = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        total: Number(hourlyArr.find((x) => Number(x.hour) === h)?.total ?? 0),
      }));

      const bestDays = (Array.isArray(p.best_days) ? p.best_days : []).map((d: { dow: number; total: number }) => ({
        dow: Number(d.dow),
        name: DAY_NAMES[Number(d.dow)] ?? "",
        total: Number(d.total ?? 0),
      }));

      const activeHours = hourly.filter((h) => h.total > 0).map((h) => h.hour);
      const valleys: number[] = [];
      if (activeHours.length >= 2) {
        const first = Math.min(...activeHours);
        const last = Math.max(...activeHours);
        for (let h = first; h <= last; h++) if (hourly[h].total === 0) valleys.push(h);
      }

      const rc = p.real_cash ?? {};
      const realCash = {
        efectivo: Number(rc.efectivo ?? 0),
        nequi: Number(rc.nequi ?? 0),
        bancolombia: Number(rc.bancolombia ?? 0),
        efectivoEsperado: Number(rc.efectivoEsperado ?? 0),
        nequiEsperado: Number(rc.nequiEsperado ?? 0),
        bancolombiaEsperado: Number(rc.bancolombiaEsperado ?? 0),
        diferenciaEfectivo: Number(rc.diferenciaEfectivo ?? 0),
        diferenciaNequi: Number(rc.diferenciaNequi ?? 0),
        diferenciaBanco: Number(rc.diferenciaBanco ?? 0),
        cajasCerradas: Number(rc.cajasCerradas ?? 0),
      };
      const ac = p.active_cash ?? {};
      const activeCash = {
        id: typeof ac.id === "string" ? ac.id : null,
        userName: typeof ac.user_name === "string" ? ac.user_name : null,
        openedAt: typeof ac.opened_at === "string" ? ac.opened_at : null,
        openingAmount: Number(ac.opening_amount ?? 0),
        status: typeof ac.status === "string" ? ac.status : null,
      };
      const pendingRaw = p.pending ?? {};
      const pending = {
        tablesOccupied: Number(pendingRaw.tables_occupied ?? 0),
        pendingLlevar: Number(pendingRaw.pending_llevar ?? 0),
        pendingDomicilio: Number(pendingRaw.pending_domicilio ?? 0),
        preparing: Number(pendingRaw.preparing ?? 0),
      };

      return {
        total: Number(p.total ?? 0),
        txs: Number(p.txs ?? 0),
        avg: Number(p.avg ?? 0),
        gastos: Number(p.gastos ?? 0),
        utilidad: Number(p.utilidad ?? 0),
        qtyVendida: Number(p.qty_vendida ?? 0),
        top: (Array.isArray(p.top) ? p.top : []).map((t: { name: string; qty: number; total: number }) => ({
          name: String(t.name), qty: Number(t.qty ?? 0), total: Number(t.total ?? 0),
        })),
        methods: (Array.isArray(p.methods) ? p.methods : []).map((m: { name: string; ingresos: number; egresos: number; neto: number; total: number }) => ({
          name: String(m.name),
          ingresos: Number(m.ingresos ?? 0),
          egresos: Number(m.egresos ?? 0),
          neto: Number(m.neto ?? 0),
          total: Number(m.total ?? 0),
        })),
        hourly, bestDays, valleys, realCash, activeCash, pending,
      };
    },
  });

  const rangeLabel = { hoy: "Hoy", ayer: "Ayer", semana: "Últimos 7 días", mes: "Últimos 30 días" }[range];
  const gastoPct = data && data.total > 0 ? Math.min(100, (data.gastos / data.total) * 100) : 0;
  const marginPct = 100 - gastoPct;

  const hourlyData = useMemo(
    () => (data?.hourly ?? []).map((h) => ({ label: `${h.hour}:00`, total: h.total })),
    [data?.hourly],
  );

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-6">
      {/* Hero — banner de bienvenida. En móvil/tablet mantenemos el tamaño
          actual; en PC (lg+) el banner ocupa todo el ancho disponible del
          dashboard y crece en altura para dar impacto visual sin deformar
          la imagen (object-contain conserva proporciones). */}
      <div className="relative mx-auto w-full max-w-3xl lg:max-w-none overflow-hidden rounded-2xl sm:rounded-3xl shadow-lg lg:shadow-2xl">
        <img
          src={/parque/i.test(activeBranch?.name ?? "") ? welcomeBannerParque : welcomeBanner}
          alt={`Bienvenido ${activeBranch?.name ?? "Goloso"}`}
          className="block h-auto w-full object-contain sm:max-h-44 lg:max-h-none lg:w-full"
        />
      </div>





      {/* Filtros */}
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          <FilterField icon={<Calendar className="h-4 w-4" />} label="Fecha">
            <Select value={range} onValueChange={(v) => setRange(v as Range)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hoy">Hoy</SelectItem>
                <SelectItem value="ayer">Ayer</SelectItem>
                <SelectItem value="semana">Últimos 7 días</SelectItem>
                <SelectItem value="mes">Últimos 30 días</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField icon={<Globe className="h-4 w-4" />} label="Origen">
            <Select value={origen} onValueChange={setOrigen}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pos">POS</SelectItem>
                <SelectItem value="kiosk">Kiosko</SelectItem>
                <SelectItem value="online">En línea</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField icon={<CreditCard className="h-4 w-4" />} label="Pago" className="col-span-2 md:col-span-1">
            <Select value={pago} onValueChange={setPago}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="efectivo">Efectivo</SelectItem>
                <SelectItem value="nequi">Nequi</SelectItem>
                <SelectItem value="bancolombia">Bancolombia</SelectItem>
                <SelectItem value="daviplata">Daviplata</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>{[0,1,2,3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</>
        ) : (
          <>
            <KpiCard color="turquoise" icon={<DollarSign className="h-5 w-5" />}
              label="Ventas Totales" value={formatMoney(data?.total ?? 0)} hint="Período seleccionado" />
            <KpiCard color="lime" icon={<ShoppingBag className="h-5 w-5" />}
              label="Transacciones" value={String(data?.txs ?? 0)} hint="Pedidos completados" />
            <KpiCard color="pink" icon={<Target className="h-5 w-5" />}
              label="Ticket Promedio" value={formatMoney(data?.avg ?? 0)} hint="Valor por pedido" />
            <KpiCard color="yellow" icon={<TrendingUp className="h-5 w-5" />}
              label="Utilidad Estimada" value={formatMoney(data?.utilidad ?? 0)} hint="Ventas − Gastos" />
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>{[0,1,2,3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</>
        ) : (
          <>
            <KpiCard color="turquoise" icon={<Clock className="h-5 w-5" />}
              label="Pedidos en preparación" value={String(data?.pending.preparing ?? 0)} hint="Actualizado en vivo" />
            <KpiCard color="lime" icon={<ShoppingBag className="h-5 w-5" />}
              label="Domicilios pendientes" value={String(data?.pending.pendingDomicilio ?? 0)} hint="Por sede activa" />
            <KpiCard color="pink" icon={<Package className="h-5 w-5" />}
              label="Para llevar pendientes" value={String(data?.pending.pendingLlevar ?? 0)} hint="Pendientes / preparación" />
            <KpiCard color="yellow" icon={<Target className="h-5 w-5" />}
              label="Mesas ocupadas" value={String(data?.pending.tablesOccupied ?? 0)} hint={data?.activeCash.id ? "Caja abierta" : "Sin caja abierta"} />
          </>
        )}
      </div>

      {/* Alertas de inventario */}
      <InventoryAlerts branchId={activeBranchId} />

      {/* Evolución */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 font-display text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-[#E88A9A]/20 text-[#D6303A]">
              <TrendingUp className="h-4 w-4" />
            </span>
            Evolución de Ventas
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {range === "hoy" || range === "ayer"
              ? `Facturación por hora · ${rangeLabel}`
              : `Facturación diaria · ${rangeLabel}`}
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E88A9A" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#E88A9A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} tickMargin={4} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `$${Math.round(v/1000)}k` : `$${v}`} />
                <Tooltip
                  formatter={(v: number) => [formatMoney(v), "Venta"]}
                  labelFormatter={(l) => `Hora: ${l}`}
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="total" stroke="#D6303A" strokeWidth={2} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Top 5 productos */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 font-display text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-[#3AB6C8]/20 text-[#0F5A68]">
              <Package className="h-4 w-4" />
            </span>
            Top 5 Productos
          </CardTitle>
          <p className="text-xs text-muted-foreground">Por volumen de ingresos</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.top ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin ventas en el período.</p>
          )}
          {(data?.top ?? []).map((p, i) => {
            const max = data?.top[0]?.total || 1;
            const pct = (p.total / max) * 100;
            return (
              <div key={p.name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{i + 1}. <span className="text-foreground font-medium uppercase">{p.name}</span></span>
                  <span className="font-semibold">{formatMoney(p.total)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #A3D93A, #3AB6C8)" }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Métodos de Pago — saldos NETOS (ingresos − egresos por medio) */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="font-display text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">Disponible por Medio de Pago</CardTitle>
          <p className="text-xs text-muted-foreground">Ingresos − gastos, compras y egresos del mismo medio</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.methods ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>
          )}
          {(() => {
            const totalIngresos = (data?.methods ?? []).reduce((a: number, m: { ingresos?: number }) => a + (m.ingresos ?? 0), 0);
            const totalEgresos = (data?.methods ?? []).reduce((a: number, m: { egresos?: number }) => a + (m.egresos ?? 0), 0);
            const totalNeto = totalIngresos - totalEgresos;
            return (
              <>
                {(data?.methods ?? []).map((m: any) => {
                  const pct = totalIngresos > 0 ? (m.ingresos / totalIngresos) * 100 : 0;
                  const negativo = m.neto < 0;
                  return (
                    <div key={m.name} className="space-y-1 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`h-2.5 w-2.5 rounded-full ${METHOD_COLORS[norm(m.name)] ?? "bg-slate-400"}`} />
                          <span className="uppercase text-sm font-medium">{m.name}</span>
                        </div>
                        <div className="text-right">
                          <div className={`font-bold text-base ${negativo ? "text-[#D6303A]" : "text-foreground"}`}>{formatMoney(m.neto)}</div>
                          <div className="text-[10px] text-muted-foreground">Disponible real</div>
                        </div>
                      </div>
                      <div className="flex justify-between text-[11px] text-muted-foreground pl-5">
                        <span>Ingresos: <span className="text-foreground font-medium">{formatMoney(m.ingresos)}</span></span>
                        <span>Egresos: <span className="text-[#D6303A] font-medium">−{formatMoney(m.egresos)}</span></span>
                      </div>
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${METHOD_COLORS[norm(m.name)] ?? "bg-slate-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="pt-3 border-t space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="tracking-widest uppercase text-muted-foreground">Total ingresos</span>
                    <span className="font-semibold text-foreground">{formatMoney(totalIngresos)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="tracking-widest uppercase text-muted-foreground">Total egresos</span>
                    <span className="font-semibold text-[#D6303A]">−{formatMoney(totalEgresos)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-1 border-t">
                    <span className="tracking-widest uppercase text-muted-foreground font-medium">Neto disponible</span>
                    <span className={`font-black text-lg ${totalNeto < 0 ? "text-[#D6303A]" : "text-[#5A8A00]"}`}>{formatMoney(totalNeto)}</span>
                  </div>
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>

      {/* Efectivo Real (arqueo de caja) */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="font-display text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">Efectivo Real · Arqueo</CardTitle>
          <p className="text-xs text-muted-foreground">
            {data?.realCash.cajasCerradas
              ? `${data.realCash.cajasCerradas} caja(s) cerrada(s) en el período`
              : "Sin cajas cerradas en el período"}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {data?.realCash.cajasCerradas === 0 ? (
            <p className="text-sm text-muted-foreground">Cierra una caja para ver el conteo real.</p>
          ) : (
            <>
              <RealCashRow
                label="Efectivo"
                dotClass="bg-[#A3D93A]"
                counted={data?.realCash.efectivo ?? 0}
                expected={data?.realCash.efectivoEsperado ?? 0}
                diff={data?.realCash.diferenciaEfectivo ?? 0}
              />
              <RealCashRow
                label="Nequi"
                dotClass="bg-[#3AB6C8]"
                counted={data?.realCash.nequi ?? 0}
                expected={data?.realCash.nequiEsperado ?? 0}
                diff={data?.realCash.diferenciaNequi ?? 0}
              />
              <RealCashRow
                label="Bancolombia"
                dotClass="bg-[#F2C42B]"
                counted={data?.realCash.bancolombia ?? 0}
                expected={data?.realCash.bancolombiaEsperado ?? 0}
                diff={data?.realCash.diferenciaBanco ?? 0}
              />
              <div className="pt-3 border-t flex items-center justify-between text-xs">
                <span className="tracking-widest uppercase text-muted-foreground">Efectivo real total</span>
                <span className="font-bold text-foreground">
                  {formatMoney((data?.realCash.efectivo ?? 0) + (data?.realCash.nequi ?? 0) + (data?.realCash.bancolombia ?? 0))}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>


      {/* Mejores días */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="font-display text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">Mejores Días</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.bestDays ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin datos suficientes.</p>
          )}
          {(data?.bestDays ?? []).map((d, i) => (
            <div key={d.dow} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{i + 1}. <span className="text-foreground">{d.name}</span></span>
              <span className="font-semibold">{formatMoney(d.total)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Análisis de horas */}
      <Card className="rounded-2xl shadow-sm bg-[#FFF7D6] border-[#F2C42B]/50">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-[#8A6A00] font-medium">
            <Clock className="h-4 w-4" /> Análisis de Horas
          </div>
          {(data?.valleys ?? []).length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">Valles de facturación detectados:</p>
              <div className="flex flex-wrap gap-2">
                {data!.valleys.map((h) => (
                  <span key={h} className="px-3 py-1 rounded-full bg-[#F2C42B]/25 text-[#8A6A00] text-sm font-medium">
                    {String(h).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
              <p className="text-xs text-[#8A6A00] flex items-center gap-1 italic">
                <Lightbulb className="h-3.5 w-3.5" /> Planear promociones para subir tráfico.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Sin valles significativos en el período.</p>
          )}
        </CardContent>
      </Card>

      {/* Gastos vs Ingresos */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="font-display text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">Gastos vs Ingresos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full" style={{ width: `${marginPct}%`, background: "#A3D93A" }} />
            <div className="h-full" style={{ width: `${gastoPct}%`, background: "#D6303A" }} />
          </div>
          <div className="flex justify-between text-xs">
            <span className="font-semibold" style={{ color: "#5A8A00" }}>MARGEN</span>
            <span className="font-semibold" style={{ color: "#D6303A" }}>GASTO</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Gasto operativo: <span className="font-bold text-foreground">{gastoPct.toFixed(1)}%</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterField({
  icon, label, children, className = "",
}: { icon: React.ReactNode; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 font-display text-xs font-black uppercase tracking-[0.14em] text-primary mb-1.5">
        <span className="grid place-items-center h-5 w-5 rounded-md bg-primary/10 text-primary">{icon}</span>
        {label}
      </div>
      <div className="[&_button]:font-display [&_button]:font-bold [&_button]:tracking-tight">
        {children}
      </div>
    </div>
  );
}

function RealCashRow({
  label, dotClass, counted, expected, diff,
}: { label: string; dotClass: string; counted: number; expected: number; diff: number }) {
  const ok = Math.abs(diff) < 1;
  const positive = diff > 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
          <span className="uppercase text-sm">{label}</span>
        </div>
        <div className="text-right">
          <div className="font-semibold text-sm">{formatMoney(counted)}</div>
          <div className="text-[10px] text-muted-foreground">Esperado: {formatMoney(expected)}</div>
        </div>
      </div>
      <div className="flex justify-end">
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            ok ? "bg-muted text-muted-foreground"
              : positive ? "bg-[#A3D93A]/25 text-[#5A8A00]"
              : "bg-[#E88A9A]/25 text-[#D6303A]"
          }`}
        >
          {ok ? "Cuadre exacto" : `${positive ? "Sobrante" : "Faltante"} ${formatMoney(Math.abs(diff))}`}
        </span>
      </div>
    </div>
  );
}

const KPI_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  turquoise: { border: "border-l-[#3AB6C8]", text: "text-[#0F5A68]", bg: "bg-[#3AB6C8]/20 text-[#0F5A68]" },
  lime:      { border: "border-l-[#A3D93A]", text: "text-[#5A8A00]", bg: "bg-[#A3D93A]/25 text-[#5A8A00]" },
  pink:      { border: "border-l-[#E88A9A]", text: "text-[#D6303A]", bg: "bg-[#E88A9A]/25 text-[#D6303A]" },
  yellow:    { border: "border-l-[#F2C42B]", text: "text-[#8A6A00]", bg: "bg-[#F2C42B]/25 text-[#8A6A00]" },
};

function KpiCard({
  color, icon, label, value, hint,
}: { color: keyof typeof KPI_COLORS; icon: React.ReactNode; label: string; value: string; hint?: string }) {
  const c = KPI_COLORS[color];
  return (
    <Card className={`rounded-2xl shadow-sm border-l-4 ${c.border}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`font-display text-2xl font-bold ${c.text} truncate`}>{value}</div>
          {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
        </div>
        <div className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${c.bg}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

function InventoryAlerts({ branchId }: { branchId: string | null }) {
  const { data } = useQuery({
    queryKey: ["dash-inv-alerts", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,stock,min_stock,track_stock,available_branch_ids,categories(name)")
        .eq("track_stock", true)
        .eq("active", true);
      const rows = (data ?? []).filter((p: any) =>
        !p.available_branch_ids ||
        p.available_branch_ids.length === 0 ||
        p.available_branch_ids.includes(branchId),
      );
      const out = rows.filter((p: any) => Number(p.stock) <= 0);
      const low = rows.filter((p: any) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock));
      return { out, low };
    },
  });
  const outCount = data?.out.length ?? 0;
  const lowCount = data?.low.length ?? 0;
  if (outCount === 0 && lowCount === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {outCount > 0 && (
        <Card className="rounded-2xl border-rose-500/40 bg-rose-50/60 dark:bg-rose-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-rose-700 dark:text-rose-300 text-base flex items-center justify-between">
              <span>🚨 Productos agotados</span>
              <Badge variant="destructive">{outCount}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {data?.out.slice(0, 20).map((p: any) => (
                <span key={p.id} className="rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 px-2 py-1 text-xs font-medium">
                  {p.name}
                </span>
              ))}
              {outCount > 20 && <span className="text-xs text-muted-foreground self-center">+{outCount - 20} más</span>}
            </div>
          </CardContent>
        </Card>
      )}
      {lowCount > 0 && (
        <Card className="rounded-2xl border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-700 dark:text-amber-300 text-base flex items-center justify-between">
              <span>⚠️ Stock bajo</span>
              <Badge className="bg-amber-500 hover:bg-amber-600 text-white">{lowCount}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {data?.low.slice(0, 20).map((p: any) => (
                <span key={p.id} className="rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-1 text-xs font-medium">
                  {p.name} · {Number(p.stock)}/{Number(p.min_stock)}
                </span>
              ))}
              {lowCount > 20 && <span className="text-xs text-muted-foreground self-center">+{lowCount - 20} más</span>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
