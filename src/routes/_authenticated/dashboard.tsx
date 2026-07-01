import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { DollarSign, Receipt, TrendingUp, Package, Wallet, Smartphone, Landmark, ArrowDownCircle } from "lucide-react";
import { useBranch } from "@/contexts/branch-context";
import { Skeleton } from "@/components/ui/skeleton";

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

function normalize(method: string | null | undefined) {
  return (method ?? "").toLowerCase().trim();
}

function DashboardPage() {
  const { activeBranchId, activeBranch } = useBranch();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-today", activeBranchId],
    enabled: !!activeBranchId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const startIso = start.toISOString();

      const [salesRes, sessionsRes, expensesRes, purchasesRes] = await Promise.all([
        supabase
          .from("sales")
          .select("id,total,user_name,created_at,branch_id,payment_method,status")
          .eq("branch_id", activeBranchId!)
          .gte("created_at", startIso),
        supabase
          .from("cash_sessions")
          .select("id,opening_amount,opened_at,status,branch_id")
          .eq("branch_id", activeBranchId!)
          .gte("opened_at", startIso),
        supabase
          .from("expenses")
          .select("amount,payment_method,branch_id,created_at")
          .eq("branch_id", activeBranchId!)
          .gte("created_at", startIso),
        supabase
          .from("purchases")
          .select("total,payment_method,branch_id,created_at")
          .eq("branch_id", activeBranchId!)
          .gte("created_at", startIso),
      ]);

      const sales = (salesRes.data ?? []).filter((s) => (s.status ?? "completed") !== "cancelled");
      const saleIds = sales.map((s) => s.id);
      const { data: items } = saleIds.length
        ? await supabase.from("sale_items").select("product_name,qty,subtotal,sale_id").in("sale_id", saleIds)
        : { data: [] as { product_name: string; qty: number; subtotal: number }[] };

      const top = new Map<string, { qty: number; total: number }>();
      (items ?? []).forEach((it) => {
        const cur = top.get(it.product_name) ?? { qty: 0, total: 0 };
        cur.qty += Number(it.qty);
        cur.total += Number(it.subtotal);
        top.set(it.product_name, cur);
      });
      const topList = Array.from(top.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 5);

      const cashSales = sales.filter((s) => normalize(s.payment_method) === "efectivo").reduce((a, s) => a + Number(s.total), 0);
      const nequiSales = sales.filter((s) => normalize(s.payment_method) === "nequi").reduce((a, s) => a + Number(s.total), 0);
      const bancoSales = sales.filter((s) => normalize(s.payment_method) === "bancolombia").reduce((a, s) => a + Number(s.total), 0);

      const baseInicial = (sessionsRes.data ?? []).reduce((a, s) => a + Number(s.opening_amount ?? 0), 0);

      const cashOutExpenses = (expensesRes.data ?? [])
        .filter((e) => normalize(e.payment_method) === "efectivo")
        .reduce((a, e) => a + Number(e.amount ?? 0), 0);
      const cashOutPurchases = (purchasesRes.data ?? [])
        .filter((p) => normalize(p.payment_method) === "efectivo")
        .reduce((a, p) => a + Number(p.total ?? 0), 0);
      const cashOut = cashOutExpenses + cashOutPurchases;

      const cashNeto = baseInicial + cashSales - cashOut;

      return {
        sales,
        topList,
        cashSales,
        nequiSales,
        bancoSales,
        baseInicial,
        cashOut,
        cashNeto,
      };
    },
  });

  const sales = data?.sales ?? [];
  const total = sales.reduce((s, x) => s + Number(x.total), 0);
  const avg = sales.length ? total / sales.length : 0;
  const top = data?.topList ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl">Hola 👋</h1>
          <p className="text-muted-foreground">
            Resumen de <span className="font-semibold text-foreground">hoy</span> · <span className="font-medium text-foreground">{activeBranch?.name ?? "—"}</span>
          </p>
        </div>
      </div>

      {/* Métricas comerciales */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            <Skeleton className="h-[88px] rounded-2xl" />
            <Skeleton className="h-[88px] rounded-2xl" />
            <Skeleton className="h-[88px] rounded-2xl" />
            <Skeleton className="h-[88px] rounded-2xl" />
          </>
        ) : (
          <>
            <StatCard icon={<DollarSign />} label="Total facturado" value={formatMoney(total)} />
            <StatCard icon={<Receipt />} label="Pedidos realizados" value={sales.length.toString()} />
            <StatCard icon={<TrendingUp />} label="Ticket promedio" value={formatMoney(avg)} />
            <StatCard icon={<Package />} label="Productos vendidos" value={top.reduce((s, x) => s + x.qty, 0).toString()} />
          </>
        )}
      </div>

      {/* Cuadrante de caja y medios de pago */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide">
            <Wallet className="h-5 w-5 text-primary" /> Cuadrante de caja · medios de pago
          </CardTitle>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Saldos del turno/día actual · actualiza cada 30 s</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-3">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <CashBox
                  icon={<Wallet className="h-6 w-6" />}
                  label="Efectivo (neto en cajón)"
                  value={data?.cashNeto ?? 0}
                  accent="from-emerald-500/20 to-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                  ring="ring-emerald-500/30"
                  hint={`Base ${formatMoney(data?.baseInicial ?? 0)} + Ventas ${formatMoney(data?.cashSales ?? 0)} − Gastos ${formatMoney(data?.cashOut ?? 0)}`}
                />
                <CashBox
                  icon={<Smartphone className="h-6 w-6" />}
                  label="Nequi"
                  value={data?.nequiSales ?? 0}
                  accent="from-pink-500/20 to-pink-500/5 text-pink-700 dark:text-pink-300"
                  ring="ring-pink-500/30"
                  hint="Recaudo del día"
                />
                <CashBox
                  icon={<Landmark className="h-6 w-6" />}
                  label="Bancolombia"
                  value={data?.bancoSales ?? 0}
                  accent="from-amber-500/20 to-amber-500/5 text-amber-700 dark:text-amber-300"
                  ring="ring-amber-500/30"
                  hint="Recaudo del día"
                />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs">
                <MiniStat label="Base inicial" value={formatMoney(data?.baseInicial ?? 0)} />
                <MiniStat label="Ventas en efectivo" value={formatMoney(data?.cashSales ?? 0)} />
                <MiniStat
                  label="Salidas de efectivo (gastos+compras)"
                  value={formatMoney(data?.cashOut ?? 0)}
                  icon={<ArrowDownCircle className="h-3.5 w-3.5 text-destructive" />}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader><CardTitle>Productos más vendidos hoy</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32" /> : top.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay ventas hoy.</p>
            ) : (
              <ul className="space-y-2">
                {top.map((t) => (
                  <li key={t.name} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-sm text-muted-foreground">{t.qty} · {formatMoney(t.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader><CardTitle>Últimos tickets</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-32" /> : sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos.</p>
            ) : (
              <ul className="space-y-2">
                {sales.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-sm">
                    <span>{s.user_name ?? "—"}</span>
                    <span className="font-medium">{formatMoney(Number(s.total))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="flex items-center gap-3 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">{icon}</div>
        <div>
          <div className="font-display text-xs font-extrabold uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="font-display text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function CashBox({
  icon, label, value, accent, ring, hint,
}: { icon: React.ReactNode; label: string; value: number; accent: string; ring: string; hint?: string }) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${accent} p-5 shadow-sm ring-1 ${ring}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold opacity-80">{label}</span>
        <span className="opacity-80">{icon}</span>
      </div>
      <div className="mt-2 font-display text-3xl font-extrabold tracking-tight">
        {formatMoney(value)}
      </div>
      {hint && <div className="mt-2 text-[11px] font-medium opacity-70">{hint}</div>}
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-xl border bg-card px-3 py-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
