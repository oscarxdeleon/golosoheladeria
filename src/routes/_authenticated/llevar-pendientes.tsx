import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Banknote, Clock, Search, ShoppingBag, X, Eye, AlertTriangle, RefreshCw,
} from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/llevar-pendientes")({
  head: () => ({
    meta: [
      { title: "Pedidos p/ llevar pendientes · Goloso POS" },
      { name: "description", content: "Administra los pedidos para llevar pendientes de pago y entrega." },
    ],
  }),
  component: LlevarPendientesPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="mx-auto max-w-lg p-6 text-center space-y-4">
        <h1 className="text-2xl font-display">No se pudo cargar la sección</h1>
        <p className="text-sm text-muted-foreground break-words">{error?.message}</p>
        <Button onClick={() => { reset(); router.invalidate(); }}>Reintentar</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">No encontrado</div>,
});

type StatusFilter = "todos" | "pending" | "paid" | "delivered" | "cancelled";

interface Sale {
  id: string;
  ticket_number: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  total: number;
  subtotal: number;
  status: string;
  payment_method: string | null;
  order_type: string | null;
  source: string | null;
  branch_id: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  sale_items: {
    id: string;
    product_name: string;
    qty: number;
    unit_price: number;
    subtotal: number;
    modifiers: unknown;
  }[];
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function minutesSince(d: string) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 60000);
}

function statusBadge(s: string) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pendiente", cls: "bg-amber-500 text-white" },
    confirmed: { label: "Confirmado", cls: "bg-blue-500 text-white" },
    ready: { label: "Listo", cls: "bg-indigo-500 text-white" },
    paid: { label: "Pagado", cls: "bg-emerald-600 text-white" },
    completed: { label: "Pagado", cls: "bg-emerald-600 text-white" },
    delivered: { label: "Entregado", cls: "bg-emerald-700 text-white" },
    cancelled: { label: "Cancelado", cls: "bg-red-600 text-white" },
  };
  const it = map[s] ?? { label: s, cls: "bg-slate-500 text-white" };
  return <Badge className={it.cls}>{it.label}</Badge>;
}

