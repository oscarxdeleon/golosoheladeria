import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBranch } from "@/contexts/branch-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Bike, Phone, MapPin, Home, CheckCircle2, Truck, MessageCircle, Search, Banknote, CalendarDays, UserRound } from "lucide-react";
import { toast } from "sonner";
import { formatMoney, formatDate } from "@/lib/format";
import { buildCourierMessage, openWhatsAppTo } from "@/lib/courier-whatsapp";
import { PaymentInfoBlock } from "@/components/payment-info-block";

export const Route = createFileRoute("/_authenticated/domicilios")({
  head: () => ({ meta: [{ title: "Despacho domicilios · Goloso POS" }] }),
  component: DespachoDomiciliosPage,
});

interface Courier { id: string; name: string; phone: string; active: boolean; branch_id: string | null }

interface DeliverySale {
  id: string;
  ticket_number: number;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  total: number;
  payment_method: string;
  payment_details: Record<string, unknown> | null;
  delivery_status: string | null;
  delivery_user_id: string | null;
  courier_id: string | null;
  status: string;
  created_at: string;
  notes: string | null;
  branch_id: string | null;
}

function DespachoDomiciliosPage() {
  const { user, isAdmin } = useAuth();
  const { activeBranchId } = useBranch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");

  const { data = [] } = useQuery({
    queryKey: ["delivery-dispatch", activeBranchId, user?.id, isAdmin],
    enabled: !!user && !!activeBranchId,
    queryFn: async (): Promise<DeliverySale[]> => {
      let q = supabase
        .from("sales")
        .select("id,ticket_number,customer_name,customer_phone,delivery_address,delivery_neighborhood,total,payment_method,payment_details,delivery_status,delivery_user_id,courier_id,status,created_at,notes,source,branch_id")
        .eq("branch_id", activeBranchId!)
        .eq("order_type", "domicilio")
        .in("status", ["pending", "confirmed", "ready"])
        .or("source.is.null,source.neq.online_menu")
        .order("created_at", { ascending: false })
        .limit(300);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DeliverySale[];
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!activeBranchId) return;
    const ch = supabase
      .channel(`delivery-dispatch-${activeBranchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${activeBranchId}` }, (payload) => {
        const row = (payload.new ?? payload.old) as { order_type?: string | null } | null;
        if (row?.order_type === "domicilio") qc.invalidateQueries({ queryKey: ["delivery-dispatch", activeBranchId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeBranchId, qc]);

  const { data: couriers = [] } = useQuery({
    queryKey: ["couriers", "active"],
    queryFn: async () => {
      const { data } = await supabase.from("couriers").select("id,name,phone,active,branch_id").eq("active", true).order("name");
      return (data ?? []) as Courier[];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["settings-business"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("business_name,nequi_number,bancolombia_account").maybeSingle();
      return data as { business_name?: string; nequi_number?: string; bancolombia_account?: string } | null;
    },
  });

  async function assignCourier(sale: DeliverySale, courierId: string) {
    const patch: Record<string, unknown> = { courier_id: courierId || null };
    if (!isAdmin && user && !sale.delivery_user_id) patch.delivery_user_id = user.id;
    if (courierId && !sale.delivery_status) patch.delivery_status = "asignado";
    const { error } = await supabase.from("sales").update(patch as never).eq("id", sale.id);
    if (error) return toast.error(error.message);
    toast.success(courierId ? "Repartidor asignado" : "Asignación quitada");
    qc.invalidateQueries({ queryKey: ["delivery-dispatch", activeBranchId] });
  }

  function sendWhatsAppTo(sale: DeliverySale, courier: Courier) {
    const msg = buildCourierMessage(
      { ...sale, payment_details: sale.payment_details ?? {} },
      { name: settings?.business_name ?? null, nequi_number: settings?.nequi_number ?? null, bancolombia_account: settings?.bancolombia_account ?? null },
    );
    openWhatsAppTo(courier.phone, msg);
  }

  async function markEnCamino(sale: DeliverySale) {
    const courier = couriers.find((c) => c.id === sale.courier_id);
    if (!courier) {
      toast.error("Asigna un repartidor antes de marcar En camino");
      return;
    }
    const patch: Record<string, unknown> = { delivery_status: "en_camino" };
    if (!isAdmin && user) patch.delivery_user_id = user.id;
    const { error } = await supabase.from("sales").update(patch as never).eq("id", sale.id);
    if (error) return toast.error(error.message);
    sendWhatsAppTo(sale, courier);
    toast.success(`Enviando pedido a ${courier.name} por WhatsApp`);
    qc.invalidateQueries({ queryKey: ["delivery-dispatch", activeBranchId] });
  }

  async function markEntregado(id: string) {
    const patch: Record<string, unknown> = { delivery_status: "entregado" };
    if (!isAdmin && user) patch.delivery_user_id = user.id;
    const { error } = await supabase.from("sales").update(patch as never).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido entregado");
    qc.invalidateQueries({ queryKey: ["delivery-dispatch", activeBranchId] });
  }

  const courierName = (id: string | null) => couriers.find((c) => c.id === id)?.name ?? "";
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = data.filter((d) => {
    const deliveryState = d.delivery_status ?? "pendiente";
    if (statusFilter === "mis-asignados" && d.delivery_user_id !== user?.id) return false;
    if (statusFilter !== "todos" && statusFilter !== "mis-asignados" && deliveryState !== statusFilter) return false;
    if (!normalizedSearch) return true;
    const haystack = [
      String(d.ticket_number),
      d.customer_name,
      d.customer_phone,
      d.delivery_address,
      d.delivery_neighborhood,
      d.payment_method,
      d.status,
      deliveryState,
      courierName(d.courier_id),
      new Date(d.created_at).toLocaleDateString("es-CO"),
      formatDate(d.created_at),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedSearch);
  });
  const pending = filtered.filter((d) => d.delivery_status !== "entregado");
  const done = filtered.filter((d) => d.delivery_status === "entregado");

  function openForPayment(sale: DeliverySale) {
    navigate({ to: "/pos", search: { type: "domicilio", kioskSaleId: sale.id } });
  }

  return (
    <div className="space-y-4 premium-scope">
      <div className="flex items-center gap-3">
        <Bike className="h-7 w-7 text-primary" />
        <div>
          <h1 className="font-display text-3xl leading-tight">Despacho de domicilios</h1>
          <p className="text-sm text-muted-foreground">
            Asigna un repartidor y al marcar "En camino" se le envía el pedido por WhatsApp.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                placeholder="Buscar por pedido, cliente, teléfono, fecha, estado o domiciliario"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["todos", "Todos"],
                ["pendiente", "Pendientes"],
                ["asignado", "Asignados"],
                ["en_camino", "En camino"],
                ["mis-asignados", "Mis asignados"],
              ].map(([value, label]) => (
                <Button key={value} size="sm" variant={statusFilter === value ? "default" : "outline"} onClick={() => setStatusFilter(value)}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {couriers.length === 0 && (
        <Card><CardContent className="py-4 text-sm text-muted-foreground">
          No hay repartidores registrados. Ve a <b>Repartidores</b> en el menú lateral para agregarlos.
        </CardContent></Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Pendientes ({pending.length})</h2>
        {pending.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Sin pedidos pendientes</CardContent></Card>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {pending.map((s) => {
            const courier = couriers.find((c) => c.id === s.courier_id);
            const branchCouriers = couriers.filter((c) => !c.branch_id || c.branch_id === s.branch_id);
            return (
              <Card key={s.id} className="border-l-4 border-l-primary">
                <CardHeader className="pb-3 space-y-2 bg-muted/40 rounded-t-lg">
                  <div className="grid gap-1.5 text-sm">
                    <div className="flex items-center gap-2"><Home className="h-4 w-4 text-muted-foreground" /><span className="font-bold uppercase">{s.customer_name ?? "SIN NOMBRE"}</span></div>
                    <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5" /><span className="font-semibold uppercase">{s.delivery_address ?? "—"}</span></div>
                    {s.delivery_neighborhood && (
                      <div className="pl-6 text-xs uppercase text-muted-foreground">Barrio: <span className="font-semibold text-foreground">{s.delivery_neighborhood}</span></div>
                    )}
                    <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><a href={`tel:${s.customer_phone}`} className="font-semibold hover:underline">{s.customer_phone ?? "—"}</a></div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div>
                      <CardTitle className="text-base">Ticket #{s.ticket_number}</CardTitle>
                      <p className="text-xs text-muted-foreground">{formatDate(s.created_at)}</p>
                    </div>
                    <Badge variant={s.delivery_status === "en_camino" ? "default" : "secondary"}>
                      {s.delivery_status === "en_camino" ? "En camino" : s.delivery_status === "asignado" ? "Asignado" : "Por asignar"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm pt-3">
                  {s.notes && <p className="text-xs text-muted-foreground italic">Notas: {s.notes}</p>}
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-primary">{formatMoney(s.total)}</div>
                    <div className="text-xs uppercase text-muted-foreground">{s.payment_method}</div>
                  </div>
                  <PaymentInfoBlock
                    method={s.payment_method}
                    details={s.payment_details}
                    total={s.total}
                    compact
                  />
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {new Date(s.created_at).toLocaleDateString("es-CO")}</span>
                    <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> {courierName(s.courier_id) || "Sin domiciliario"}</span>
                  </div>

                  <div className="pt-2 border-t">
                    <label className="text-xs font-medium text-muted-foreground">Repartidor</label>
                    <select
                      className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm"
                      value={s.courier_id ?? ""}
                      onChange={(e) => assignCourier(s, e.target.value)}
                    >
                      <option value="">— Sin asignar —</option>
                      {branchCouriers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button size="sm" variant="default" onClick={() => openForPayment(s)}>
                      <Banknote className="h-4 w-4 mr-1" /> Editar / Agregar / Cobrar
                    </Button>
                    {courier && (
                      <Button size="sm" variant="outline" onClick={() => sendWhatsAppTo(s, courier)}>
                        <MessageCircle className="h-4 w-4 mr-1" /> Reenviar WhatsApp
                      </Button>
                    )}
                    {s.delivery_status !== "en_camino" && (
                      <Button size="sm" onClick={() => markEnCamino(s)} disabled={!s.courier_id}>
                        <Truck className="h-4 w-4 mr-1" /> En camino + WhatsApp
                      </Button>
                    )}
                    <Button size="sm" onClick={() => markEntregado(s.id)}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Entregado
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Entregados hoy ({done.length})</h2>
          <div className="grid gap-2">
            {done.slice(0, 20).map((s) => (
              <Card key={s.id} className="opacity-75">
                <CardContent className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">#{s.ticket_number} · {s.customer_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{s.delivery_address}</div>
                  </div>
                  <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Entregado</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
