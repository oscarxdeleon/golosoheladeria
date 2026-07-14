import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Download, Printer, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { formatMoney } from "@/lib/format";
import {
  aggregateProducts, computeFinancialSummary, fetchExpenses, fetchSaleItemsForSales,
  fetchSales, paymentBreakdown, serviceBreakdown,
  CATEGORY_INCOME, CATEGORY_WITHDRAWAL, CATEGORY_REFUND,
  type CashSessionRow, type ExpenseRow,
} from "@/lib/reports";
import { downloadShiftPdf } from "@/lib/shift-pdf";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reportes/cajas/$id")({
  head: () => ({ meta: [{ title: "Detalle de arqueo · Reportes" }] }),
  component: CajaDetailPage,
});

const METHOD_DOT: Record<string, string> = {
  efectivo: "bg-blue-500",
  nequi: "bg-fuchsia-500",
  bancolombia: "bg-slate-400",
  tarjeta: "bg-violet-500",
  transferencia: "bg-emerald-500",
  otros: "bg-slate-400",
};

const SERVICE_STYLE: Record<string, { emoji: string; label: string; bg: string; text: string; badgeBg: string; badgeText: string }> = {
  mesa:      { emoji: "🪑", label: "Mesa",       bg: "bg-blue-50 border-blue-100",       text: "text-blue-700",     badgeBg: "bg-emerald-100",  badgeText: "text-emerald-700" },
  domicilio: { emoji: "🛵", label: "Domicilio",  bg: "bg-orange-50 border-orange-100",   text: "text-orange-700",   badgeBg: "bg-emerald-100",  badgeText: "text-emerald-700" },
  llevar:    { emoji: "🥡", label: "Para Llevar",bg: "bg-purple-50 border-purple-100",   text: "text-purple-700",   badgeBg: "bg-emerald-100",  badgeText: "text-emerald-700" },
  kiosko:    { emoji: "🖥️", label: "Kiosko",     bg: "bg-teal-50 border-teal-100",       text: "text-teal-700",     badgeBg: "bg-emerald-100",  badgeText: "text-emerald-700" },
};

