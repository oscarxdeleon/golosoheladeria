import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Download, Printer, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/format";
import {
  fetchExpenses, fetchPurchases, fetchSaleItemsForSales, fetchSales,
  type CashSessionRow,
} from "@/lib/reports";
import { downloadShiftPdf } from "@/lib/shift-pdf";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reportes/cajas_/$id")({
  head: () => ({ meta: [{ title: "Detalle de arqueo · Reportes" }] }),
  component: CajaDetailPage,
});

/* ---------------- Types (RPC payload) ---------------- */

type MethodStat = { amount: number; count: number };
type ServiceStat = { amount: number; count: number };
type ProductRow = { name: string; qty: number; total: number };
type AdjustRow = {
  id: string;
  kind: "entrada" | "salida" | "devolucion";
  amount: number;
  category: string | null;
  description: string | null;
  method: string | null;
  user_name: string | null;
  created_at: string;
};
type DepositRow = {
  id: string;
  amount: number;
  description: string;
  method: string;
  user_name: string | null;
  status: string;
  created_at: string;
};

type SessionDetail = {
  session: {
    id: string;
    branch_id: string | null;
    branch_name: string | null;
    opened_at: string;
    closed_at: string | null;
    opening_amount: number | null;
    counted_amount: number | null;
    expected_amount: number | null;
    difference: number | null;
    user_name: string | null;
    status: string;
    opening_notes: string | null;
    closing_notes: string | null;
  };
  summary: {
    total_sales: number;
    order_count: number;
    avg_ticket: number;
    cancelled_count: number;
    cancelled_value: number;
    cash_sales: number;
    entries_cash: number;
    expenses_cash: number;
    purchases_cash: number;
    opening_amount: number;
    expected_cash: number;
    counted_amount: number;
    difference: number;
    nequi_counted: number;
    bancolombia_counted: number;
  };
  payments: Record<string, MethodStat>;
  services: Record<string, ServiceStat>;
  products: ProductRow[];
  entradas: AdjustRow[];
  salidas: AdjustRow[];
  devoluciones: AdjustRow[];
  deposits: DepositRow[];
};

type CancelledSaleRow = {
  id: string;
  ticket_number: number;
  order_type: string;
  total: number;
  payment_method: string | null;
  customer_name: string | null;
  user_name: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancellation_reason: string | null;
  cancellation_previous_status: string | null;
  table_id: string | null;
};

/* ---------------- Style maps ---------------- */

const METHOD_DOT: Record<string, string> = {
  efectivo: "bg-blue-500",
  nequi: "bg-fuchsia-500",
  bancolombia: "bg-slate-400",
  tarjeta: "bg-violet-500",
  transferencia: "bg-emerald-500",
  mixto: "bg-amber-500",
  otros: "bg-slate-400",
};

const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  bancolombia: "Bancolombia",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  mixto: "Pago Mixto",
  otros: "Otros",
};

const SERVICE_STYLE: Record<string, { emoji: string; label: string; bg: string; text: string; badgeBg: string; badgeText: string }> = {
  mesa:      { emoji: "🪑", label: "Mesa",       bg: "bg-blue-50 border-blue-100",     text: "text-blue-700",   badgeBg: "bg-emerald-100", badgeText: "text-emerald-700" },
  domicilio: { emoji: "🛵", label: "Domicilio",  bg: "bg-orange-50 border-orange-100", text: "text-orange-700", badgeBg: "bg-emerald-100", badgeText: "text-emerald-700" },
  llevar:    { emoji: "🥡", label: "Para Llevar",bg: "bg-purple-50 border-purple-100", text: "text-purple-700", badgeBg: "bg-emerald-100", badgeText: "text-emerald-700" },
  kiosko:    { emoji: "🖥️", label: "Kiosko",     bg: "bg-teal-50 border-teal-100",     text: "text-teal-700",   badgeBg: "bg-emerald-100", badgeText: "text-emerald-700" },
};

function normalizeService(k: string): keyof typeof SERVICE_STYLE {
  const s = k.toLowerCase();
  if (s.includes("mesa") || s === "dine_in") return "mesa";
  if (s.includes("domic") || s === "delivery") return "domicilio";
  if (s.includes("llevar") || s === "takeaway" || s === "to_go") return "llevar";
  if (s.includes("kiosko") || s.includes("kiosk")) return "kiosko";
  return "mesa";
}

