import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, subDays, startOfMonth } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/contexts/branch-context";
import { formatMoney } from "@/lib/format";
import {
  aggregateProducts, fetchSaleItemsForSales, fetchSales, paymentBreakdown, serviceBreakdown,
} from "@/lib/reports";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/reportes/ventas")({
  head: () => ({ meta: [{ title: "Ventas y Analíticas · Reportes" }] }),
  component: VentasPage,
});

const COLORS = ["#2563eb", "#10b981", "#f59e0b", "#e11d48", "#8b5cf6", "#0ea5e9", "#84cc16", "#f97316"];

type Preset = "hoy" | "7d" | "mes" | "custom";

function VentasPage() {
  const { branches, activeBranchId } = useBranch();
  const [preset, setPreset] = useState<Preset>("7d");
  const [customFrom, setCustomFrom] = useState<string>(format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState<string>(activeBranchId ?? "all");

  const range = useMemo(() => {
    const now = new Date();
    if (preset === "hoy") return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    if (preset === "7d") return { from: startOfDay(subDays(now, 6)).toISOString(), to: endOfDay(now).toISOString() };
    if (preset === "mes") return { from: startOfMonth(now).toISOString(), to: endOfDay(now).toISOString() };
    return {
      from: startOfDay(new Date(customFrom)).toISOString(),
      to: endOfDay(new Date(customTo)).toISOString(),
    };
  }, [preset, customFrom, customTo]);

  const filters = { from: range.from, to: range.to, branchId: branchId === "all" ? null : branchId };
  const { data: sales = [] } = useQuery({
    queryKey: ["reportes.ventas.sales", filters],
    queryFn: () => fetchSales(filters),
  });

  const activeSales = useMemo(() => sales.filter((s) => s.status !== "cancelled"), [sales]);
  const saleIds = useMemo(() => activeSales.map((s) => s.id), [activeSales]);
  const { data: items = [] } = useQuery({
    queryKey: ["reportes.ventas.items", saleIds.length, saleIds[0]],
    queryFn: () => fetchSaleItemsForSales(saleIds),
    enabled: saleIds.length > 0,
  });

  // Ventas por día
  const perDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of activeSales) {
      const d = format(new Date(s.created_at), "yyyy-MM-dd");
      map.set(d, (map.get(d) ?? 0) + Number(s.total ?? 0));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ dia: d.slice(5), total: v }));
  }, [activeSales]);

  // Ventas por hora
  const perHour = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of activeSales) {
      const h = new Date(s.created_at).getHours();
      map.set(h, (map.get(h) ?? 0) + Number(s.total ?? 0));
    }
    return Array.from({ length: 24 }, (_, h) => ({ hora: `${h}h`, total: map.get(h) ?? 0 }));
  }, [activeSales]);

  const payments = useMemo(() => paymentBreakdown(activeSales), [activeSales]);
  const services = useMemo(() => serviceBreakdown(activeSales), [activeSales]);
  const { data: modifierNames } = useQuery({
    queryKey: ["reportes.modifier-names"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("modifiers").select("name");
      return new Set((data ?? []).map((m: { name: string | null }) => (m.name ?? "").trim().toLowerCase()).filter(Boolean));
    },
  });
  const products = useMemo(() => aggregateProducts(items, { modifierNames }), [items, modifierNames]);

  const METHOD_LABELS: Record<string, string> = { efectivo: "Efectivo", nequi: "Nequi", bancolombia: "Bancolombia", tarjeta: "Tarjeta", transferencia: "Transferencia", mixto: "Pago Mixto", otros: "Otros" };
  const paymentData = Object.entries(payments).map(([k, v]) => ({ name: METHOD_LABELS[k] ?? k, value: v.amount }));
  const serviceData = Object.entries(services).map(([k, v]) => ({ name: k, value: v.amount }));

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <Card>
        <CardContent className="grid gap-3 md:grid-cols-5 p-4">
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Periodo</label>
            <div className="flex flex-wrap gap-1">
              {(["hoy", "7d", "mes", "custom"] as Preset[]).map((p) => (
                <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => setPreset(p)}>
                  {p === "hoy" ? "Hoy" : p === "7d" ? "7 días" : p === "mes" ? "Mes" : "Rango"}
                </Button>
              ))}
            </div>
          </div>
          {preset === "custom" && (
            <>
              <div><label className="text-xs text-muted-foreground">Desde</label><Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></div>
              <div><label className="text-xs text-muted-foreground">Hasta</label><Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></div>
            </>
          )}
          <div>
            <label className="text-xs text-muted-foreground">Sede</label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Ventas por día</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={perDay}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dia" />
                <YAxis tickFormatter={(v) => formatMoney(v)} width={90} />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Line type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ventas por hora</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perHour}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hora" />
                <YAxis tickFormatter={(v) => formatMoney(v)} width={90} />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Bar dataKey="total" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Medios de pago</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={paymentData} dataKey="value" nameKey="name" outerRadius={90} label={(e) => e.name}>
                  {paymentData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tipo de servicio</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serviceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(v) => formatMoney(v)} width={90} />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Bar dataKey="value" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Productos más vendidos</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left py-2">Producto</th><th className="text-right">Cant.</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {products.slice(0, 15).map((p) => (
                  <tr key={p.name} className="border-b">
                    <td className="py-2">{p.name}</td>
                    <td className="text-right font-semibold">{p.qty}</td>
                    <td className="text-right">{formatMoney(p.total)}</td>
                  </tr>
                ))}
                {products.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">Sin ventas en el periodo.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Productos menos vendidos</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr><th className="text-left py-2">Producto</th><th className="text-right">Cant.</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {[...products].reverse().slice(0, 15).map((p) => (
                  <tr key={p.name} className="border-b">
                    <td className="py-2">{p.name}</td>
                    <td className="text-right font-semibold">{p.qty}</td>
                    <td className="text-right">{formatMoney(p.total)}</td>
                  </tr>
                ))}
                {products.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">Sin datos.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