function normalizeService(k: string): keyof typeof SERVICE_STYLE {
  const s = k.toLowerCase();
  if (s.includes("mesa") || s === "dine_in") return "mesa";
  if (s.includes("domic") || s === "delivery") return "domicilio";
  if (s.includes("llevar") || s === "takeaway" || s === "to_go") return "llevar";
  if (s.includes("kiosko") || s.includes("kiosk")) return "kiosko";
  return "mesa";
}

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

  const filters = useMemo(() => session ? { cashSessionId: session.id, branchId: session.branch_id } : null, [session]);

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

  if (isLoading || !session) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card><CardContent className="py-10 text-center text-muted-foreground">{isLoading ? "Cargando…" : "Cierre no encontrado."}</CardContent></Card>
      </div>
    );
  }

  const summary = computeFinancialSummary(sales, expenses, [session]);
  const payments = paymentBreakdown(sales);
  const services = serviceBreakdown(sales);
  const products = aggregateProducts(items);

  const cashSales = payments["efectivo"]?.amount ?? 0;
  const entries = summary.entries;
  const exits = summary.exits + summary.expenses + summary.refunds;
  const apertura = Number(session.opening_amount) || 0;
  const efectivoEsperado = apertura + cashSales + entries - exits;

  const declared = Number(session.counted_amount) || 0;
  const expected = Number(session.expected_amount) || efectivoEsperado;
  const diff = declared - expected;

  // Declared por medio no-efectivo
  const declaredNonCash: { key: string; label: string; amount: number }[] = [];
  const nequi = Number(session.nequi_counted ?? 0);
  const banco = Number(session.bancolombia_counted ?? 0);
  if (nequi > 0) declaredNonCash.push({ key: "nequi", label: "NEQUI", amount: nequi });
  if (banco > 0) declaredNonCash.push({ key: "bcol", label: "BCOLOMBIA", amount: banco });
  const totalDeclarado = declaredNonCash.reduce((a, x) => a + x.amount, 0);

  const entradas = expenses.filter((e) => CATEGORY_INCOME.has((e.category ?? "").toLowerCase()));
  const salidas = expenses.filter((e) => {
    const c = (e.category ?? "").toLowerCase();
    return CATEGORY_WITHDRAWAL.has(c) || (!CATEGORY_INCOME.has(c) && !CATEGORY_REFUND.has(c));
  });
  const devoluciones = expenses.filter((e) => CATEGORY_REFUND.has((e.category ?? "").toLowerCase()));

  const totalSalesByPayments = Object.values(payments).reduce((a, v) => a + v.amount, 0);
  const totalTx = Object.values(payments).reduce((a, v) => a + v.count, 0);
  const turnNumber = session.id.slice(0, 3).toUpperCase();

  async function handlePdf() {
    setDownloading(true);
    try {
      await downloadShiftPdf({ session: session!, branchName, turnNumber, sales, items, expenses });
      toast.success("PDF generado");
    } catch (e) {
      toast.error("No se pudo generar el PDF", { description: (e as Error).message });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-10">
      {/* Header sheet */}
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-b from-primary/5 to-background p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-extrabold leading-tight">Detalle de Arqueo <span className="text-primary">#{turnNumber}</span></h2>
                <p className="text-sm text-muted-foreground">Sesión de {session.user_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{branchName} · {format(new Date(session.opened_at), "dd/MM/yyyy HH:mm")}{session.closed_at ? ` – ${format(new Date(session.closed_at), "HH:mm")}` : " · abierto"}</p>
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
        <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-muted/50 p-1 h-auto">
          <TabsTrigger value="resumen" className="rounded-xl data-[state=active]:bg-background data-[state=active]:shadow font-semibold">Resumen</TabsTrigger>
          <TabsTrigger value="productos" className="rounded-xl data-[state=active]:bg-background data-[state=active]:shadow font-semibold">Productos</TabsTrigger>
          <TabsTrigger value="ajustes" className="rounded-xl data-[state=active]:bg-background data-[state=active]:shadow font-semibold">Ajustes</TabsTrigger>
        </TabsList>

        {/* -------- RESUMEN -------- */}
        <TabsContent value="resumen" className="space-y-6">
          {/* KPI 2x2 */}
          <div className="grid grid-cols-2 gap-3">
            <KpiTile label="Pedidos" value={String(summary.transactions)} tone="slate" />
            <KpiTile label="Ventas totales" value={formatMoney(summary.salesTotal)} tone="emerald" />
            <KpiTile label="Ticket promedio" value={formatMoney(summary.averageTicket)} tone="blue" />
            <KpiTile label="Cancelados" value={String(summary.cancelled)} tone="amber" />
          </div>

          {/* Ventas por método de pago */}
          <Section emoji="💳" title="VENTAS POR MÉTODO DE PAGO">
            <div className="space-y-2">
              {Object.entries(payments).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${METHOD_DOT[k] ?? "bg-slate-400"}`} />
                    <span className="font-bold uppercase tracking-wide text-sm">{k}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{v.count} ventas</span>
                  </div>
                  <div className="font-display text-lg font-extrabold text-emerald-700">{formatMoney(v.amount)}</div>
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

          {/* Declarado por el cajero */}
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

          {/* Ventas por tipo de servicio */}
          <Section emoji="🍽️" title="VENTAS POR TIPO DE SERVICIO">
            <div className="space-y-3">
              {Object.entries(services).map(([k, v]) => {
                const s = SERVICE_STYLE[normalizeService(k)];
                return (
                  <div key={k} className={`rounded-2xl border px-4 py-3 ${s.bg}`}>
                    <div className="flex items-center justify-between">
                      <div className={`flex items-center gap-2 font-bold text-base ${s.text}`}>
                        <span className="text-xl leading-none">{s.emoji}</span>{s.label}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.badgeBg} ${s.badgeText}`}>{v.count} pedidos</span>
                    </div>
                    <div className={`mt-1 font-display text-2xl font-extrabold ${s.text}`}>{formatMoney(v.amount)}</div>
                  </div>
                );
              })}
              {Object.keys(services).length === 0 && <EmptyRow label="Sin ventas por servicio." />}
            </div>
          </Section>

          {/* Balance efectivo */}
          <Section emoji="💵" title="BALANCE DE EFECTIVO EN CAJA">
            <div className="space-y-2.5 px-1 text-[15px]">
              <BalanceLine label="Apertura de caja" value={formatMoney(apertura)} />
              <BalanceLine label="+ Ventas en efectivo" value={formatMoney(cashSales)} tone="blue" />
              <BalanceLine label="+ Entradas de efectivo" value={formatMoney(entries)} tone="emerald" />
              <BalanceLine label="- Salidas / Retiros" value={`-${formatMoney(exits)}`} tone="rose" />
              <div className="my-2 border-t border-dashed" />
              <div className="flex items-center justify-between font-bold">
                <span>= Efectivo Esperado</span>
                <span className="font-display text-2xl text-rose-600">{formatMoney(efectivoEsperado)}</span>
              </div>
            </div>
          </Section>

          {/* Comparación final */}
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
          <AjusteBlock title="ENTRADAS EXTRAS" tone="emerald" rows={entradas} sign="+" />
          <AjusteBlock title="SALIDAS / GASTOS" tone="rose" rows={salidas} sign="-" />
          <AjusteBlock title="DEVOLUCIONES / REEMBOLSOS" tone="amber" rows={devoluciones} sign="-" />
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

function KpiTile({ label, value, tone }: { label: string; value: string; tone: keyof typeof KPI_TONE }) {
  const t = KPI_TONE[tone];
  return (
    <div className={`rounded-2xl border px-4 py-4 text-center ${t.bg}`}>
      <div className={`text-[11px] font-bold uppercase tracking-widest ${t.label}`}>{label}</div>
      <div className={`mt-1.5 font-display text-2xl font-extrabold ${t.value}`}>{value}</div>
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

function AjusteBlock({ title, rows, tone, sign }: { title: string; rows: ExpenseRow[]; tone: keyof typeof TONE_HEADING; sign: "+" | "-" }) {
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