/* ---------------- Page ---------------- */

function CajaDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { branches, activeBranchId, setActiveBranchId, loading: branchesLoading } = useBranch();
  const { isAdmin, roles, rolesLoading } = useAuth();
  const canSeeAllBranches = isAdmin || roles.includes("supervisor");
  const [downloading, setDownloading] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["reportes.session.detail", id],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_cash_session_detail_rpc", { _cash_session_id: id });
      if (error) throw error;
      return data as unknown as SessionDetail | null;
    },
  });

  const sessionBranchId = detail?.session.branch_id ?? null;

  const { data: cancelledSales = [] } = useQuery({
    queryKey: ["reportes.session.cancelled", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,ticket_number,order_type,total,payment_method,customer_name,user_name,created_at,cancelled_at,cancelled_by_name,cancellation_reason,cancellation_previous_status,table_id")
        .eq("cash_session_id", id)
        .eq("status", "cancelled")
        .order("cancelled_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CancelledSaleRow[];
    },
  });

  useEffect(() => {
    if (!sessionBranchId) return;
    const invalidateDetail = () => {
      void queryClient.invalidateQueries({ queryKey: ["reportes.session.detail", id] });
      void queryClient.invalidateQueries({ queryKey: ["reportes.cajas.rpc"] });
    };
    const channel = supabase
      .channel(`cash-detail-sync-${sessionBranchId}-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${sessionBranchId}` }, invalidateDetail)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${sessionBranchId}` }, invalidateDetail)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, invalidateDetail)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `branch_id=eq.${sessionBranchId}` }, invalidateDetail)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_deposits", filter: `branch_id=eq.${sessionBranchId}` }, invalidateDetail)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases", filter: `branch_id=eq.${sessionBranchId}` }, invalidateDetail)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, sessionBranchId, queryClient]);

  useEffect(() => {
    if (rolesLoading) return;
    if (canSeeAllBranches) return;
    if (!detail || !activeBranchId || sessionBranchId === activeBranchId) return;
    void navigate({ to: "/reportes/cajas", replace: true });
  }, [rolesLoading, canSeeAllBranches, detail, sessionBranchId, activeBranchId, navigate]);

  const visible = detail && (canSeeAllBranches || sessionBranchId === activeBranchId) ? detail : null;

  if (isLoading || branchesLoading || rolesLoading || !detail) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card><CardContent className="py-10 text-center text-muted-foreground">{isLoading || branchesLoading || rolesLoading ? "Cargando…" : "Cierre no encontrado."}</CardContent></Card>
      </div>
    );
  }

  if (!visible) {
    const sessionBranch = detail.session.branch_name ?? branches.find((b) => b.id === sessionBranchId)?.name ?? "otra sede";
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <div className="text-lg font-bold">Este arqueo pertenece a {sessionBranch}</div>
            <p className="text-sm text-muted-foreground">
              La sede activa no coincide con el cierre seleccionado. Cambia a la sede del arqueo o vuelve al historial.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              {sessionBranchId && (
                <Button onClick={() => setActiveBranchId(sessionBranchId)} className="rounded-xl font-semibold">
                  Cambiar a {sessionBranch}
                </Button>
              )}
              <Button variant="outline" onClick={() => navigate({ to: "/reportes/cajas" })} className="rounded-xl font-semibold">
                Volver al historial
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const s = visible.session;
  const summary = visible.summary;
  const payments = visible.payments ?? {};
  const services = visible.services ?? {};
  const products = visible.products ?? [];
  const branchName = s.branch_name ?? "—";

  const apertura = Number(summary.opening_amount) || 0;
  const cashSales = Number(summary.cash_sales) || 0;
  const entries = Number(summary.entries_cash) || 0;
  const exits = (Number(summary.expenses_cash) || 0) + (Number(summary.purchases_cash) || 0);
  const expected = Number(summary.expected_cash) || 0;
  const declared = Number(summary.counted_amount) || 0;
  const diff = Number(summary.difference) || 0;

  const declaredNonCash: { key: string; label: string; amount: number }[] = [];
  if (summary.nequi_counted > 0) declaredNonCash.push({ key: "nequi", label: "NEQUI", amount: summary.nequi_counted });
  if (summary.bancolombia_counted > 0) declaredNonCash.push({ key: "bancolombia", label: "BANCOLOMBIA", amount: summary.bancolombia_counted });
  const totalDeclarado = declaredNonCash.reduce((a, x) => a + x.amount, 0);

  const activeDeposits = (visible.deposits ?? []).filter((d) => d.status === "active");
  const entradas = visible.entradas ?? [];
  const salidas = visible.salidas ?? [];
  const devoluciones = visible.devoluciones ?? [];

  const totalSalesByPayments = Object.values(payments).reduce((a, v) => a + v.amount, 0);
  const totalTx = Object.values(payments).reduce((a, v) => a + v.count, 0);
  const turnNumber = s.id.slice(0, 3).toUpperCase();

  async function handlePdf() {
    setDownloading(true);
    try {
      // Datos crudos on-demand SOLO para PDF
      const [rawSales, rawExpenses, rawPurchases] = await Promise.all([
        fetchSales({ cashSessionId: s.id }),
        fetchExpenses({ cashSessionId: s.id, branchId: s.branch_id }),
        fetchPurchases({ cashSessionId: s.id, branchId: s.branch_id }),
      ]);
      const ids = rawSales.filter((x) => x.status !== "cancelled").map((x) => x.id);
      const items = ids.length ? await fetchSaleItemsForSales(ids) : [];
      const fullSession = {
        ...s,
        nequi_counted: summary.nequi_counted,
        bancolombia_counted: summary.bancolombia_counted,
      } as unknown as CashSessionRow;
      await downloadShiftPdf({ session: fullSession, branchName, turnNumber, sales: rawSales, items, expenses: rawExpenses, purchases: rawPurchases });
      toast.success("PDF generado");
    } catch (e) {
      toast.error("No se pudo generar el PDF", { description: (e as Error).message });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-10">
      {/* Header */}
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-b from-primary/5 to-background p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-extrabold leading-tight">Detalle de Arqueo <span className="text-primary">#{turnNumber}</span></h2>
                <p className="text-sm text-muted-foreground">Sesión de {s.user_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{branchName} · {format(new Date(s.opened_at), "dd/MM/yyyy HH:mm")}{s.closed_at ? ` – ${format(new Date(s.closed_at), "HH:mm")}` : " · abierto"}</p>
              </div>
            </div>
            <Link to="/reportes/cajas">
              <Button variant="ghost" size="icon" className="rounded-full bg-muted/60 hover:bg-muted">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={handlePdf} disabled={downloading} variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 gap-2 font-bold">
              <Download className="h-4 w-4" />{downloading ? "Generando…" : "PDF"}
            </Button>
            <Button onClick={() => window.print()} variant="outline" className="border-rose-300 bg-white text-rose-600 hover:bg-rose-50 hover:text-rose-700 gap-2 font-bold flex-1">
              <Printer className="h-4 w-4" /> Imprimir Reporte
            </Button>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="resumen" className="space-y-5">
        <TabsList className="grid w-full grid-cols-4 rounded-2xl bg-muted/50 p-1 h-auto">
          <TabsTrigger value="resumen" className="rounded-xl data-[state=active]:bg-background data-[state=active]:shadow font-semibold">Resumen</TabsTrigger>
          <TabsTrigger value="productos" className="rounded-xl data-[state=active]:bg-background data-[state=active]:shadow font-semibold">Productos</TabsTrigger>
          <TabsTrigger value="ajustes" className="rounded-xl data-[state=active]:bg-background data-[state=active]:shadow font-semibold">Ajustes</TabsTrigger>
          <TabsTrigger value="anulados" className="rounded-xl data-[state=active]:bg-background data-[state=active]:shadow font-semibold">
            Anulados {cancelledSales.length > 0 && <span className="ml-1 rounded-full bg-destructive/15 px-1.5 text-[10px] text-destructive">{cancelledSales.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* -------- RESUMEN -------- */}
        <TabsContent value="resumen" className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Pedidos" value={String(summary.order_count)} tone="slate" />
            <KpiTile label="Ventas totales" value={formatMoney(summary.total_sales)} tone="emerald" />
            <KpiTile label="Ticket promedio" value={formatMoney(summary.avg_ticket)} tone="blue" />
            <KpiTile label="Anulados" value={String(summary.cancelled_count)} sub={formatMoney(summary.cancelled_value ?? 0)} tone="amber" />
          </div>

          <Section emoji="💳" title="VENTAS POR MÉTODO DE PAGO">
            <div className="space-y-2">
              {Object.entries(payments).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${METHOD_DOT[k] ?? "bg-slate-400"}`} />
                    <span className="font-bold uppercase tracking-wide text-sm">{METHOD_LABEL[k] ?? k}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{v.count} ventas</span>
                  </div>
                  <div className={`font-display text-lg font-extrabold ${v.amount > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>{formatMoney(v.amount)}</div>
                </div>
              ))}
              {Object.keys(payments).length === 0 && <EmptyRow label="Sin ventas registradas." />}
              <div className="flex items-center justify-between border-t border-dashed pt-3 mt-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold">Total Ventas</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{totalTx} transacciones</span>
                </div>
                <div className="font-display text-lg font-extrabold text-emerald-700">{formatMoney(totalSalesByPayments)}</div>
              </div>
            </div>
          </Section>

          <Section emoji="🧾" title="DECLARADO POR EL CAJERO (POR MEDIO)">
            <div className="space-y-2">
              {declaredNonCash.map((m) => (
                <div key={m.key} className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3">
                  <span className="font-bold tracking-wide">{m.label}</span>
                  <span className="font-display text-lg font-extrabold">{formatMoney(m.amount)}</span>
                </div>
              ))}
              {declaredNonCash.length === 0 && <EmptyRow label="Sin declaraciones adicionales." />}
              <div className="flex items-center justify-between border-t border-dashed pt-3 mt-1">
                <span className="font-bold">Total declarado</span>
                <span className="font-display text-lg font-extrabold">{formatMoney(totalDeclarado)}</span>
              </div>
            </div>
          </Section>

          <Section emoji="🍽️" title="VENTAS POR TIPO DE SERVICIO">
            <div className="space-y-3">
              {Object.entries(services).map(([k, v]) => {
                const st = SERVICE_STYLE[normalizeService(k)];
                return (
                  <div key={k} className={`rounded-2xl border px-4 py-3 ${st.bg}`}>
                    <div className="flex items-center justify-between">
                      <div className={`flex items-center gap-2 font-bold text-base ${st.text}`}>
                        <span className="text-xl leading-none">{st.emoji}</span>{st.label}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${st.badgeBg} ${st.badgeText}`}>{v.count} pedidos</span>
                    </div>
                    <div className={`mt-1 font-display text-2xl font-extrabold ${st.text}`}>{formatMoney(v.amount)}</div>
                  </div>
                );
              })}
              {Object.keys(services).length === 0 && <EmptyRow label="Sin ventas por servicio." />}
            </div>
          </Section>

          <Section emoji="💵" title="BALANCE DE EFECTIVO EN CAJA">
            <div className="space-y-2.5 px-1 text-[15px]">
              <BalanceLine label="Apertura de caja" value={formatMoney(apertura)} />
              <BalanceLine label="+ Ventas en efectivo" value={formatMoney(cashSales)} tone="blue" />
              <BalanceLine label="+ Entradas de efectivo" value={formatMoney(entries)} tone="emerald" />
              <BalanceLine label="- Salidas / Retiros" value={`-${formatMoney(exits)}`} tone="rose" />
              <div className="my-2 border-t border-dashed" />
              <div className="flex items-center justify-between font-bold">
                <span>= Efectivo Esperado</span>
                <span className="font-display text-2xl text-rose-600">{formatMoney(expected)}</span>
              </div>
            </div>
          </Section>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Esperado</div>
                <div className="mt-1 font-display text-xl font-extrabold text-rose-600 whitespace-nowrap">{formatMoney(expected)}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Declarado</div>
                <div className="mt-1 font-display text-xl font-extrabold text-foreground whitespace-nowrap">{formatMoney(declared)}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Diferencia</div>
                <div className={`mt-1 font-display text-xl font-extrabold whitespace-nowrap ${diff === 0 ? "text-emerald-700" : diff > 0 ? "text-blue-600" : "text-rose-600"}`}>
                  {diff > 0 ? "+" : ""}{formatMoney(diff)}
                </div>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${diff === 0 ? "bg-emerald-100 text-emerald-700" : diff > 0 ? "bg-white text-blue-600 ring-1 ring-blue-200" : "bg-white text-rose-600 ring-1 ring-rose-200"}`}>
                {diff === 0 ? "✅ Cuadró" : diff > 0 ? (<><TrendingUp className="h-3.5 w-3.5" /> Sobrante</>) : (<><TrendingDown className="h-3.5 w-3.5" /> Faltante</>)}
              </span>
            </div>
          </div>
        </TabsContent>

        {/* -------- PRODUCTOS -------- */}
        <TabsContent value="productos">
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-3 items-center">
                <div className="text-sm font-semibold text-muted-foreground">Producto</div>
                <div className="text-sm font-semibold text-muted-foreground text-right">Cant.</div>
                <div className="text-sm font-semibold text-muted-foreground text-right">Total</div>
                {products.map((p, i) => (
                  <div key={p.name + i} className="contents">
                    <div className="col-span-3 border-t" />
                    <div className="flex items-start gap-2 py-2">
                      <span className="mt-0.5 text-muted-foreground">📦</span>
                      <span className="font-medium uppercase text-sm leading-snug">{p.name}</span>
                    </div>
                    <div className="text-right py-2 font-medium">{p.qty}</div>
                    <div className="text-right py-2 font-display font-bold text-emerald-700 whitespace-nowrap">{formatMoney(p.total)}</div>
                  </div>
                ))}
                {products.length === 0 && (
                  <div className="col-span-3 py-6 text-center text-sm text-muted-foreground">Sin productos vendidos.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------- AJUSTES -------- */}
        <TabsContent value="ajustes" className="space-y-6">
          <div className="space-y-2">
            <div className="text-sm font-extrabold uppercase tracking-wider text-emerald-700">ENTRADAS O DEPÓSITOS</div>
            <Card className="rounded-2xl">
              <CardContent className="p-4">
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2">
                  <div className="text-sm font-semibold text-muted-foreground">Descripción</div>
                  <div className="text-sm font-semibold text-muted-foreground text-right">Medio</div>
                  <div className="text-sm font-semibold text-muted-foreground text-right">Monto</div>
                  {activeDeposits.map((d) => (
                    <div key={d.id} className="contents">
                      <div className="col-span-3 border-t" />
                      <div className="py-2 text-sm">
                        <div className="font-medium">{d.description}</div>
                        <div className="text-[11px] text-muted-foreground">{format(new Date(d.created_at), "dd/MM HH:mm")} · {d.user_name ?? "—"}</div>
                      </div>
                      <div className="py-2 text-right text-xs capitalize text-muted-foreground">{d.method}</div>
                      <div className="py-2 text-right font-display font-bold text-emerald-700 whitespace-nowrap">+{formatMoney(d.amount)}</div>
                    </div>
                  ))}
                  {activeDeposits.length === 0 && (
                    <div className="col-span-3 py-4 text-center text-sm text-muted-foreground">Sin depósitos en el turno.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          <AjusteBlock title="ENTRADAS EXTRAS (por categoría de gasto)" tone="emerald" rows={entradas} sign="+" />
          <AjusteBlock title="SALIDAS / GASTOS" tone="rose" rows={salidas} sign="-" />
          <AjusteBlock title="DEVOLUCIONES / REEMBOLSOS" tone="amber" rows={devoluciones} sign="-" />
        </TabsContent>

        {/* -------- ANULADOS -------- */}
        <TabsContent value="anulados" className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Pedidos anulados" value={String(cancelledSales.length)} tone="amber" />
            <KpiTile
              label="Valor anulado (informativo)"
              value={formatMoney(cancelledSales.reduce((s, r) => s + Number(r.total ?? 0), 0))}
              tone="amber"
            />
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
            ⚠️ Los pedidos anulados <b>no</b> se suman a ventas ni a caja. Este listado es únicamente informativo para auditoría.
          </div>

          <Card className="rounded-2xl">
            <CardContent className="p-0">
              <div className="divide-y">
                <div className="hidden md:grid grid-cols-[80px_1fr_1fr_1fr_120px] gap-3 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <div>Ticket</div><div>Servicio / Cliente</div><div>Cajero → Anuló</div><div>Motivo</div><div className="text-right">Valor</div>
                </div>
                {cancelledSales.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">Sin pedidos anulados en este turno.</div>
                )}
                {cancelledSales.map((c) => {
                  const wasPaid = c.cancellation_previous_status === "paid";
                  return (
                    <div key={c.id} className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_1fr_120px] gap-2 md:gap-3 px-4 py-3 text-sm">
                      <div className="font-mono font-bold text-rose-600">#{c.ticket_number}</div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="capitalize">{c.order_type}</Badge>
                          {wasPaid && <Badge variant="destructive" className="text-[10px]">Requiere reversión</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {c.customer_name ?? "Cliente POS"} · {c.cancelled_at ? format(new Date(c.cancelled_at), "dd/MM HH:mm") : "—"}
                        </div>
                      </div>
                      <div className="text-xs">
                        <div className="text-muted-foreground">Registró: <span className="text-foreground">{c.user_name ?? "—"}</span></div>
                        <div className="text-muted-foreground">Anuló: <span className="text-foreground font-medium">{c.cancelled_by_name ?? "—"}</span></div>
                      </div>
                      <div className="text-xs italic text-muted-foreground line-clamp-2">
                        “{c.cancellation_reason ?? "—"}”
                      </div>
                      <div className={`text-right font-display font-bold whitespace-nowrap ${wasPaid ? "text-rose-600" : "text-muted-foreground line-through"}`}>
                        {formatMoney(c.total)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

const KPI_TONE: Record<string, { bg: string; label: string; value: string }> = {
  slate:   { bg: "bg-muted/40 border-muted",         label: "text-muted-foreground", value: "text-foreground" },
  emerald: { bg: "bg-emerald-50 border-emerald-100", label: "text-emerald-800/70",   value: "text-emerald-700" },
  blue:    { bg: "bg-blue-50 border-blue-100",       label: "text-blue-800/70",      value: "text-blue-700" },
  amber:   { bg: "bg-amber-50 border-amber-100",     label: "text-amber-800/70",     value: "text-amber-700" },
};

function KpiTile({ label, value, tone, sub }: { label: string; value: string; tone: keyof typeof KPI_TONE; sub?: string }) {
  const t = KPI_TONE[tone];
  return (
    <div className={`rounded-2xl border px-4 py-4 text-center ${t.bg}`}>
      <div className={`text-[11px] font-bold uppercase tracking-widest ${t.label}`}>{label}</div>
      <div className={`mt-1.5 font-display text-2xl font-extrabold ${t.value}`}>{value}</div>
      {sub && <div className={`mt-0.5 text-[11px] font-semibold ${t.value} opacity-80`}>{sub}</div>}
    </div>
  );
}

function Section({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        <span className="text-base">{emoji}</span>{title}
      </div>
      {children}
    </div>
  );
}

function BalanceLine({ label, value, tone }: { label: string; value: string; tone?: "blue" | "emerald" | "rose" }) {
  const c = tone === "blue" ? "text-blue-700" : tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-display font-bold ${c}`}>{value}</span>
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <div className="rounded-2xl bg-muted/30 px-4 py-4 text-center text-sm text-muted-foreground">{label}</div>;
}

