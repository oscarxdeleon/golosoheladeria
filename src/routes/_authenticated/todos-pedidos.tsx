import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatMoney, formatDate } from "@/lib/format";
import { Search, ChevronDown, ChevronRight, RefreshCw, Calendar } from "lucide-react";

export const Route = createFileRoute("/_authenticated/todos-pedidos")({
  head: () => ({ meta: [{ title: "Todos los pedidos · Goloso POS" }] }),
  component: TodosPedidosPage,
});

const TYPE_LABEL: Record<string, string> = {
  mesa: "Local", llevar: "Para llevar", domicilio: "Domicilio",
  kiosko: "Autopedido", online: "En línea",
};

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendiente", className: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
  confirmed: { label: "En preparación", className: "bg-blue-500/15 text-blue-700 border-blue-500/30" },
  ready: { label: "Listo", className: "bg-indigo-500/15 text-indigo-700 border-indigo-500/30" },
  paid: { label: "Entregado", className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  cancelled: { label: "Cancelado", className: "bg-rose-500/15 text-rose-700 border-rose-500/30" },
};

interface Modifier { name?: string; qty?: number; price?: number }
interface Item {
  id: string;
  product_name: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  modifiers?: Modifier[] | unknown;
}
interface Sale {
  id: string;
  ticket_number: number;
  total: number;
  subtotal: number | null;
  payment_method: string | null;
  customer_name: string | null;
  user_name: string | null;
  order_type: string;
  status: string;
  branch_id: string | null;
  created_at: string;
  notes: string | null;
  delivery_address: string | null;
  sale_items: Item[];
}

function todayRange(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(start.getTime() + 86400000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function toISODateInput(iso: string) {
  return iso.slice(0, 10);
}

function TodosPedidosPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const [preset, setPreset] = useState<"hoy" | "ayer" | "custom">("hoy");
  const [customDate, setCustomDate] = useState<string>(toISODateInput(new Date().toISOString()));
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const range = useMemo(() => {
    if (preset === "hoy") return todayRange(0);
    if (preset === "ayer") return todayRange(1);
    const start = new Date(customDate + "T00:00:00");
    const end = new Date(start.getTime() + 86400000);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [preset, customDate]);

  const { data: sales = [], isFetching, refetch } = useQuery({
    queryKey: ["todos-pedidos", activeBranchId, range.start, range.end],
    enabled: !!activeBranchId && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,ticket_number,total,subtotal,payment_method,customer_name,user_name,order_type,status,branch_id,created_at,notes,delivery_address,sale_items(id,product_name,qty,unit_price,subtotal,modifiers)")
        .eq("branch_id", activeBranchId!)
        .gte("created_at", range.start)
        .lt("created_at", range.end)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Sale[];
    },
  });

  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    if (!n) return sales;
    return sales.filter((s) =>
      String(s.ticket_number).includes(n) ||
      (s.customer_name ?? "").toLowerCase().includes(n) ||
      (s.user_name ?? "").toLowerCase().includes(n) ||
      (s.sale_items ?? []).some((it) => (it.product_name ?? "").toLowerCase().includes(n))
    );
  }, [sales, search]);

  const summary = useMemo(() => {
    const totalPedidos = filtered.length;
    const totalVendido = filtered.reduce((a, s) => a + Number(s.total ?? 0), 0);
    const productos = filtered.reduce(
      (a, s) => a + (s.sale_items ?? []).reduce((b, it) => b + Number(it.qty ?? 0), 0), 0);
    const ticket = totalPedidos > 0 ? totalVendido / totalPedidos : 0;
    return { totalPedidos, totalVendido, ticket, productos };
  }, [filtered]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  if (authLoading) return <div className="p-6 text-muted-foreground">Cargando…</div>;
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Todos los pedidos</h1>
          <p className="text-muted-foreground text-sm">
            Sede: <span className="font-semibold text-foreground">{activeBranch?.name ?? "—"}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total pedidos" value={String(summary.totalPedidos)} />
        <SummaryCard label="Total vendido" value={formatMoney(summary.totalVendido)} />
        <SummaryCard label="Ticket promedio" value={formatMoney(summary.ticket)} />
        <SummaryCard label="Productos vendidos" value={String(summary.productos)} />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button size="sm" variant={preset === "hoy" ? "default" : "outline"} onClick={() => setPreset("hoy")}>Hoy</Button>
            <Button size="sm" variant={preset === "ayer" ? "default" : "outline"} onClick={() => setPreset("ayer")}>Ayer</Button>
            <Button size="sm" variant={preset === "custom" ? "default" : "outline"} onClick={() => setPreset("custom")}>
              <Calendar className="h-4 w-4 mr-1" /> Personalizada
            </Button>
          </div>
          {preset === "custom" && (
            <Input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-[180px]"
            />
          )}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por # pedido, cliente, cajero o producto…"
              className="pl-8"
            />
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            Sin pedidos para los filtros seleccionados.
          </CardContent></Card>
        )}
        {filtered.map((s) => {
          const st = STATUS_LABEL[s.status] ?? { label: s.status, className: "" };
          const isOpen = expanded.has(s.id);
          return (
            <Card key={s.id} className="overflow-hidden">
              <Collapsible open={isOpen} onOpenChange={() => toggle(s.id)}>
                <CollapsibleTrigger asChild>
                  <button className="w-full text-left hover:bg-muted/40 transition-colors">
                    <div className="flex flex-wrap items-center gap-3 p-4">
                      <div className="flex items-center gap-2">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="font-mono font-bold">#{s.ticket_number}</span>
                      </div>
                      <span className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(s.created_at)}</span>
                      <Badge variant="outline" className={st.className}>{st.label}</Badge>
                      <Badge variant="outline">{TYPE_LABEL[s.order_type] ?? s.order_type}</Badge>
                      <span className="text-sm">{s.customer_name ?? "—"}</span>
                      <span className="text-sm text-muted-foreground">· {s.user_name ?? "—"}</span>
                      <span className="text-sm text-muted-foreground">· {s.payment_method ?? "—"}</span>
                      <span className="ml-auto font-semibold">{formatMoney(s.total)}</span>
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t p-4 bg-muted/20 space-y-3">
                    <div className="space-y-2">
                      {(s.sale_items ?? []).map((it) => {
                        const mods = Array.isArray(it.modifiers) ? (it.modifiers as Modifier[]) : [];
                        return (
                          <div key={it.id} className="flex flex-col gap-0.5 rounded-md bg-background p-2 border">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{it.qty}× {it.product_name}</span>
                              <span className="text-sm font-mono">{formatMoney(it.subtotal)}</span>
                            </div>
                            {mods.length > 0 && (
                              <ul className="ml-4 text-xs text-muted-foreground list-disc">
                                {mods.map((m, i) => (
                                  <li key={i}>
                                    {m.qty && m.qty > 1 ? `${m.qty}× ` : ""}
                                    {m.name ?? "Modificador"}
                                    {m.price ? ` (+${formatMoney(Number(m.price) * Number(m.qty ?? 1))})` : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {(s.notes || s.delivery_address) && (
                      <div className="text-xs text-muted-foreground space-y-1">
                        {s.delivery_address && <div><b>Dirección:</b> {s.delivery_address}</div>}
                        {s.notes && <div><b>Notas:</b> {s.notes}</div>}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t text-sm">
                      <span className="text-muted-foreground">Subtotal: {formatMoney(s.subtotal ?? s.total)}</span>
                      <span className="font-semibold text-base">Total: {formatMoney(s.total)}</span>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold font-display mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
