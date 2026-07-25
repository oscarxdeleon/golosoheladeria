import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import { CancelSaleDialog } from "@/components/cancel-sale-dialog";
import {
  RefreshCw, ShoppingBag, UtensilsCrossed, Bike, Monitor, Globe,
  Hourglass, ChefHat, PackageCheck, XCircle, Trash2, LogOut, ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/pedidos-activos")({
  head: () => ({
    meta: [
      { title: "Pedidos activos · Goloso POS" },
      { name: "description", content: "Panel administrativo en tiempo real de pedidos activos" },
    ],
  }),
  component: PedidosActivosPage,
});

const TYPE_META: Record<string, { label: string; icon: typeof ShoppingBag; color: string }> = {
  mesa:      { label: "Mesa",       icon: UtensilsCrossed, color: "bg-blue-100 text-blue-700 border-blue-200" },
  llevar:    { label: "Llevar",     icon: ShoppingBag,     color: "bg-amber-100 text-amber-700 border-amber-200" },
  domicilio: { label: "Domicilio",  icon: Bike,            color: "bg-rose-100 text-rose-700 border-rose-200" },
  kiosko:    { label: "Autopedido", icon: Monitor,         color: "bg-violet-100 text-violet-700 border-violet-200" },
  online:    { label: "En línea",   icon: Globe,           color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

const STATUS_META: Record<string, { label: string; icon: typeof Hourglass; className: string }> = {
  pending:   { label: "Pendiente",   icon: Hourglass,    className: "bg-amber-100 text-amber-700 border-amber-200" },
  confirmed: { label: "En preparación", icon: ChefHat,   className: "bg-rose-500 text-white border-rose-500" },
  ready:     { label: "Listo",       icon: PackageCheck, className: "bg-indigo-100 text-indigo-700 border-indigo-200" },
};

interface Sale {
  id: string;
  ticket_number: number;
  total: number;
  order_type: string;
  status: string;
  user_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  table_id: string | null;
  branch_id: string | null;
  created_at: string;
  notes: string | null;
  payment_method: string | null;
}
interface TableRow { id: string; number: number; }

function PedidosActivosPage() {
  const qc = useQueryClient();
  const { isAdmin, roles, loading } = useAuth();
  const { activeBranchId } = useBranch();
  const canManage = isAdmin || roles.includes("supervisor");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cancelSale, setCancelSale] = useState<Sale | null>(null);
  const [deleteSale, setDeleteSale] = useState<Sale | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [releaseTable, setReleaseTable] = useState<{ tableId: string; number: number } | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releasing, setReleasing] = useState(false);

  const { data: sales = [], isFetching, refetch } = useQuery({
    queryKey: ["pedidos-activos", activeBranchId],
    enabled: !!activeBranchId,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Sale[]> => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,ticket_number,total,order_type,status,user_name,customer_name,customer_phone,delivery_phone,delivery_address,table_id,branch_id,created_at,notes,payment_method")
        .eq("branch_id", activeBranchId!)
        .in("status", ["pending", "confirmed", "ready"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Sale[];
    },
  });

  const { data: tables = [] } = useQuery({
    queryKey: ["tables-min", activeBranchId],
    enabled: !!activeBranchId,
    staleTime: 60_000,
    queryFn: async (): Promise<TableRow[]> => {
      const { data } = await supabase
        .from("restaurant_tables")
        .select("id,number")
        .eq("branch_id", activeBranchId!);
      return (data ?? []) as TableRow[];
    },
  });
  const tableMap = useMemo(
    () => Object.fromEntries(tables.map((t) => [t.id, t.number])),
    [tables],
  );

  // Realtime
  useEffect(() => {
    if (!activeBranchId) return;
    const ch = supabase
      .channel(`pedidos-activos-${activeBranchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${activeBranchId}` },
        () => qc.invalidateQueries({ queryKey: ["pedidos-activos", activeBranchId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeBranchId, qc]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (typeFilter !== "all" && s.order_type !== typeFilter) return false;
      if (!q) return true;
      return (
        String(s.ticket_number).includes(q) ||
        (s.customer_name ?? "").toLowerCase().includes(q) ||
        (s.customer_phone ?? "").includes(q) ||
        (s.delivery_phone ?? "").includes(q) ||
        (s.user_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [sales, typeFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: sales.length };
    for (const s of sales) c[s.order_type] = (c[s.order_type] ?? 0) + 1;
    return c;
  }, [sales]);

  if (loading) return null;
  if (!canManage) return <Navigate to="/" replace />;

  async function confirmDelete() {
    if (!deleteSale) return;
    if (deleteReason.trim().length < 3) return toast.error("Ingresa un motivo (mín. 3 caracteres)");
    setDeleting(true);
    const { error } = await supabase.rpc("admin_delete_sale", {
      _sale_id: deleteSale.id,
      _reason: deleteReason.trim(),
    });
    setDeleting(false);
    if (error) {
      const msg = error.message.includes("ROLE_FORBIDDEN")
        ? "Esta acción requiere autorización. Comunícate con un Administrador o Supervisor."
        : error.message;
      return toast.error(msg);
    }
    toast.success(`Pedido #${deleteSale.ticket_number} eliminado`);
    setDeleteSale(null);
    setDeleteReason("");
    qc.invalidateQueries({ queryKey: ["pedidos-activos", activeBranchId] });
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  async function confirmReleaseTable() {
    if (!releaseTable) return;
    if (releaseReason.trim().length < 3) return toast.error("Ingresa un motivo (mín. 3 caracteres)");
    setReleasing(true);
    const { error } = await supabase.rpc("release_table", {
      _table_id: releaseTable.tableId,
      _reason: releaseReason.trim(),
    });
    setReleasing(false);
    if (error) {
      const msg = error.message.includes("ROLE_FORBIDDEN")
        ? "Esta acción requiere autorización. Comunícate con un Administrador o Supervisor."
        : error.message;
      return toast.error(msg);
    }
    toast.success(`Mesa ${releaseTable.number} liberada`);
    setReleaseTable(null);
    setReleaseReason("");
    qc.invalidateQueries({ queryKey: ["pedidos-activos", activeBranchId] });
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Pedidos activos</h1>
          <p className="text-sm text-muted-foreground">
            Panel administrativo en tiempo real · {sales.length} pedido{sales.length === 1 ? "" : "s"} activo{sales.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            <span className="mr-1 h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            En vivo
          </Badge>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </header>

      {/* Filtros por tipo */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "all", label: "Todos" },
          ...Object.entries(TYPE_META).map(([k, v]) => ({ key: k, label: v.label })),
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTypeFilter(t.key)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              typeFilter === t.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            {t.label} <span className="ml-1 opacity-70">{counts[t.key] ?? 0}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Input
            placeholder="Buscar por ticket, cliente o mesero…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No hay pedidos activos con estos filtros.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const meta = TYPE_META[s.order_type] ?? TYPE_META.llevar;
            const st = STATUS_META[s.status] ?? STATUS_META.pending;
            const Icon = meta.icon;
            const StatusIcon = st.icon;
            const tableNumber = s.table_id ? tableMap[s.table_id] : null;
            return (
              <Card key={s.id} className="overflow-hidden">
                <div className={`flex items-center justify-between border-b px-3 py-2 ${meta.color}`}>
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon className="h-4 w-4" />
                    {meta.label}
                    {tableNumber && <span className="ml-1">· Mesa {tableNumber}</span>}
                  </div>
                  <Badge variant="outline" className={`${st.className} border`}>
                    <StatusIcon className="mr-1 h-3 w-3" />
                    {st.label}
                  </Badge>
                </div>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-baseline justify-between">
                    <div className="font-display text-xl font-black">#{s.ticket_number}</div>
                    <div className="font-display text-lg font-bold text-emerald-700">
                      {formatMoney(s.total)}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleString("es-CO", {
                      hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
                    })}
                    {s.user_name && ` · ${s.user_name}`}
                  </div>
                  {(s.customer_name || s.customer_phone || s.delivery_phone) && (
                    <div className="text-xs">
                      {s.customer_name && <div className="font-semibold">{s.customer_name}</div>}
                      {(s.customer_phone || s.delivery_phone) && (
                        <div className="text-muted-foreground">{s.customer_phone ?? s.delivery_phone}</div>
                      )}
                    </div>
                  )}
                  {s.delivery_address && (
                    <div className="text-xs text-muted-foreground">📍 {s.delivery_address}</div>
                  )}
                  {s.notes && (
                    <div className="rounded bg-amber-50 p-2 text-xs text-amber-900">
                      📝 {s.notes}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-700 border-rose-200 hover:bg-rose-50"
                      onClick={() => setCancelSale(s)}
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" /> Anular
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-rose-700 border-rose-200 hover:bg-rose-50"
                      onClick={() => { setDeleteSale(s); setDeleteReason(""); }}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar
                    </Button>
                    {s.table_id && tableNumber && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setReleaseTable({ tableId: s.table_id!, number: tableNumber });
                          setReleaseReason("");
                        }}
                      >
                        <LogOut className="mr-1 h-3.5 w-3.5" /> Liberar mesa
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Cancel Sale Dialog */}
      <CancelSaleDialog
        open={!!cancelSale}
        saleId={cancelSale?.id ?? undefined}
        ticketLabel={cancelSale?.ticket_number ? `#${cancelSale.ticket_number}` : null}
        onOpenChange={(v) => { if (!v) setCancelSale(null); }}
        onCancelled={() => {
          qc.invalidateQueries({ queryKey: ["pedidos-activos", activeBranchId] });
          qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
        }}
      />

      {/* Delete Sale Dialog */}
      <Dialog open={!!deleteSale} onOpenChange={(v) => { if (!v) setDeleteSale(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-600" />
              Eliminar pedido #{deleteSale?.ticket_number}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              ¿Está seguro de eliminar este pedido? Se registrará en la auditoría con tu usuario y rol.
              Si tiene una mesa asignada y no hay más pedidos activos en ella, se liberará automáticamente.
            </p>
            <div>
              <label className="text-xs font-semibold">Motivo</label>
              <Input
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Motivo de la eliminación (obligatorio)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteSale(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting || deleteReason.trim().length < 3}
            >
              {deleting ? "Eliminando…" : "Eliminar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Table Dialog */}
      <Dialog open={!!releaseTable} onOpenChange={(v) => { if (!v) setReleaseTable(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar Mesa {releaseTable?.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Se cancelarán los pedidos pendientes asociados a la mesa y quedará libre.
            </p>
            <Input
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              placeholder="Motivo (obligatorio)"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReleaseTable(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={confirmReleaseTable}
              disabled={releasing || releaseReason.trim().length < 3}
            >
              {releasing ? "Liberando…" : "Liberar mesa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
