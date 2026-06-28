import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Users, Star, TrendingUp, MessageCircle, Receipt } from "lucide-react";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM · Goloso POS" }] }),
  component: CrmPage,
});

interface Customer {
  id: string; name: string; phone: string | null; address: string | null; neighborhood: string | null;
  email: string | null; points: number; total_spent: number; visits: number; created_at: string;
}
interface Sale { id: string; ticket_number: number; total: number; status: string; created_at: string; order_type: string | null; payment_method: string; }
interface Item { id: string; sale_id: string; product_name: string; qty: number; unit_price: number; subtotal: number; }

function waLink(phone: string, msg = "") {
  const clean = phone.replace(/[^\d]/g, "");
  const num = clean.startsWith("57") || clean.length > 10 ? clean : `57${clean}`;
  return `https://wa.me/${num}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;
}

function segment(c: Customer): { label: string; tone: "default" | "secondary" | "destructive" | "outline" } {
  if (c.total_spent >= 200000 || c.visits >= 10) return { label: "VIP", tone: "default" };
  if (c.visits >= 3) return { label: "Frecuente", tone: "secondary" };
  if (c.visits === 0) return { label: "Nuevo", tone: "outline" };
  return { label: "Ocasional", tone: "outline" };
}

function CrmPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["crm-customers"],
    queryFn: async () => (await supabase.from("customers").select("*").order("total_spent", { ascending: false })).data as Customer[] ?? [],
  });

  const filtered = useMemo(() => {
    if (!q.trim()) return customers;
    const s = q.toLowerCase();
    return customers.filter((c) => c.name.toLowerCase().includes(s) || (c.phone ?? "").includes(s) || (c.neighborhood ?? "").toLowerCase().includes(s));
  }, [customers, q]);

  const stats = useMemo(() => {
    const total = customers.length;
    const vip = customers.filter((c) => segment(c).label === "VIP").length;
    const spent = customers.reduce((s, c) => s + Number(c.total_spent || 0), 0);
    const avg = total > 0 ? spent / total : 0;
    return { total, vip, spent, avg };
  }, [customers]);

  const { data: sales = [] } = useQuery<Sale[]>({
    queryKey: ["crm-sales", selected?.id],
    enabled: !!selected,
    queryFn: async () => (await supabase.from("sales").select("*").eq("customer_id", selected!.id).order("created_at", { ascending: false }).limit(50)).data as Sale[] ?? [],
  });

  const ids = sales.map((s) => s.id);
  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["crm-items", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => (await supabase.from("sale_items").select("*").in("sale_id", ids)).data as Item[] ?? [],
  });

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; total: number }>();
    items.forEach((i) => {
      const e = map.get(i.product_name) ?? { name: i.product_name, qty: 0, total: 0 };
      e.qty += i.qty; e.total += Number(i.subtotal || 0);
      map.set(i.product_name, e);
    });
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [items]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">CRM</h1>
        <p className="text-sm text-muted-foreground">Conoce a tus clientes, su historial y segméntalos para campañas.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Users className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Clientes</div><div className="font-display text-2xl">{stats.total}</div></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Star className="h-5 w-5 text-amber-500" /><div><div className="text-xs text-muted-foreground">VIP</div><div className="font-display text-2xl">{stats.vip}</div></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><TrendingUp className="h-5 w-5 text-success" /><div><div className="text-xs text-muted-foreground">Ventas totales</div><div className="font-display text-2xl">{formatMoney(stats.spent)}</div></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Receipt className="h-5 w-5 text-secondary-foreground" /><div><div className="text-xs text-muted-foreground">Ticket promedio</div><div className="font-display text-2xl">{formatMoney(stats.avg)}</div></div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <CardTitle className="flex-1">Clientes</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Segmento</TableHead>
                <TableHead className="text-right">Visitas</TableHead>
                <TableHead className="text-right">Gastado</TableHead>
                <TableHead className="text-right">Puntos</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const seg = segment(c);
                return (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                    <TableCell><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.neighborhood}</div></TableCell>
                    <TableCell>{c.phone}</TableCell>
                    <TableCell><Badge variant={seg.tone}>{seg.label}</Badge></TableCell>
                    <TableCell className="text-right">{c.visits}</TableCell>
                    <TableCell className="text-right">{formatMoney(c.total_spent)}</TableCell>
                    <TableCell className="text-right"><Badge variant="secondary">{c.points}</Badge></TableCell>
                    <TableCell className="text-right">
                      {c.phone && (
                        <Button asChild size="sm" variant="ghost" onClick={(e) => e.stopPropagation()}>
                          <a href={waLink(c.phone)} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" /></a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Sin clientes</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected?.name}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Visitas</div><div className="font-display text-xl">{selected.visits}</div></div>
                <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Gastado</div><div className="font-display text-xl">{formatMoney(selected.total_spent)}</div></div>
                <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Puntos</div><div className="font-display text-xl">{selected.points}</div></div>
              </div>

              <div className="text-sm text-muted-foreground space-y-0.5">
                {selected.phone && <div>📞 {selected.phone}</div>}
                {selected.address && <div>📍 {selected.address} {selected.neighborhood && `· ${selected.neighborhood}`}</div>}
                {selected.email && <div>✉️ {selected.email}</div>}
              </div>

              {topProducts.length > 0 && (
                <div>
                  <div className="font-medium mb-2">Productos favoritos</div>
                  <ul className="text-sm space-y-1">
                    {topProducts.map((p) => (
                      <li key={p.name} className="flex justify-between"><span>{p.name}</span><span className="text-muted-foreground">{p.qty} ud · {formatMoney(p.total)}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="font-medium mb-2">Historial de pedidos ({sales.length})</div>
                <div className="space-y-2">
                  {sales.map((s) => {
                    const its = items.filter((i) => i.sale_id === s.id);
                    return (
                      <div key={s.id} className="rounded-md border p-3 text-sm">
                        <div className="flex justify-between">
                          <div className="font-medium">#{s.ticket_number} · {new Date(s.created_at).toLocaleString("es-CO")}</div>
                          <Badge variant={s.status === "paid" ? "secondary" : s.status === "cancelled" ? "destructive" : "outline"}>{s.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{s.order_type} · {s.payment_method}</div>
                        <ul className="mt-1 text-xs">
                          {its.map((i) => <li key={i.id}>{i.qty} × {i.product_name}</li>)}
                        </ul>
                        <div className="text-right font-medium mt-1">{formatMoney(s.total)}</div>
                      </div>
                    );
                  })}
                  {sales.length === 0 && <div className="text-muted-foreground text-sm">Sin pedidos registrados.</div>}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
