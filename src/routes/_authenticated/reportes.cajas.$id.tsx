import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft, Download, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { formatMoney } from "@/lib/format";
import {
  aggregateProducts, computeFinancialSummary, fetchExpenses, fetchSaleItemsForSales,
  fetchSales, paymentBreakdown, serviceBreakdown, courtesiesFromItems,
  CATEGORY_INCOME, CATEGORY_WITHDRAWAL, CATEGORY_REFUND,
  type CashSessionRow,
} from "@/lib/reports";
import { downloadShiftPdf } from "@/lib/shift-pdf";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reportes/cajas/$id")({
  head: () => ({ meta: [{ title: "Detalle de cierre · Reportes" }] }),
  component: CajaDetailPage,
});

function CajaDetailPage() {
  const { id } = Route.useParams();
  const { branches } = useBranch();
  const [downloading, setDownloading] = useState(false);

  const { data: session, isLoading } = useQuery({
    queryKey: ["reportes.session", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("cash_sessions").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as CashSessionRow | null;
    },
  });

  const filters = useMemo(() => session ? {
    cashSessionId: session.id,
    branchId: session.branch_id,
  } : null, [session]);

  const { data: sales = [] } = useQuery({
    queryKey: ["reportes.session.sales", id],
    enabled: !!filters,
    queryFn: () => fetchSales(filters!),
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["reportes.session.expenses", id],
    enabled: !!filters,
    queryFn: () => fetchExpenses(filters!),
  });
  const saleIds = useMemo(() => sales.filter((s) => s.status !== "cancelled").map((s) => s.id), [sales]);
  const { data: items = [] } = useQuery({
    queryKey: ["reportes.session.items", id, saleIds.length],
    enabled: saleIds.length > 0,
    queryFn: () => fetchSaleItemsForSales(saleIds),
  });

  const branchName = branches.find((b) => b.id === session?.branch_id)?.name ?? "—";

  if (isLoading) return <Card><CardContent className="py-10 text-center text-muted-foreground">Cargando…</CardContent></Card>;
  if (!session) return <Card><CardContent className="py-10 text-center text-muted-foreground">Cierre no encontrado.</CardContent></Card>;

  const summary = computeFinancialSummary(sales, expenses, [session]);
  const payments = paymentBreakdown(sales);
  const services = serviceBreakdown(sales);
  const products = aggregateProducts(items);
  const courtesies = courtesiesFromItems(items);

  const durationMin = session.closed_at
    ? Math.round((new Date(session.closed_at).getTime() - new Date(session.opened_at).getTime()) / 60000)
    : Math.round((Date.now() - new Date(session.opened_at).getTime()) / 60000);

  const cashSales = payments["efectivo"]?.amount ?? 0;
  const entries = summary.entries;
  const exits = summary.exits;
  const expensesAmt = summary.expenses;
  const refunds = summary.refunds;
  const apertura = Number(session.opening_amount) || 0;
  const efectivoEsperado = apertura + cashSales + entries - exits - expensesAmt - refunds;

  const declared = Number(session.counted_amount) || 0;
  const expected = Number(session.expected_amount) || efectivoEsperado;
  const diff = declared - expected;

  const entradas = expenses.filter((e) => CATEGORY_INCOME.has((e.category ?? "").toLowerCase()));
  const salidas = expenses.filter((e) => CATEGORY_WITHDRAWAL.has((e.category ?? "").toLowerCase()));
  const devoluciones = expenses.filter((e) => CATEGORY_REFUND.has((e.category ?? "").toLowerCase()));
  const gastos = expenses.filter((e) => {
    const c = (e.category ?? "").toLowerCase();
    return !CATEGORY_INCOME.has(c) && !CATEGORY_WITHDRAWAL.has(c) && !CATEGORY_REFUND.has(c);
  });

  const declaredByMethod: { key: string; declared: number; expected: number }[] = [
    { key: "efectivo", declared: Number(session.cash_counted ?? 0), expected: Number(session.cash_expected ?? 0) },
    { key: "nequi", declared: Number(session.nequi_counted ?? 0), expected: Number(session.nequi_expected ?? 0) },
    { key: "bancolombia", declared: Number(session.bancolombia_counted ?? 0), expected: Number(session.bancolombia_expected ?? 0) },
  ];

  async function handlePdf() {
    setDownloading(true);
    try {
      await downloadShiftPdf({
        session: session!,
        branchName,
        turnNumber: session!.id.slice(0, 8),
        sales,
        items,
        expenses,
      });
      toast.success("PDF generado");
    } catch (e) {
      toast.error("No se pudo generar el PDF", { description: (e as Error).message });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary/15 via-background to-secondary/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link to="/reportes/cajas"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-primary">Cierre de caja</div>
                <h2 className="font-display text-2xl font-extrabold">{branchName}</h2>
                <div className="text-sm text-muted-foreground">
                  {format(new Date(session.opened_at), "dd/MM/yyyy HH:mm")} — {session.closed_at ? format(new Date(session.closed_at), "dd/MM/yyyy HH:mm") : "Turno abierto"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={session.status === "open" ? "outline" : "secondary"}>{session.status === "open" ? "Abierto" : "Cerrado"}</Badge>
              <Button onClick={handlePdf} disabled={downloading} className="gap-2">
                <Download className="h-4 w-4" />{downloading ? "Generando…" : "Descargar PDF"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="resumen" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="pagos">Medios de pago</TabsTrigger>
          <TabsTrigger value="declarado">Declarado</TabsTrigger>
          <TabsTrigger value="servicio">Tipo de servicio</TabsTrigger>
          <TabsTrigger value="balance">Balance efectivo</TabsTrigger>
          <TabsTrigger value="productos">Productos</TabsTrigger>
          <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPI label="N° pedidos" value={String(summary.transactions)} />
            <KPI label="Ventas totales" value={formatMoney(summary.salesTotal)} />
            <KPI label="Ticket promedio" value={formatMoney(summary.averageTicket)} />
            <KPI label="Pedidos cancelados" value={`${summary.cancelled} (${formatMoney(summary.cancelledValue)})`} />
            <KPI label="Cortesías" value={`${courtesies.count} items`} />
            <KPI label="Propinas" value={formatMoney(summary.tips)} />
            <KPI label="Duración del turno" value={`${Math.floor(durationMin / 60)}h ${durationMin % 60}m`} />
            <KPI label="Usuario apertura / cierre" value={session.user_name ?? "—"} />
          </div>
        </TabsContent>

        <TabsContent value="pagos">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Medio de pago</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right"># transacciones</TableHead></TableRow></TableHeader>
                <TableBody>
                  {Object.entries(payments).map(([k, v]) => (
                    <TableRow key={k}><TableCell className="uppercase font-medium">{k}</TableCell><TableCell className="text-right">{formatMoney(v.amount)}</TableCell><TableCell className="text-right">{v.count}</TableCell></TableRow>
                  ))}
                  {Object.keys(payments).length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Sin ventas.</TableCell></TableRow>}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right">{formatMoney(Object.values(payments).reduce((a, v) => a + v.amount, 0))}</TableCell>
                    <TableCell className="text-right">{Object.values(payments).reduce((a, v) => a + v.count, 0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="declarado">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Medio</TableHead><TableHead className="text-right">Esperado</TableHead><TableHead className="text-right">Declarado</TableHead><TableHead className="text-right">Diferencia</TableHead></TableRow></TableHeader>
                <TableBody>
                  {declaredByMethod.map((m) => {
                    const d = m.declared - m.expected;
                    return (
                      <TableRow key={m.key}>
                        <TableCell className="uppercase font-medium">{m.key}</TableCell>
                        <TableCell className="text-right">{formatMoney(m.expected)}</TableCell>
                        <TableCell className="text-right">{formatMoney(m.declared)}</TableCell>
                        <TableCell className={`text-right font-semibold ${d === 0 ? "text-emerald-600" : d > 0 ? "text-amber-600" : "text-rose-600"}`}>{formatMoney(d)}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right">{formatMoney(expected)}</TableCell>
                    <TableCell className="text-right">{formatMoney(declared)}</TableCell>
                    <TableCell className={`text-right ${diff === 0 ? "text-emerald-600" : diff > 0 ? "text-amber-600" : "text-rose-600"}`}>{formatMoney(diff)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="servicio">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Tipo de servicio</TableHead><TableHead className="text-right"># pedidos</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                <TableBody>
                  {Object.entries(services).map(([k, v]) => (
                    <TableRow key={k}><TableCell className="capitalize font-medium">{k}</TableCell><TableCell className="text-right">{v.count}</TableCell><TableCell className="text-right">{formatMoney(v.amount)}</TableCell></TableRow>
                  ))}
                  {Object.keys(services).length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Sin datos.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="balance">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableBody>
                  <TableRow><TableCell>Apertura</TableCell><TableCell className="text-right">{formatMoney(apertura)}</TableCell></TableRow>
                  <TableRow><TableCell>+ Ventas en efectivo</TableCell><TableCell className="text-right text-emerald-600">{formatMoney(cashSales)}</TableCell></TableRow>
                  <TableRow><TableCell>+ Entradas</TableCell><TableCell className="text-right text-emerald-600">{formatMoney(entries)}</TableCell></TableRow>
                  <TableRow><TableCell>− Salidas</TableCell><TableCell className="text-right text-rose-600">{formatMoney(exits)}</TableCell></TableRow>
                  <TableRow><TableCell>− Gastos</TableCell><TableCell className="text-right text-rose-600">{formatMoney(expensesAmt)}</TableCell></TableRow>
                  <TableRow><TableCell>− Devoluciones/Reembolsos</TableCell><TableCell className="text-right text-rose-600">{formatMoney(refunds)}</TableCell></TableRow>
                  <TableRow className="bg-primary/10 font-semibold text-lg">
                    <TableCell>= Efectivo esperado</TableCell>
                    <TableCell className="text-right">{formatMoney(efectivoEsperado)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="productos">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Producto</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.name}><TableCell>{p.name}</TableCell><TableCell className="text-right font-semibold">{p.qty}</TableCell><TableCell className="text-right">{formatMoney(p.total)}</TableCell></TableRow>
                  ))}
                  {products.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Sin productos vendidos.</TableCell></TableRow>}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right">{products.reduce((a, p) => a + p.qty, 0)}</TableCell>
                    <TableCell className="text-right">{formatMoney(products.reduce((a, p) => a + p.total, 0))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ajustes" className="space-y-4">
          <AjusteBlock title="Entradas" rows={entradas} totalLabel="Total entradas" tone="emerald" />
          <AjusteBlock title="Salidas" rows={salidas} totalLabel="Total salidas" tone="orange" />
          <AjusteBlock title="Gastos" rows={gastos} totalLabel="Total gastos" tone="rose" showCategory showDescription />
          <AjusteBlock title="Devoluciones / Reembolsos" rows={devoluciones} totalLabel="Total devoluciones" tone="slate" />
        </TabsContent>
      </Tabs>

      {/* Comparación final */}
      <div className="grid gap-3 md:grid-cols-3">
        <BigCard label="Valor esperado" value={formatMoney(expected)} tone="blue" icon={TrendingUp} />
        <BigCard label="Valor declarado" value={formatMoney(declared)} tone="violet" icon={TrendingDown} />
        <BigCard
          label="Diferencia"
          value={formatMoney(diff)}
          tone={diff === 0 ? "emerald" : diff > 0 ? "amber" : "rose"}
          icon={diff === 0 ? CheckCircle2 : AlertTriangle}
          note={diff === 0 ? "🟢 Cuadró correctamente" : diff > 0 ? "🟠 Sobrante" : "🔴 Faltante"}
        />
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 font-display text-xl font-extrabold">{value}</div>
      </CardContent>
    </Card>
  );
}

const TONE_GRAD: Record<string, string> = {
  blue: "from-blue-500 to-indigo-600",
  violet: "from-violet-500 to-purple-600",
  emerald: "from-emerald-500 to-green-600",
  amber: "from-amber-500 to-orange-500",
  rose: "from-rose-500 to-red-600",
  orange: "from-orange-500 to-red-500",
  slate: "from-slate-500 to-slate-700",
};

function BigCard({ label, value, tone, icon: Icon, note }: { label: string; value: string; tone: string; icon: React.ElementType; note?: string }) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${TONE_GRAD[tone]} p-[1.5px] shadow-elegant`}>
      <div className="rounded-2xl bg-background/95 p-5 h-full">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${TONE_GRAD[tone]} text-white shadow`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-2 font-display text-3xl font-extrabold tracking-tight">{value}</div>
        {note && <div className="mt-1 text-sm font-medium">{note}</div>}
      </div>
    </div>
  );
}

interface AjusteRow {
  id: string;
  created_at: string;
  user_name: string | null;
  category: string;
  description: string | null;
  amount: number;
}

function AjusteBlock({
  title, rows, totalLabel, tone, showCategory, showDescription,
}: {
  title: string; rows: AjusteRow[]; totalLabel: string; tone: string;
  showCategory?: boolean; showDescription?: boolean;
}) {
  const total = rows.reduce((a, r) => a + Number(r.amount ?? 0), 0);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className={`text-base bg-gradient-to-r ${TONE_GRAD[tone]} bg-clip-text text-transparent`}>{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              {showCategory && <TableHead>Categoría</TableHead>}
              <TableHead>{showDescription ? "Descripción" : "Motivo"}</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.created_at), "dd/MM HH:mm")}</TableCell>
                <TableCell className="text-sm">{r.user_name ?? "—"}</TableCell>
                {showCategory && <TableCell className="capitalize">{r.category}</TableCell>}
                <TableCell className="text-sm">{r.description ?? r.category}</TableCell>
                <TableCell className="text-right font-medium">{formatMoney(r.amount)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={showCategory ? 5 : 4} className="text-center py-4 text-muted-foreground text-sm">Sin movimientos.</TableCell></TableRow>}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={showCategory ? 4 : 3}>{totalLabel}</TableCell>
              <TableCell className="text-right">{formatMoney(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
