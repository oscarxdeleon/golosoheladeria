import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, subDays, startOfMonth } from "date-fns";
import {
  Coins, DollarSign, Receipt, TrendingUp, TrendingDown, ArrowDownLeft,
  ArrowUpRight, PiggyBank, HandCoins, Gift, Wallet, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/contexts/branch-context";
import { formatMoney } from "@/lib/format";
import {
  fetchSales, fetchExpenses, fetchPurchases, fetchCashSessions, computeFinancialSummary,
  CATEGORY_INCOME, CATEGORY_WITHDRAWAL, CATEGORY_REFUND, type ExpenseRow,
} from "@/lib/reports";
import { formatDate } from "@/lib/format";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/reportes/resumen")({
  head: () => ({ meta: [{ title: "Resumen Financiero · Reportes" }] }),
  component: ResumenPage,
});

type Preset = "hoy" | "ayer" | "7d" | "mes" | "custom";

function ResumenPage() {
  const queryClient = useQueryClient();
  const { branches, activeBranchId, setActiveBranchId } = useBranch();
  const [preset, setPreset] = useState<Preset>("hoy");
  const [customFrom, setCustomFrom] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState<string>(activeBranchId ?? "all");
  const [userId, setUserId] = useState<string>("all");
  const [sessionId, setSessionId] = useState<string>("all");

  useEffect(() => {
    if (activeBranchId) {
      setBranchId(activeBranchId);
      setSessionId("all");
    }
  }, [activeBranchId]);

  const handleBranchChange = (value: string) => {
    setBranchId(value);
    setSessionId("all");
    if (value !== "all") setActiveBranchId(value);
  };

  const range = useMemo(() => {
    const now = new Date();
    if (preset === "hoy") return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    if (preset === "ayer") {
      const y = subDays(now, 1);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
    }
    if (preset === "7d") return { from: startOfDay(subDays(now, 6)).toISOString(), to: endOfDay(now).toISOString() };
    if (preset === "mes") return { from: startOfMonth(now).toISOString(), to: endOfDay(now).toISOString() };
    return {
      from: startOfDay(new Date(customFrom)).toISOString(),
      to: endOfDay(new Date(customTo)).toISOString(),
    };
  }, [preset, customFrom, customTo]);

  const filters = useMemo(() => ({
    from: range.from,
    to: range.to,
    branchId: branchId === "all" ? null : branchId,
    userId: userId === "all" ? null : userId,
    cashSessionId: sessionId === "all" ? null : sessionId,
  }), [range, branchId, userId, sessionId]);

  useEffect(() => {
    if (!filters.branchId) return;
    const invalidateReports = () => {
      void queryClient.invalidateQueries({ queryKey: ["reportes.sales"] });
      void queryClient.invalidateQueries({ queryKey: ["reportes.expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["reportes.purchases"] });
      void queryClient.invalidateQueries({ queryKey: ["reportes.sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["reportes.session-options"] });
    };
    const channel = supabase
      .channel(`reports-summary-sync-${filters.branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${filters.branchId}` }, invalidateReports)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, invalidateReports)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `branch_id=eq.${filters.branchId}` }, invalidateReports)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_deposits", filter: `branch_id=eq.${filters.branchId}` }, invalidateReports)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases", filter: `branch_id=eq.${filters.branchId}` }, invalidateReports)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${filters.branchId}` }, invalidateReports)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [filters.branchId, queryClient]);

  const { data: sales = [] } = useQuery({
    queryKey: ["reportes.sales", filters],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: () => fetchSales(filters),
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["reportes.expenses", filters],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: () => fetchExpenses(filters),
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["reportes.purchases", filters],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: () => fetchPurchases(filters),
  });
  const { data: sessions = [] } = useQuery({
    queryKey: ["reportes.sessions", filters],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: () => fetchCashSessions(filters),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["reportes.users"],
    staleTime: 5 * 60_000,
    queryFn: async () => (await supabase.from("profiles").select("id,full_name").order("full_name")).data ?? [],
  });

  const { data: sessionOptions = [] } = useQuery({
    queryKey: ["reportes.session-options", filters.branchId],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      let q = supabase.from("cash_sessions").select("id,opened_at,user_name").order("opened_at", { ascending: false }).limit(50);
      if (filters.branchId) q = q.eq("branch_id", filters.branchId);
      return (await q).data ?? [];
    },
  });

  const summary = useMemo(() => computeFinancialSummary(sales, expenses, sessions, purchases), [sales, expenses, sessions, purchases]);

  const kpis: { label: string; value: string; icon: React.ElementType; gradient: string }[] = [
    { label: "Ventas totales", value: formatMoney(summary.salesTotal), icon: DollarSign, gradient: "from-emerald-500 to-teal-500" },
    { label: "Transacciones", value: String(summary.transactions), icon: Receipt, gradient: "from-sky-500 to-cyan-500" },
    { label: "Ticket promedio", value: formatMoney(summary.averageTicket), icon: TrendingUp, gradient: "from-indigo-500 to-blue-500" },
    { label: "Propinas", value: formatMoney(summary.tips), icon: HandCoins, gradient: "from-fuchsia-500 to-pink-500" },
    { label: "Entradas", value: formatMoney(summary.entries), icon: ArrowDownLeft, gradient: "from-lime-500 to-emerald-500" },
    { label: "Salidas", value: formatMoney(summary.exits), icon: ArrowUpRight, gradient: "from-orange-500 to-red-500" },
    { label: "Gastos", value: formatMoney(summary.expenses), icon: TrendingDown, gradient: "from-rose-500 to-red-500" },
    { label: "Retiros", value: formatMoney(summary.withdrawals), icon: PiggyBank, gradient: "from-amber-500 to-orange-500" },
    { label: "Devoluciones/Reembolsos", value: formatMoney(summary.refunds), icon: Coins, gradient: "from-slate-500 to-slate-700" },
    { label: "Cortesías", value: String(summary.courtesies), icon: Gift, gradient: "from-pink-500 to-rose-500" },
    { label: "Saldo neto", value: formatMoney(summary.netBalance), icon: Wallet, gradient: "from-emerald-600 to-green-700" },
    { label: "Efectivo esperado", value: formatMoney(summary.cashExpected), icon: DollarSign, gradient: "from-blue-500 to-indigo-600" },
    { label: "Valor declarado", value: formatMoney(summary.declared), icon: DollarSign, gradient: "from-violet-500 to-purple-600" },
    {
      label: "Diferencia",
      value: formatMoney(summary.difference),
      icon: summary.difference === 0 ? CheckCircle2 : AlertTriangle,
      gradient: summary.difference === 0 ? "from-emerald-500 to-green-600" : summary.difference > 0 ? "from-amber-500 to-orange-500" : "from-rose-500 to-red-600",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>Ajusta el rango, sede, usuario y turno.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Periodo</label>
            <div className="flex flex-wrap gap-1">
              {(["hoy", "ayer", "7d", "mes", "custom"] as Preset[]).map((p) => (
                <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => setPreset(p)}>
                  {p === "hoy" ? "Hoy" : p === "ayer" ? "Ayer" : p === "7d" ? "7 días" : p === "mes" ? "Mes" : "Rango"}
                </Button>
              ))}
            </div>
          </div>
          {preset === "custom" && (
            <>
              <div>
                <label className="text-xs text-muted-foreground">Desde</label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Hasta</label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <label className="text-xs text-muted-foreground">Sede</label>
            <Select value={branchId} onValueChange={handleBranchChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Usuario</label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(users as { id: string; full_name: string }[]).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Turno / Caja</label>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(sessionOptions as { id: string; opened_at: string; user_name: string }[]).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {new Date(s.opened_at).toLocaleString()} · {s.user_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className={`rounded-2xl bg-gradient-to-br ${k.gradient} p-[1px] shadow-md`}>
            <div className="rounded-2xl bg-background/95 p-4 h-full">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</div>
                <div className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br ${k.gradient} text-white shadow`}>
                  <k.icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2 font-display text-2xl font-extrabold tracking-tight">{k.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Detalle de gastos */}
      <ExpensesDetail expenses={expenses as ExpenseRow[]} totalExpenses={summary.expenses} />
    </div>
  );
}