const TONE_HEADING: Record<string, string> = {
  emerald: "text-emerald-700",
  rose: "text-rose-600",
  amber: "text-amber-600",
};

function AjusteBlock({ title, rows, tone, sign }: { title: string; rows: AdjustRow[]; tone: keyof typeof TONE_HEADING; sign: "+" | "-" }) {
  const total = rows.reduce((a, r) => a + Number(r.amount ?? 0), 0);
  return (
    <div className="space-y-2">
      <div className={`text-sm font-extrabold uppercase tracking-wider ${TONE_HEADING[tone]}`}>{title}</div>
      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
            <div className="text-sm font-semibold text-muted-foreground">Descripción</div>
            <div className="text-sm font-semibold text-muted-foreground text-right">Monto</div>
            {rows.map((r) => (
              <div key={r.id} className="contents">
                <div className="col-span-2 border-t" />
                <div className="py-2 text-sm">{r.description || r.category}</div>
                <div className={`py-2 text-right font-display font-bold whitespace-nowrap ${sign === "+" ? "text-emerald-700" : "text-rose-600"}`}>
                  {sign}{formatMoney(Math.abs(Number(r.amount ?? 0)))}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="col-span-2 py-4 text-center text-sm text-muted-foreground">Sin movimientos.</div>
            )}
            {rows.length > 0 && (
              <>
                <div className="col-span-2 border-t border-dashed" />
                <div className="py-2 text-sm font-bold">Total</div>
                <div className={`py-2 text-right font-display font-extrabold ${sign === "+" ? "text-emerald-700" : "text-rose-600"}`}>
                  {sign}{formatMoney(total)}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
