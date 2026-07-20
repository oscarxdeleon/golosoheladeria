import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/format";
import { Receipt, Printer, ChefHat, Search, RefreshCw, Ban, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  printComanda, printTicketFinal, type Branding,
} from "@/components/pos-screen";
import { normalizeModifiers, composeDeliveryAddress } from "@/lib/print-client";
import { useAuth } from "@/hooks/use-auth";
import { cancelSaleRequest } from "@/lib/sales-cancellation";

export const Route = createFileRoute("/_authenticated/historial")({
  head: () => ({ meta: [{ title: "Historial de pedidos · Goloso POS" }] }),
  component: HistorialPage,
});

const CANCEL_REASON_PRESETS = [
  "Cliente desistió del pedido",
  "Pedido registrado por error",
  "Cliente no realizó el pago",
  "Pedido duplicado",
  "Error del cajero",
  "Producto no disponible",
];

type OrderType = "mesa" | "llevar" | "domicilio" | "kiosko" | "online" | string;

interface SaleRow {
  id: string;
  ticket_number: number;
  total: number;
  subtotal: number | null;
  tax: number | null;
  delivery_fee: number | null;
  payment_method: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  user_name: string | null;
  notes: string | null;
  order_type: OrderType;
  status: string | null;
  source: string | null;
  branch_id: string | null;
  created_at: string;
  cancelled_at?: string | null;
  cancelled_by_name?: string | null;
  cancellation_reason?: string | null;
  cancellation_previous_status?: string | null;
}

interface SaleItem {
  product_name: string;
  qty: number;
  unit_price: number;
  modifiers?: unknown;
}

const TYPE_LABEL: Record<string, string> = {
  mesa: "Mesa",
  llevar: "Para llevar",
  domicilio: "A domicilio",
  kiosko: "Autopedido",
  online: "En línea",
};

