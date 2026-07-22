import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Users, Star, TrendingUp, MessageCircle, Receipt, Radio } from "lucide-react";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM · Goloso POS" }] }),
  component: CrmPage,
});

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  neighborhood: string | null;
  email: string | null;
  points: number;
  total_spent: number;
  visits: number;
  total_orders: number;
  last_order_at: string | null;
  frequent_channel: string | null;
  created_at: string;
}
interface Sale { id: string; ticket_number: number; total: number; status: string; created_at: string; order_type: string | null; payment_method: string; source: string | null; }
interface Item { id: string; sale_id: string; product_name: string; qty: number; unit_price: number; subtotal: number; }

function waLink(phone: string, msg = "") {
  const clean = phone.replace(/[^\d]/g, "");
  const num = clean.startsWith("57") || clean.length > 10 ? clean : `57${clean}`;
  return `https://wa.me/${num}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;
}

const CHANNEL_LABELS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  online_menu: { label: "Menú en Línea", tone: "default" },
  kiosk: { label: "Autopedido", tone: "secondary" },
  table_qr: { label: "QR Mesa", tone: "secondary" },
  pos: { label: "Caja", tone: "outline" },
  domicilio: { label: "Domicilio", tone: "default" },
  llevar: { label: "Para Llevar", tone: "outline" },
  mesa: { label: "Mesa", tone: "outline" },
};

function channelBadge(ch: string | null) {
  if (!ch) return { label: "—", tone: "outline" as const };
  return CHANNEL_LABELS[ch] ?? { label: ch, tone: "outline" as const };
}

function segment(c: Customer): { label: string; tone: "default" | "secondary" | "destructive" | "outline" } {
  const orders = c.total_orders ?? c.visits ?? 0;
  if (Number(c.total_spent) >= 200000 || orders >= 10) return { label: "VIP", tone: "default" };
  if (orders >= 3) return { label: "Frecuente", tone: "secondary" };
  if (orders === 0) return { label: "Nuevo", tone: "outline" };
  return { label: "Ocasional", tone: "outline" };
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

function CrmPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [live, setLive] = useState(false);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["crm-customers"],
    queryFn: async () =>
      (await supabase
        .from("customers")
        .select("*")
        .order("last_order_at", { ascending: false, nullsFirst: false })
      ).data as Customer[] ?? [],
  });

  // Realtime: refresh on any customer change
  useEffect(() => {
    const channel = supabase
      .channel("crm-customers-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => {
        qc.invalidateQueries({ queryKey: ["crm-customers"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => {
        // Sales trigger updates customers; refetch to catch aggregates fast.
        qc.invalidateQueries({ queryKey: ["crm-customers"] });
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    const digits = s.replace(/[^\d]/g, "");
    return customers.filter((c) => {
      const nameMatch = c.name?.toLowerCase().includes(s);
      const phoneMatch = digits.length > 0 && (c.phone ?? "").replace(/[^\d]/g, "").includes(digits);
      return nameMatch || phoneMatch;
    });
  }, [customers, q]);

  const stats = useMemo(() => {
    const total = customers.length;
    const vip = customers.filter((c) => segment(c).label === "VIP").length;
    const spent = customers.reduce((s, c) => s + Number(c.total_spent || 0), 0);
    const orders = customers.reduce((s, c) => s + Number(c.total_orders || 0), 0);
    const avg = orders > 0 ? spent / orders : 0;
    return { total, vip, spent, avg };
  }, [customers]);

  const { data: sales = [] } = useQuery<Sale[]>({
    queryKey: ["crm-sales", selected?.id],
    enabled: !!selected,
    queryFn: async () =>
      (await supabase.from("sales").select("*").eq("customer_id", selected!.id).order("created_at", { ascending: false }).limit(50)).data as Sale[] ?? [],
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
    <div className="space-y-4 premium-scope">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl">CRM</h1>
          <p className="text-sm text-muted-foreground">
            Captura automática desde POS, Autopedido, Menú en Línea y Domicilios. Identificador único: teléfono.
          </p>
        </div>
        <Badge variant={live ? "default" : "outline"} className="gap-1">
          <Radio className={`h-3 w-3 ${live ? "animate-pulse" : ""}`} />
          {live ? "Sincronización en vivo" : "Conectando…"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Users className="h-5 w-5 text-primary" /><div><div className="text-xs text-muted-foreground">Clientes</div><div className="font-display text-2xl">{stats.total}</div></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Star className="h-5 w-5 text-amber-500" /><div><div className="text-xs text-muted-foreground">VIP</div><div className="font-display text-2xl">{stats.vip}</div></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><TrendingUp className="h-5 w-5 text-success" /><div><div className="text-xs text-muted-foreground">Facturación total</div><div className="font-display text-2xl">{formatMoney(stats.spent)}</div></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3"><Receipt className="h-5 w-5 text-secondary-foreground" /><div><div className="text-xs text-muted-foreground">Ticket promedio</div><div className="font-display text-2xl">{formatMoney(stats.avg)}</div></div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <CardTitle className="flex-1">Base de datos de clientes</CardTitle>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nombre o teléfono…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead>Última compra</TableHead>
                <TableHead>Canal frecuente</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Total facturado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const seg = segment(c);
                const ch = channelBadge(c.frequent_channel);
                return (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Badge variant={seg.tone} className="text-[10px] py-0">{seg.label}</Badge>
                        {c.neighborhood && <span className="text-xs text-muted-foreground">{c.neighborhood}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.phone ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(c.created_at)}</TableCell>
                    <TableCell className="text-xs">{fmtDate(c.last_order_at)}</TableCell>
                    <TableCell><Badge variant={ch.tone}>{ch.label}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{c.total_orders ?? 0}</TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(c.total_spent)}</TableCell>
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
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Sin clientes que coincidan con la búsqueda</TableCell></TableRow>
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
                <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Pedidos</div><div className="font-display text-xl">{selected.total_orders ?? 0}</div></div>
                <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Facturado</div><div className="font-display text-xl">{formatMoney(selected.total_spent)}</div></div>
                <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Puntos</div><div className="font-display text-xl">{selected.points}</div></div>
              </div>

              <div className="text-sm text-muted-foreground space-y-0.5">
                {selected.phone && <div>📞 {selected.phone}</div>}
                {selected.address && <div>📍 {selected.address} {selected.neighborhood && `· ${selected.neighborhood}`}</div>}
                {selected.email && <div>✉️ {selected.email}</div>}
                <div>🗓️ Registrado: {fmtDate(selected.created_at)}</div>
                <div>🛒 Última compra: {fmtDate(selected.last_order_at)}</div>
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
                    const ch = channelBadge(s.source ?? s.order_type);
                    return (
                      <div key={s.id} className="rounded-md border p-3 text-sm">
                        <div className="flex justify-between">
                          <div className="font-medium">#{s.ticket_number} · {new Date(s.created_at).toLocaleString("es-CO")}</div>
                          <Badge variant={s.status === "paid" ? "secondary" : s.status === "cancelled" ? "destructive" : "outline"}>{translateSaleStatus(s.status)}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <Badge variant={ch.tone} className="text-[10px] py-0">{ch.label}</Badge>
                          · {s.payment_method}
                        </div>
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