function LlevarPendientesPage() {
  const { activeBranchId } = useBranch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role, isAdmin } = usePermissions();
  const canCancel = isAdmin || role === "cajero";

  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Sale | null>(null);
  const [cancelling, setCancelling] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  const { data: orders = [], isFetching, refetch } = useQuery<Sale[]>({
    queryKey: ["llevar-pendientes", activeBranchId, filter],
    enabled: !!activeBranchId,
    refetchInterval: 5000,
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select(
          "id,ticket_number,created_at,customer_name,customer_phone,notes,total,subtotal,status,payment_method,order_type,source,branch_id,cancelled_at,cancellation_reason,sale_items(id,product_name,qty,unit_price,subtotal,modifiers)"
        )
        .eq("branch_id", activeBranchId!)
        .eq("order_type", "llevar")
        .order("created_at", { ascending: true })
        .limit(200);

      if (filter === "pending") {
        q = q.in("status", ["pending", "confirmed", "ready"]);
      } else if (filter === "paid") {
        q = q.in("status", ["paid", "completed"]);
      } else if (filter === "delivered") {
        q = q.eq("status", "delivered");
      } else if (filter === "cancelled") {
        q = q.eq("status", "cancelled");
      } else {
        // todos: últimas 24h para no cargar demasiado
        q = q.gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Sale[];
    },
  });

  // Realtime: invalidar al detectar cambios en ventas de esta sede
  useEffect(() => {
    if (!activeBranchId) return;
    const ch = supabase
      .channel(`llevar-pend-${activeBranchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${activeBranchId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["llevar-pendientes", activeBranchId] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeBranchId, qc]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((o) => {
      const t = `#${o.ticket_number}`.toLowerCase();
      const n = (o.customer_name ?? "").toLowerCase();
      const ph = (o.customer_phone ?? "").toLowerCase();
      return t.includes(term) || n.includes(term) || ph.includes(term);
    });
  }, [orders, search]);

  const counts = useMemo(() => {
    const c = { pending: 0, paid: 0, delivered: 0, cancelled: 0 };
    for (const o of orders) {
      if (["pending", "confirmed", "ready"].includes(o.status)) c.pending++;
      else if (["paid", "completed"].includes(o.status)) c.paid++;
      else if (o.status === "delivered") c.delivered++;
      else if (o.status === "cancelled") c.cancelled++;
    }
    return c;
  }, [orders]);

  function cobrar(o: Sale) {
    navigate({ to: "/pos", search: { type: "llevar", kioskSaleId: o.id } });
  }

  async function confirmCancel() {
    if (!cancelling) return;
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      toast.error("El motivo debe tener al menos 3 caracteres");
      return;
    }
    setCancelBusy(true);
    try {
      const { error } = await supabase.rpc("cancel_sale", {
        _sale_id: cancelling.id,
        _reason: reason,
      });
      if (error) throw error;
      toast.success(`Pedido #${cancelling.ticket_number} cancelado`);
      setCancelling(null);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["llevar-pendientes", activeBranchId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cancelar el pedido");
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div className="space-y-4 p-2 sm:p-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl leading-tight">Pedidos para llevar</h1>
            <p className="text-sm text-muted-foreground">Administra los pedidos pendientes de cobro y entrega.</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refrescar
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
              <TabsList>
                <TabsTrigger value="pending">
                  Pendientes <Badge className="ml-2 bg-amber-500 text-white">{counts.pending}</Badge>
                </TabsTrigger>
                <TabsTrigger value="paid">
                  Pagados <Badge className="ml-2 bg-emerald-600 text-white">{counts.paid}</Badge>
                </TabsTrigger>
                <TabsTrigger value="delivered">
                  Entregados <Badge className="ml-2 bg-emerald-700 text-white">{counts.delivered}</Badge>
                </TabsTrigger>
                <TabsTrigger value="cancelled">
                  Cancelados <Badge className="ml-2 bg-red-600 text-white">{counts.cancelled}</Badge>
                </TabsTrigger>
                <TabsTrigger value="todos">Todos</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative ml-auto w-full sm:w-72">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar # pedido, cliente, teléfono"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="py-14 text-center text-muted-foreground">
              <ShoppingBag className="mx-auto h-10 w-10 opacity-50 mb-2" />
              No hay pedidos {filter === "pending" ? "pendientes" : "en este filtro"}.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((o) => {
                const mins = minutesSince(o.created_at);
                const isPending = ["pending", "confirmed", "ready"].includes(o.status);
                const late = isPending && mins >= 20;
                return (
                  <div
                    key={o.id}
                    className={`rounded-xl border bg-card p-3 shadow-sm transition hover:shadow-md ${
                      late ? "border-red-400 bg-red-50/40 dark:bg-red-950/10" : ""
                    }`}
                  >
                    {/* Encabezado: # pedido grande + estado a la derecha */}
                    <div className="flex items-center justify-between gap-2 border-b pb-2 mb-2">
                      <div className="font-display text-4xl leading-none text-amber-600">
                        #{o.ticket_number}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {statusBadge(o.status)}
                        {late && (
                          <Badge className="bg-red-600 text-white gap-1 text-[10px] px-1.5 py-0">
                            <AlertTriangle className="h-3 w-3" /> {mins} min
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="text-sm font-medium truncate">
                      {o.customer_name || "Sin nombre"}
                      {o.customer_phone ? ` · ${o.customer_phone}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(o.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })} · {timeAgo(o.created_at)}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-1">
                      {o.sale_items.map((i) => `${i.qty}× ${i.product_name}`).join(" · ") || "Sin ítems"}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="font-display text-xl text-primary">{formatMoney(o.total)}</div>
                      {!isPending && o.payment_method && (
                        <Badge variant="outline" className="text-xs">{o.payment_method}</Badge>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDetail(o)}>
                        <Eye className="h-4 w-4 mr-1" /> Ver
                      </Button>
                      {isPending ? (
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => cobrar(o)}>
                          <Banknote className="h-4 w-4 mr-1" /> Cobrar
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" disabled>
                          <Banknote className="h-4 w-4 mr-1" /> Cobrado
                        </Button>
                      )}
                      {canCancel && isPending ? (
                        <Button size="sm" variant="destructive" onClick={() => { setCancelling(o); setCancelReason(""); }}>
                          <X className="h-4 w-4 mr-1" /> Cancelar
                        </Button>
                      ) : (
                        <span />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detalle */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>Pedido #{detail.ticket_number}</DialogTitle>
                <DialogDescription>
                  {new Date(detail.created_at).toLocaleString("es-CO")} · {timeAgo(detail.created_at)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  {statusBadge(detail.status)}
                  {detail.payment_method && <Badge variant="outline">{detail.payment_method}</Badge>}
                </div>
                {(detail.customer_name || detail.customer_phone) && (
                  <div>
                    <span className="text-muted-foreground">Cliente: </span>
                    {detail.customer_name || "—"}
                    {detail.customer_phone ? ` · ${detail.customer_phone}` : ""}
                  </div>
                )}
                <div className="border-t pt-2 space-y-1">
                  {detail.sale_items.map((it) => {
                    const mods = Array.isArray(it.modifiers) ? (it.modifiers as { name?: string; qty?: number }[]) : [];
                    return (
                      <div key={it.id} className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate">
                            <span className="font-medium">{it.qty}×</span> {it.product_name}
                          </div>
                          {mods.length > 0 && (
                            <div className="text-xs text-muted-foreground pl-4">
                              {mods.map((m, i) => (
                                <div key={i}>+ {m.qty ?? 1}× {m.name ?? "Mod."}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="font-mono text-right shrink-0">{formatMoney(it.subtotal)}</div>
                      </div>
                    );
                  })}
                </div>
                {detail.notes && (
                  <div className="border rounded-md p-2 text-xs bg-muted/40">
                    <span className="font-semibold">Notas:</span> {detail.notes}
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between font-display text-lg">
                  <span>TOTAL</span>
                  <span className="text-primary">{formatMoney(detail.total)}</span>
                </div>
                {detail.status === "cancelled" && detail.cancellation_reason && (
                  <div className="border border-red-300 rounded-md p-2 text-xs bg-red-50 dark:bg-red-950/20">
                    <span className="font-semibold text-red-700">Motivo cancelación:</span> {detail.cancellation_reason}
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setDetail(null)}>Cerrar</Button>
                {["pending", "confirmed", "ready"].includes(detail.status) && (
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { const s = detail; setDetail(null); cobrar(s); }}>
                    <Banknote className="h-4 w-4 mr-1" /> Cobrar
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancelar */}
      <Dialog open={!!cancelling} onOpenChange={(o) => { if (!o) { setCancelling(null); setCancelReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar pedido #{cancelling?.ticket_number}</DialogTitle>
            <DialogDescription>Ingresa el motivo de la cancelación (obligatorio).</DialogDescription>
          </DialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Motivo…"
            rows={3}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelling(null)} disabled={cancelBusy}>Volver</Button>
            <Button variant="destructive" onClick={confirmCancel} disabled={cancelBusy}>
              {cancelBusy ? "Cancelando…" : "Confirmar cancelación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
