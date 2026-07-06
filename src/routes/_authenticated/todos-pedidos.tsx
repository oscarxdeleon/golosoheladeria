import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { useAuth } from "@/hooks/use-auth";
import { useBranchCashSession } from "@/hooks/use-branch-cash-session";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatMoney } from "@/lib/format";
import {
  Search, ChevronDown, ChevronRight, RefreshCw, Filter, X,
  ShoppingBag, UtensilsCrossed, Bike, Monitor, Globe, Clock,
  CheckCircle2, ChefHat, PackageCheck, XCircle, Hourglass,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/todos-pedidos")({
  head: () => ({ meta: [{ title: "Todos los pedidos · Goloso POS" }] }),
  component: TodosPedidosPage,
});

const TYPE_META: Record<string, { label: string; icon: typeof ShoppingBag }> = {
  mesa:      { label: "Local",      icon: UtensilsCrossed },
  llevar:    { label: "Llevar",     icon: ShoppingBag },
  domicilio: { label: "Domicilio",  icon: Bike },
  kiosko:    { label: "Autopedido", icon: Monitor },
  online:    { label: "En línea",   icon: Globe },
};

const STATUS_META: Record<string, { label: string; icon: typeof CheckCircle2; className: string; emoji: string }> = {
  pending:   { label: "Pendiente",     icon: Hourglass,    emoji: "⏳", className: "bg-amber-100 text-amber-700 border-amber-200" },
  confirmed: { label: "En Preparación", icon: ChefHat,     emoji: "👩‍🍳", className: "bg-rose-500 text-white border-rose-500" },
  ready:     { label: "Listo",         icon: PackageCheck, emoji: "📦", className: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  paid:      { label: "Entregado",     icon: CheckCircle2, emoji: "✅", className: "bg-amber-50 text-amber-700 border-amber-100" },
  cancelled: { label: "Cancelado",     icon: XCircle,      emoji: "❌", className: "bg-rose-50 text-rose-700 border-rose-100" },
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
  customer_phone: string | null;
  delivery_phone: string | null;
  user_name: string | null;
  order_type: string;
  status: string;
  branch_id: string | null;
  cash_session_id: string | null;
  created_at: string;
  notes: string | null;
  delivery_address: string | null;
  table_id: string | null;
  sale_items: Item[];
}

function shortTicket(n: number) {
  // #ABCDEF hex-like short ID based on ticket number
  return "#" + n.toString(16).toUpperCase().padStart(5, "0").slice(-6);
}

function formatTimeShort(iso: string) {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "p.m." : "a.m.";
  h = h % 12 || 12;
  return `${day} ${month}, ${h.toString().padStart(2, "0")}:${m} ${ap}`;
}

function TodosPedidosPage() {
  const { isAdmin, loading: authLoading, rolesLoading } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const { session: cashSession } = useBranchCashSession(activeBranchId);

  const [turnoActual, setTurnoActual] = useState(true);
  const [dateFilter, setDateFilter] = useState<"todos" | "hoy" | "ayer" | "personalizada">("hoy");
  const todayIso = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState<string>(todayIso);
  const [customTo, setCustomTo] = useState<string>(todayIso);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Tables lookup for "Mesa N" label
  const { data: tables = [] } = useQuery({
    queryKey: ["tables-lookup", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("restaurant_tables")
        .select("id,number")
        .eq("branch_id", activeBranchId!);
      return (data ?? []) as { id: string; number: number }[];
    },
  });
  const tableNumberById = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tables) m.set(t.id, t.number);
    return m;
  }, [tables]);

  const { data: sales = [], isFetching, refetch } = useQuery({
    queryKey: [
      "todos-pedidos", activeBranchId,
      turnoActual ? cashSession?.id ?? "no-session" : "all",
      dateFilter,
      dateFilter === "personalizada" ? `${customFrom}_${customTo}` : "",
    ],
    enabled: !!activeBranchId && isAdmin,
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("id,ticket_number,total,subtotal,payment_method,customer_name,customer_phone,delivery_phone,user_name,order_type,status,branch_id,cash_session_id,created_at,notes,delivery_address,table_id,sale_items(id,product_name,qty,unit_price,subtotal,modifiers)")
        .eq("branch_id", activeBranchId!)
        .order("created_at", { ascending: false })
        .limit(500);

      if (turnoActual) {
        if (!cashSession?.id) return [];
        q = q.eq("cash_session_id", cashSession.id);
      }
      if (dateFilter !== "todos") {
        const now = new Date();
        let start: Date;
        let end: Date;
        if (dateFilter === "hoy") {
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          end = new Date(start.getTime() + 86400000);
        } else if (dateFilter === "ayer") {
          const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          start = new Date(t.getTime() - 86400000);
          end = t;
        } else {
          // personalizada
          const [fy, fm, fd] = customFrom.split("-").map(Number);
          const [ty, tm, td] = customTo.split("-").map(Number);
          start = new Date(fy, (fm ?? 1) - 1, fd ?? 1);
          const endBase = new Date(ty, (tm ?? 1) - 1, td ?? 1);
          end = new Date(endBase.getTime() + 86400000);
        }
        q = q.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Sale[];
    },
  });

  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!n) return true;
      const phones = [s.customer_phone, s.delivery_phone].filter(Boolean).join(" ");
      return (
        phones.toLowerCase().includes(n) ||
        String(s.ticket_number).includes(n) ||
        shortTicket(s.ticket_number).toLowerCase().includes(n) ||
        (s.customer_name ?? "").toLowerCase().includes(n)
      );
    });
  }, [sales, search, statusFilter]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function clearFilters() {
    setTurnoActual(true);
    setSoloHoy(false);
    setStatusFilter("all");
    setSearch("");
  }

  if (authLoading || rolesLoading) return <div className="p-6 text-muted-foreground">Cargando…</div>;
  if (!isAdmin) return <Navigate to="/" />;

  return (
    <div className="space-y-4 max-w-4xl mx-auto font-sans">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Todos los pedidos</h1>
          <p className="text-muted-foreground text-sm">
            Sede: <span className="font-semibold text-foreground">{activeBranch?.name ?? "—"}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Filtros */}
      <Card className="border-muted-foreground/10 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground font-medium">
              <Filter className="h-4 w-4" /> Filtros
            </div>
            <Button
              variant="ghost" size="sm"
              className="text-muted-foreground hover:text-foreground -mr-2 h-8"
              onClick={clearFilters}
            >
              <X className="h-4 w-4 mr-1" /> Limpiar
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={turnoActual}
                onCheckedChange={(v) => setTurnoActual(Boolean(v))}
                className="h-5 w-5"
              />
              <span className="text-base">Turno actual</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={soloHoy}
                onCheckedChange={(v) => setSoloHoy(Boolean(v))}
                className="h-5 w-5"
              />
              <span className="text-base">Hoy</span>
            </label>
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11">
              <SelectValue placeholder="Todos los estados" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Buscar por teléfono…"
              className="pl-9 h-11"
            />
          </div>
        </CardContent>
      </Card>

      <div className="text-muted-foreground text-sm px-1">
        {filtered.length} pedido(s)
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            Sin pedidos para los filtros seleccionados.
          </CardContent></Card>
        )}
        {filtered.map((s) => {
          const st = STATUS_META[s.status] ?? { label: s.status, className: "bg-muted", emoji: "", icon: CheckCircle2 };
          const typeMeta = TYPE_META[s.order_type] ?? { label: s.order_type, icon: ShoppingBag };
          const TypeIcon = typeMeta.icon;
          const typeLabel = s.order_type === "mesa" && s.table_id
            ? `Mesa ${tableNumberById.get(s.table_id) ?? ""}`.trim()
            : typeMeta.label;
          const isOpen = expanded.has(s.id);

          return (
            <Card key={s.id} className="overflow-hidden border-muted-foreground/10 shadow-sm">
              <Collapsible open={isOpen} onOpenChange={() => toggle(s.id)}>
                <CollapsibleTrigger asChild>
                  <button className="w-full text-left hover:bg-muted/40 transition-colors">
                    <div className="p-4 flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display text-xl font-bold text-rose-600 tracking-tight">
                            {shortTicket(s.ticket_number)}
                          </span>
                          <Badge variant="outline" className="rounded-full px-3 py-0.5 font-normal gap-1 border-muted-foreground/25">
                            <TypeIcon className="h-3.5 w-3.5" /> {typeLabel}
                          </Badge>
                        </div>
                        <div className="font-semibold text-foreground">
                          {s.customer_name ?? "Cliente POS"}
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTimeShort(s.created_at)}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="font-display text-lg font-bold">{formatMoney(s.total)}</div>
                        <Badge variant="outline" className={`rounded-full px-3 py-1 font-medium border ${st.className}`}>
                          <span className="mr-1">{st.emoji}</span>{st.label}
                        </Badge>
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </div>
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t p-4 bg-muted/20 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>Cajero: <span className="text-foreground">{s.user_name ?? "—"}</span></div>
                      <div>Pago: <span className="text-foreground">{s.payment_method ?? "—"}</span></div>
                      {(s.customer_phone || s.delivery_phone) && (
                        <div>Teléfono: <span className="text-foreground">{s.customer_phone ?? s.delivery_phone}</span></div>
                      )}
                      {s.delivery_address && (
                        <div className="col-span-2">Dirección: <span className="text-foreground">{s.delivery_address}</span></div>
                      )}
                    </div>
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
                    {s.notes && (
                      <div className="text-xs text-muted-foreground"><b>Notas:</b> {s.notes}</div>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t text-sm">
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
