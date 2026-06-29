import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { DollarSign, Receipt, TrendingUp, Package } from "lucide-react";
import { useBranch } from "@/contexts/branch-context";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Goloso POS" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { activeBranchId, activeBranch } = useBranch();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["dashboard-today", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data: sales } = await supabase
        .from("sales")
        .select("id,total,user_name,created_at,branch_id")
        .eq("branch_id", activeBranchId!)
        .gte("created_at", start.toISOString());
      const saleIds = (sales ?? []).map((s) => s.id);
      const { data: items } = saleIds.length
        ? await supabase
            .from("sale_items")
            .select("product_name,qty,subtotal,sale_id")
            .in("sale_id", saleIds)
        : { data: [] as { product_name: string; qty: number; subtotal: number }[] };
      const top = new Map<string, { qty: number; total: number }>();
      (items ?? []).forEach((it: { product_name: string; qty: number; subtotal: number }) => {
        const cur = top.get(it.product_name) ?? { qty: 0, total: 0 };
        cur.qty += Number(it.qty);
        cur.total += Number(it.subtotal);
        top.set(it.product_name, cur);
      });
      const topList = Array.from(top.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
      return { sales: sales ?? [], topList };
    },
  });

  const sales = data?.sales ?? [];
  const total = sales.reduce((s, x) => s + Number(x.total), 0);
  const avg = sales.length ? total / sales.length : 0;
  const top = data?.topList ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Hola 👋</h1>
        <p className="text-muted-foreground">Resumen de hoy</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<DollarSign />} label="Ventas hoy" value={formatMoney(total)} />
        <StatCard icon={<Receipt />} label="Tickets" value={sales.length.toString()} />
        <StatCard icon={<TrendingUp />} label="Ticket promedio" value={formatMoney(avg)} />
        <StatCard icon={<Package />} label="Productos vendidos" value={top.reduce((s, x) => s + x.qty, 0).toString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Productos más vendidos hoy</CardTitle></CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay ventas hoy.</p>
            ) : (
              <ul className="space-y-2">
                {top.map((t) => (
                  <li key={t.name} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {t.qty} · {formatMoney(t.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Últimos tickets</CardTitle></CardHeader>
          <CardContent>
            {sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin movimientos.</p>
            ) : (
              <ul className="space-y-2">
                {sales.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-sm">
                    <span>{s.user_name ?? "—"}</span>
                    <span className="font-medium">{formatMoney(s.total)}</span>
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
    <Card>
      <CardContent className="flex items-center gap-3 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          {icon}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="font-display text-2xl">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
