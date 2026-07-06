import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { useBranch } from "@/contexts/branch-context";
import {
  DollarSign, ShoppingBag, Target, TrendingUp, Calendar, Globe, CreditCard,
  Package, Clock, Lightbulb, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import welcomeBanner from "@/assets/welcome-goloso.jpeg.asset.json";

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
  const { activeBranchId, activeBranch } = useBranch();
  const [range, setRange] = useState<Range>("hoy");
  const [origen, setOrigen] = useState<string>("all");
  const [pago, setPago] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-v2", activeBranchId, range, origen, pago],
    enabled: !!activeBranchId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { start, end } = rangeFor(range);
      const [salesRes, expensesRes, purchasesRes, cashSessionsRes] = await Promise.all([
        supabase
          .from("sales")
          .select("id,total,created_at,payment_method,payment_details,source,status")
          .eq("branch_id", activeBranchId!)
          .gte("created_at", start).lt("created_at", end),
        supabase
          .from("expenses").select("amount,created_at")
          .eq("branch_id", activeBranchId!)
          .gte("created_at", start).lt("created_at", end),
        supabase
          .from("purchases").select("total,created_at")
          .eq("branch_id", activeBranchId!)
          .gte("created_at", start).lt("created_at", end),
        supabase
          .from("cash_sessions")
          .select("opening_amount,cash_counted,nequi_counted,bancolombia_counted,cash_expected,nequi_expected,bancolombia_expected,cash_difference,nequi_difference,bancolombia_difference,closed_at,status")
          .eq("branch_id", activeBranchId!)
          .eq("status", "closed")
          .gte("closed_at", start).lt("closed_at", end),
      ]);

      let sales = (salesRes.data ?? []).filter((s) => (s.status ?? "paid") !== "cancelled");
      if (origen !== "all") sales = sales.filter((s) => norm(s.source) === origen);
      if (pago !== "all")   sales = sales.filter((s) => norm(s.payment_method) === pago);

      const saleIds = sales.map((s) => s.id);
      const { data: items } = saleIds.length
        ? await supabase.from("sale_items").select("product_name,qty,subtotal,sale_id").in("sale_id", saleIds)
        : { data: [] as { product_name: string; qty: number; subtotal: number }[] };

      const productMap = new Map<string, { qty: number; total: number }>();
      (items ?? []).forEach((it) => {
        const cur = productMap.get(it.product_name) ?? { qty: 0, total: 0 };
        cur.qty += Number(it.qty);
        cur.total += Number(it.subtotal);
        productMap.set(it.product_name, cur);
      });
      const top = [...productMap.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.total - a.total).slice(0, 5);

      // Payment breakdown (considera pagos divididos en payment_details.splits[])
      const methodMap = new Map<string, number>();
      sales.forEach((s) => {
        const pd: any = (s as any).payment_details;
        const splits = pd && pd.split === true && Array.isArray(pd.splits) ? pd.splits : null;
        if (splits && splits.length) {
          splits.forEach((sp: any) => {
            const key = (sp.method ?? "otro").toString().trim() || "otro";
            methodMap.set(key, (methodMap.get(key) ?? 0) + Number(sp.amount ?? 0));
          });
        } else {
          const key = (s.payment_method ?? "otro").trim() || "otro";
          methodMap.set(key, (methodMap.get(key) ?? 0) + Number(s.total));
        }
      });
      const methods = [...methodMap.entries()]
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total);

      // Efectivo real (arqueo de cajas cerradas en el período)
      const cashSessions = cashSessionsRes.data ?? [];
      const realCash = {
        efectivo: cashSessions.reduce((a, c: any) => a + Number(c.cash_counted ?? 0), 0),
        nequi: cashSessions.reduce((a, c: any) => a + Number(c.nequi_counted ?? 0), 0),
        bancolombia: cashSessions.reduce((a, c: any) => a + Number(c.bancolombia_counted ?? 0), 0),
        efectivoEsperado: cashSessions.reduce((a, c: any) => a + Number(c.cash_expected ?? 0), 0),
        nequiEsperado: cashSessions.reduce((a, c: any) => a + Number(c.nequi_expected ?? 0), 0),
        bancolombiaEsperado: cashSessions.reduce((a, c: any) => a + Number(c.bancolombia_expected ?? 0), 0),
        diferenciaEfectivo: cashSessions.reduce((a, c: any) => a + Number(c.cash_difference ?? 0), 0),
        diferenciaNequi: cashSessions.reduce((a, c: any) => a + Number(c.nequi_difference ?? 0), 0),
        diferenciaBanco: cashSessions.reduce((a, c: any) => a + Number(c.bancolombia_difference ?? 0), 0),
        cajasCerradas: cashSessions.length,
      };

      // Hourly evolution (0..23)
      const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0 }));
      sales.forEach((s) => {
        const h = new Date(s.created_at).getHours();
        hourly[h].total += Number(s.total);
      });

      // Best day (across selected period)
      const dayMap = new Map<number, number>();
      sales.forEach((s) => {
        const dow = new Date(s.created_at).getDay();
        dayMap.set(dow, (dayMap.get(dow) ?? 0) + Number(s.total));
      });
      const bestDays = [...dayMap.entries()]
        .map(([dow, total]) => ({ dow, name: DAY_NAMES[dow], total }))
        .sort((a, b) => b.total - a.total).slice(0, 3);

      // Valley hours (only for "hoy"): hours between first and last sale with 0
      const activeHours = hourly.filter((h) => h.total > 0).map((h) => h.hour);
      const valleys: number[] = [];
      if (activeHours.length >= 2) {
        const first = Math.min(...activeHours);
        const last = Math.max(...activeHours);
        for (let h = first; h <= last; h++) if (hourly[h].total === 0) valleys.push(h);
      }

      const total = sales.reduce((a, s) => a + Number(s.total), 0);
      const txs = sales.length;
      const avg = txs ? total / txs : 0;
      const gastos =
        (expensesRes.data ?? []).reduce((a, e) => a + Number(e.amount ?? 0), 0) +
        (purchasesRes.data ?? []).reduce((a, p) => a + Number(p.total ?? 0), 0);
      const utilidad = total - gastos;
      const qtyVendida = (items ?? []).reduce((a, i) => a + Number(i.qty ?? 0), 0);

      return { total, txs, avg, gastos, utilidad, top, methods, hourly, bestDays, valleys, qtyVendida, realCash };
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
      {/* Hero — banner bienvenida (idéntico a diseño de referencia) */}
      <div className="relative w-full overflow-hidden rounded-2xl sm:rounded-3xl shadow-xl">
        <img
          src={welcomeBanner.url}
          alt={`Bienvenido ${activeBranch?.name ?? "Goloso"}`}
          className="block w-full h-auto"
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

      {/* Evolución */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 font-display text-lg">
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
          <CardTitle className="flex items-center gap-2 font-display text-lg">
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

      {/* Métodos de Pago */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="font-display text-lg">Métodos de Pago</CardTitle>
          <p className="text-xs text-muted-foreground">Ingresos por medio de pago · incluye pagos divididos</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.methods ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>
          )}
          {(() => {
            const totalMethods = (data?.methods ?? []).reduce((a, m) => a + m.total, 0);
            return (data?.methods ?? []).map((m) => {
              const pct = totalMethods > 0 ? (m.total / totalMethods) * 100 : 0;
              return (
                <div key={m.name} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${METHOD_COLORS[norm(m.name)] ?? "bg-slate-400"}`} />
                      <span className="uppercase text-sm">{m.name}</span>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm">{formatMoney(m.total)}</div>
                      <div className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${METHOD_COLORS[norm(m.name)] ?? "bg-slate-400"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            });
          })()}
          <div className="pt-3 border-t flex items-center justify-between text-xs">
            <span className="tracking-widest uppercase text-muted-foreground">Total ingresos</span>
            <span className="font-bold text-foreground">{formatMoney((data?.methods ?? []).reduce((a, m) => a + m.total, 0))}</span>
          </div>
        </CardContent>
      </Card>

      {/* Efectivo Real (arqueo de caja) */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-1">
          <CardTitle className="font-display text-lg">Efectivo Real · Arqueo</CardTitle>
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
          <CardTitle className="font-display text-lg">Mejores Días</CardTitle>
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
          <CardTitle className="font-display text-lg">Gastos vs Ingresos</CardTitle>
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
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
        {icon} {label}
      </div>
      {children}
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