function HistorialPage() {
  const { isAdmin, primaryRole } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "cancelled">("active");
  const [days, setDays] = useState<string>("7");
  const [selected, setSelected] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SaleRow | null>(null);

  const { data: sales = [], refetch, isFetching } = useQuery({
    queryKey: ["sales-history", days],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select(
          "id,ticket_number,total,subtotal,tax,delivery_fee,payment_method,customer_name,customer_phone,delivery_address,delivery_neighborhood,user_name,notes,order_type,status,source,branch_id,created_at,cancelled_at,cancelled_by_name,cancellation_reason,cancellation_previous_status",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (days !== "all") {
        const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
        q = q.gte("created_at", since);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SaleRow[];
    },
  });

  const filtered = useMemo(() => {
    return sales.filter((s) => {
      if (typeFilter !== "all" && (s.order_type ?? "") !== typeFilter) return false;
      if (statusFilter === "active" && s.status === "cancelled") return false;
      if (statusFilter === "cancelled" && s.status !== "cancelled") return false;
      if (!search.trim()) return true;
      const needle = search.toLowerCase();
      return (
        String(s.ticket_number).includes(needle) ||
        (s.customer_name ?? "").toLowerCase().includes(needle) ||
        (s.customer_phone ?? "").toLowerCase().includes(needle) ||
        (s.user_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [sales, search, typeFilter, statusFilter]);

  const totalSum = filtered
    .filter((x) => x.status !== "cancelled")
    .reduce((s, x) => s + Number(x.total ?? 0), 0);
  const cancelledCount = filtered.filter((x) => x.status === "cancelled").length;

  function canCancel(sale: SaleRow): boolean {
    if (sale.status === "cancelled") return false;
    if (primaryRole === "supervisor" || primaryRole === "mesero" || primaryRole === "domiciliario") return false;
    if (sale.status === "paid" && !isAdmin) return false;
    return isAdmin || primaryRole === "cajero";
  }


  async function reprintSale(saleId: string, kind: "comanda" | "ticket") {
    const t = toast.loading(kind === "comanda" ? "Reimprimiendo comanda…" : "Reimprimiendo ticket…");
    try {
      const { data: sale, error } = await supabase.from("sales").select("*").eq("id", saleId).single();
      if (error || !sale) throw error ?? new Error("Venta no encontrada");
      const { data: items } = await supabase
        .from("sale_items")
        .select("product_name,qty,unit_price,modifiers")
        .eq("sale_id", saleId);
      const { data: settings } = await supabase
        .from("settings")
        .select("business_name,nit,address,phone,logo_url,ticket_header,ticket_footer,ticket_config")

        .maybeSingle();
      let branch: Record<string, unknown> | null = null;
      if (sale.branch_id) {
        const { data: b } = await supabase
          .from("branches")
          .select("name,nit,address,neighborhood,phone,email,logo_url,ticket_header,ticket_footer")
          .eq("id", sale.branch_id)
          .maybeSingle();
        branch = (b ?? null) as Record<string, unknown> | null;
      }
      const branding: Branding = {
        business_name: (branch?.name as string) || settings?.business_name || "Heladería Goloso",
        nit: (branch?.nit as string | null) ?? settings?.nit ?? null,
        address:
          [branch?.address, branch?.neighborhood].filter(Boolean).join(" · ") ||
          settings?.address ||
          null,
        phone: (branch?.phone as string | null) ?? settings?.phone ?? null,
        email: (branch?.email as string | null) ?? null,
        logo_url: (branch?.logo_url as string | null) ?? settings?.logo_url ?? null,
        ticket_header: (branch?.ticket_header as string | null) ?? settings?.ticket_header ?? null,
        ticket_footer: (branch?.ticket_footer as string | null) ?? settings?.ticket_footer ?? null,
        ticket_config: (settings?.ticket_config as Record<string, unknown> | null) ?? null,
      };

      const its = (items ?? []).map((i) => ({
        name: i.product_name,
        qty: Number(i.qty),
        unit_price: Number(i.unit_price),
        modifiers: normalizeModifiers((i as { modifiers?: unknown }).modifiers),
      }));
      const header = TYPE_LABEL[sale.order_type] ?? sale.order_type ?? "Pedido";
      if (kind === "comanda") {
        const args = {
          ticket: sale.ticket_number,
          header,
          items: its.map((i) => ({ name: i.name, qty: i.qty, modifiers: i.modifiers })),
          customer: sale.customer_name ?? "",
          notes: sale.notes ?? "",
          address: composeDeliveryAddress(sale.delivery_address, sale.delivery_neighborhood),
          phone: sale.customer_phone ?? "",
          user_name: sale.user_name ?? "",
          created_at: sale.created_at,
          branding,
        };
        const result = await printComanda(args, { saleId });
        if (result.ok) {
          toast.success("Comanda enviada", { id: t });
          void supabase.rpc("log_reimpression", { _sale_id: saleId, _kind: "comanda" });
        } else if (result.queued) {
          toast.info("Reimpresión en cola — se procesará en el POS", { id: t });
        } else toast.warning("No se pudo imprimir: revisa el servidor local", { id: t });
      } else {
        const args = {
          ticket: sale.ticket_number,
          header,
          items: its,
          subtotal: Number(sale.subtotal ?? sale.total),
          tax: Number(sale.tax ?? 0),
          deliveryFee: Number(sale.delivery_fee ?? 0),
          total: Number(sale.total ?? 0),
          payment_method: sale.payment_method ?? "—",
          customer: sale.customer_name ?? "",
          user_name: sale.user_name ?? "",
          created_at: sale.created_at,
          address: composeDeliveryAddress(sale.delivery_address, sale.delivery_neighborhood),
          phone: sale.customer_phone ?? "",
          cash_received: Number(sale.total ?? 0),
          notes: sale.notes ?? "",
          branding,
        };
        await printTicketFinal(args);
        toast.success("Ticket enviado", { id: t });
        void supabase.rpc("log_reimpression", { _sale_id: saleId, _kind: "ticket" });
      }
    } catch (e) {
      console.error(e);
      toast.error("No se pudo reimprimir", { id: t });
    }
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Historial de pedidos</h1>
          <p className="text-muted-foreground">
            {filtered.length} pedidos · {formatMoney(totalSum)} válidos
            {cancelledCount > 0 && ` · ${cancelledCount} anulado(s)`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por # ticket, cliente, teléfono o cajero…"
              className="pl-8"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              <SelectItem value="mesa">Mesa</SelectItem>
              <SelectItem value="llevar">Para llevar</SelectItem>
              <SelectItem value="domicilio">A domicilio</SelectItem>
              <SelectItem value="kiosko">Autopedido</SelectItem>
              <SelectItem value="online">En línea</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "active" | "cancelled")}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Solo válidos</SelectItem>
              <SelectItem value="cancelled">Solo anulados</SelectItem>
              <SelectItem value="all">Todos los estados</SelectItem>
            </SelectContent>
          </Select>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Hoy / 24h</SelectItem>
              <SelectItem value="7">Últimos 7 días</SelectItem>
              <SelectItem value="30">Últimos 30 días</SelectItem>
              <SelectItem value="90">Últimos 90 días</SelectItem>
              <SelectItem value="all">Todo</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Cajero</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => {
                const isCancelled = s.status === "cancelled";
                return (
                <TableRow key={s.id} className={isCancelled ? "opacity-70" : undefined}>
                  <TableCell className="font-mono">#{s.ticket_number}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(s.created_at)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{TYPE_LABEL[s.order_type] ?? s.order_type ?? "—"}</Badge>
                  </TableCell>
                  <TableCell>{s.customer_name ?? "—"}</TableCell>
                  <TableCell>{s.user_name ?? "—"}</TableCell>
                  <TableCell>
                    {isCancelled ? (
                      <Badge variant="destructive" title={s.cancellation_reason ?? undefined}>
                        Anulado
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{s.status ?? "—"}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{s.payment_method ?? "—"}</TableCell>
                  <TableCell className={`text-right font-medium ${isCancelled ? "line-through text-muted-foreground" : ""}`}>
                    {formatMoney(s.total)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        size="sm"
                        className="bg-amber-500 hover:bg-amber-600 text-white"
                        onClick={() => reprintSale(s.id, "comanda")}
                      >
                        <ChefHat className="h-4 w-4 mr-1" /> Comanda
                      </Button>
                      <Button size="sm" onClick={() => reprintSale(s.id, "ticket")}>
                        <Printer className="h-4 w-4 mr-1" /> Ticket
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(s.id)}>
                        <Receipt className="h-4 w-4 mr-1" /> Ver
                      </Button>
                      {canCancel(s) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => setCancelTarget(s)}
                        >
                          <Ban className="h-4 w-4 mr-1" /> Anular
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                    Sin pedidos para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SaleDetailDialog saleId={selected} onClose={() => setSelected(null)} />
      <CancelSaleDialog
        sale={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCancelled={() => {
          setCancelTarget(null);
          void queryClient.invalidateQueries({ queryKey: ["sales-history"] });
          void queryClient.invalidateQueries({ queryKey: ["sales"] });
          void queryClient.invalidateQueries({ queryKey: ["tables"] });
          void queryClient.invalidateQueries({ queryKey: ["inventory"] });
        }}
      />
    </div>
  );
}

function CancelSaleDialog({
  sale, onClose, onCancelled,
}: {
  sale: SaleRow | null;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = reason.trim();
  const valid = trimmed.length >= 5;
  const wasPaid = sale?.status === "paid";

  // Reset reason when opening for a new sale
  const key = sale?.id ?? null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (key !== lastKey) {
    setLastKey(key);
    setReason("");
    setSubmitting(false);
  }

  async function handleConfirm() {
    if (!sale || !valid || submitting) return;
    setSubmitting(true);
    const t = toast.loading("Anulando pedido…");
    try {
      const res = await cancelSaleRequest({ saleId: sale.id, reason: trimmed });
      if (res.already_cancelled) {
        toast.info("Este pedido ya estaba anulado", { id: t });
      } else {
        toast.success(
          `Pedido #${sale.ticket_number} anulado${res.table_released ? " · Mesa liberada" : ""}`,
          { id: t },
        );
      }
      onCancelled();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "No se pudo anular el pedido", { id: t });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Anular pedido {sale ? `#${sale.ticket_number}` : ""}
          </DialogTitle>
          <DialogDescription>
            Este pedido quedará marcado como <b>anulado</b> y no será contabilizado como una venta válida.
            {wasPaid && (
              <span className="block mt-2 text-destructive font-medium">
                ⚠ Este pedido ya fue pagado. Solo el administrador puede anularlo. Recuerda registrar la reversión del pago.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {sale && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Tipo</span><span>{TYPE_LABEL[sale.order_type] ?? sale.order_type}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><span>{sale.customer_name ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-semibold">{formatMoney(sale.total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Estado actual</span><span>{sale.status ?? "—"}</span></div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo de la anulación *</label>
            <div className="flex flex-wrap gap-1">
              {CANCEL_REASON_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setReason(p)}
                  className="text-xs px-2 py-1 rounded-full border hover:bg-muted transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Escribe por qué se anula este pedido (mín. 5 caracteres)…"
              rows={3}
              maxLength={500}
              autoFocus
            />
            <div className="text-xs text-muted-foreground">
              {trimmed.length}/500 · El motivo quedará registrado en auditoría.
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Volver
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!valid || submitting}>
            {submitting ? "Anulando…" : "Confirmar anulación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaleDetailDialog({ saleId, onClose }: { saleId: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["sale-detail-history", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const { data: sale } = await supabase.from("sales").select("*").eq("id", saleId!).single();
      const { data: items } = await supabase
        .from("sale_items")
        .select("product_name,qty,unit_price,modifiers")
        .eq("sale_id", saleId!);
      let branding: Branding | null = null;
      const { data: settings } = await supabase
        .from("settings")
        .select("business_name,nit,address,phone,logo_url,ticket_header,ticket_footer,ticket_config")
        .maybeSingle();
      type BranchInfo = {
        name?: string; nit?: string | null; address?: string | null; neighborhood?: string | null;
        phone?: string | null; email?: string | null; logo_url?: string | null;
        ticket_header?: string | null; ticket_footer?: string | null;
      };
      let branch: BranchInfo | null = null;
      if (sale?.branch_id) {
        const { data: b } = await supabase
          .from("branches")
          .select("name,nit,address,neighborhood,phone,email,logo_url,ticket_header,ticket_footer")
          .eq("id", sale.branch_id)
          .maybeSingle();
        branch = (b ?? null) as BranchInfo | null;
      }
      branding = {
        business_name: branch?.name || settings?.business_name || "Heladería Goloso",
        nit: branch?.nit ?? settings?.nit ?? null,
        address:
          [branch?.address, branch?.neighborhood].filter(Boolean).join(" · ") ||
          settings?.address ||
          null,
        phone: branch?.phone ?? settings?.phone ?? null,
        email: branch?.email ?? null,
        logo_url: branch?.logo_url ?? settings?.logo_url ?? null,
        ticket_header: branch?.ticket_header ?? settings?.ticket_header ?? null,
        ticket_footer: branch?.ticket_footer ?? settings?.ticket_footer ?? null,
        ticket_config: (settings as { ticket_config?: Record<string, unknown> | null } | null)?.ticket_config ?? null,
      };

      return { sale, items: (items ?? []) as SaleItem[], branding };
    },
  });

  const sale = data?.sale as SaleRow | undefined;
  const items = data?.items ?? [];
  const branding = data?.branding ?? undefined;

  function buildTicketArgs() {
    if (!sale) return null;
    const subtotal = Number(sale.subtotal ?? sale.total);
    return {
      ticket: sale.ticket_number,
      header: TYPE_LABEL[sale.order_type] ?? sale.order_type ?? "Pedido",
      items: items.map((i) => ({
        name: i.product_name,
        qty: Number(i.qty),
        unit_price: Number(i.unit_price),
      })),
      subtotal,
      tax: Number(sale.tax ?? 0),
      deliveryFee: Number(sale.delivery_fee ?? 0),
      total: Number(sale.total ?? 0),
      payment_method: sale.payment_method ?? "—",
      customer: sale.customer_name ?? "",
      user_name: sale.user_name ?? "",
      created_at: sale.created_at,
      address: sale.delivery_address ?? "",
      phone: sale.customer_phone ?? "",
      cash_received: Number(sale.total ?? 0),
      notes: sale.notes ?? "",
      branding,
    };
  }

  function buildComandaArgs() {
    if (!sale) return null;
    return {
      ticket: sale.ticket_number,
      header: TYPE_LABEL[sale.order_type] ?? sale.order_type ?? "Pedido",
      items: items.map((i) => ({ name: i.product_name, qty: Number(i.qty) })),
      customer: sale.customer_name ?? "",
      notes: sale.notes ?? "",
      address: sale.delivery_address ?? "",
      phone: sale.customer_phone ?? "",
      user_name: sale.user_name ?? "",
      created_at: sale.created_at,
      order_type: sale.order_type ?? undefined,
      branding,
    };
  }


  async function handleReprintTicket() {
    const args = buildTicketArgs();
    if (!args) return;
    try {
      await printTicketFinal(args);
      toast.success("Ticket enviado a impresora");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo imprimir: revisa el servidor local");
    }
  }

  async function handleReprintComanda() {
    const args = buildComandaArgs();
    if (!args) return;
    const result = await printComanda(args);
    if (result.ok) toast.success("Comanda enviada a cocina");
    else if (result.queued) toast.info("Reimpresión en cola — se procesará en el POS");
    else toast.warning("No se pudo imprimir: revisa el servidor local");
  }

  return (
    <Dialog open={!!saleId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Pedido #{sale?.ticket_number ?? "—"}
          </DialogTitle>
          <DialogDescription>
            {sale ? formatDate(sale.created_at) : ""} · {sale?.user_name ?? ""}
          </DialogDescription>
        </DialogHeader>

        {sale && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{TYPE_LABEL[sale.order_type] ?? sale.order_type}</Badge>
                <Badge variant="secondary">{sale.payment_method ?? "—"}</Badge>
                {sale.status && <Badge>{sale.status}</Badge>}
              </div>
              <div><span className="text-muted-foreground">Cliente:</span> {sale.customer_name ?? "Mostrador"}</div>
              {sale.customer_phone && <div><span className="text-muted-foreground">Teléfono:</span> {sale.customer_phone}</div>}
              {sale.delivery_address && <div><span className="text-muted-foreground">Dirección:</span> {sale.delivery_address}</div>}
              {sale.delivery_neighborhood && <div><span className="text-muted-foreground">Barrio:</span> {sale.delivery_neighborhood}</div>}
              {sale.notes && (
                <div className="rounded-lg border bg-muted/40 p-2">
                  <div className="text-xs text-muted-foreground">Notas</div>
                  <div className="whitespace-pre-line">{sale.notes}</div>
                </div>
              )}
            </div>
            <div className="rounded-lg border">
              <div className="px-3 py-2 text-sm font-medium border-b">Productos</div>
              <div className="max-h-72 overflow-auto">
                <Table>
                  <TableBody>
                    {items.map((i, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="w-10 text-right font-medium">{Number(i.qty)}×</TableCell>
                        <TableCell>{i.product_name}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {formatMoney(Number(i.unit_price) * Number(i.qty))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-1 border-t px-3 py-2 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(Number(sale.subtotal ?? sale.total))}</span></div>
                {Number(sale.tax ?? 0) > 0 && (
                  <div className="flex justify-between"><span>Impuesto</span><span>{formatMoney(Number(sale.tax))}</span></div>
                )}
                {Number(sale.delivery_fee ?? 0) > 0 && (
                  <div className="flex justify-between"><span>Domicilio</span><span>{formatMoney(Number(sale.delivery_fee))}</span></div>
                )}
                <div className="flex justify-between font-semibold text-base pt-1 border-t">
                  <span>Total</span><span>{formatMoney(Number(sale.total))}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleReprintComanda} disabled={!sale}>
              <ChefHat className="h-4 w-4 mr-2" /> Reimprimir comanda
            </Button>
            <Button onClick={handleReprintTicket} disabled={!sale}>
              <Printer className="h-4 w-4 mr-2" /> Reimprimir ticket
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