function ExpensesDetail({ expenses, totalExpenses }: { expenses: ExpenseRow[]; totalExpenses: number }) {
  const [open, setOpen] = useState(true);
  const rows = useMemo(() => {
    const list = expenses.filter((e) => {
      const c = (e.category || "").toLowerCase();
      return !CATEGORY_INCOME.has(c) && !CATEGORY_WITHDRAWAL.has(c) && !CATEGORY_REFUND.has(c);
    });
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [expenses]);
  const total = useMemo(() => rows.reduce((a, e) => a + (Number(e.amount) || 0), 0), [rows]);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-rose-500" />
                Detalle de gastos
              </CardTitle>
              <CardDescription>
                {rows.length} {rows.length === 1 ? "gasto registrado" : "gastos registrados"} · Total {formatMoney(total || totalExpenses)}
              </CardDescription>
            </div>
            <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {rows.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                No hay gastos registrados en el periodo/turno seleccionado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="text-left py-2 px-2">Concepto</th>
                      <th className="text-left py-2 px-2">Descripción</th>
                      <th className="text-left py-2 px-2">Usuario</th>
                      <th className="text-left py-2 px-2">Método</th>
                      <th className="text-left py-2 px-2">Fecha</th>
                      <th className="text-right py-2 px-2">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2 px-2 font-medium">{e.category || "—"}</td>
                        <td className="py-2 px-2 text-muted-foreground">{e.description || "—"}</td>
                        <td className="py-2 px-2">{e.user_name || "—"}</td>
                        <td className="py-2 px-2 capitalize">{e.payment_method || "—"}</td>
                        <td className="py-2 px-2 whitespace-nowrap">{formatDate(e.created_at)}</td>
                        <td className="py-2 px-2 text-right font-semibold text-rose-600">
                          {formatMoney(Number(e.amount) || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2">
                      <td colSpan={5} className="py-2 px-2 text-right font-semibold">Total</td>
                      <td className="py-2 px-2 text-right font-extrabold text-rose-700">{formatMoney(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
