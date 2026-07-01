import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bike, Phone, MapPin, Home, CheckCircle2, Truck } from "lucide-react";
import { toast } from "sonner";
import { formatMoney, formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/domicilios")({
  head: () => ({ meta: [{ title: "Despacho domicilios · Goloso POS" }] }),
  component: DespachoDomiciliosPage,
});

interface DeliverySale {
  id: string;
  ticket_number: number;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  total: number;
  delivery_status: string | null;
  delivery_user_id: string | null;
  status: string;
  created_at: string;
  notes: string | null;
}

function DespachoDomiciliosPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();

  const { data = [] } = useQuery({
    queryKey: ["delivery-dispatch", user?.id, isAdmin],
    enabled: !!user,
    queryFn: async (): Promise<DeliverySale[]> => {
      let q = supabase
        .from("sales")
        .select("id,ticket_number,customer_name,customer_phone,delivery_address,delivery_neighborhood,total,delivery_status,delivery_user_id,status,created_at,notes,source")
        .eq("order_type", "domicilio")
        .neq("status", "cancelled")
        .or("source.is.null,source.neq.online_menu")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!isAdmin && user) {
        q = q.eq("delivery_user_id", user.id);
      }
      const { data } = await q;
      return (data ?? []) as DeliverySale[];
    },
    refetchInterval: 15000,
  });

  async function updateStatus(id: string, status: string) {
    const patch: Record<string, unknown> = { delivery_status: status };
    if (!isAdmin && user) patch.delivery_user_id = user.id;
    const { error } = await supabase.from("sales").update(patch as never).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(status === "entregado" ? "Pedido entregado" : "Estado actualizado");
    qc.invalidateQueries({ queryKey: ["delivery-dispatch"] });
  }

  async function takeOrder(id: string) {
    if (!user) return;
    const { error } = await supabase
      .from("sales")
      .update({ delivery_user_id: user.id, delivery_status: "asignado" } as never)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido tomado");
    qc.invalidateQueries({ queryKey: ["delivery-dispatch"] });
  }

  const pending = data.filter((d) => d.delivery_status !== "entregado");
  const done = data.filter((d) => d.delivery_status === "entregado");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Bike className="h-7 w-7 text-primary" />
        <div>
          <h1 className="font-display text-3xl leading-tight">Despacho de domicilios</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "Todos los pedidos a domicilio." : "Pedidos asignados a tu nombre."}
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Pendientes ({pending.length})</h2>
        {pending.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Sin pedidos pendientes</CardContent></Card>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {pending.map((s) => (
            <Card key={s.id} className="border-l-4 border-l-primary">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <CardTitle className="text-lg">Ticket #{s.ticket_number}</CardTitle>
                  <p className="text-xs text-muted-foreground">{formatDate(s.created_at)}</p>
                </div>
                <Badge variant={s.delivery_status === "en_camino" ? "default" : "secondary"}>
                  {s.delivery_status === "en_camino" ? "En camino" : s.delivery_status === "asignado" ? "Asignado" : "Por asignar"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><Home className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{s.customer_name ?? "Sin nombre"}</span></div>
                <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><a href={`tel:${s.customer_phone}`} className="hover:underline">{s.customer_phone ?? "—"}</a></div>
                <div className="flex items-start gap-2"><MapPin className="h-4 w-4 text-muted-foreground mt-0.5" /><span>{s.delivery_address ?? "—"}{s.delivery_neighborhood ? ` · ${s.delivery_neighborhood}` : ""}</span></div>
                {s.notes && <p className="text-xs text-muted-foreground italic">Notas: {s.notes}</p>}
                <div className="text-lg font-bold text-primary">{formatMoney(s.total)}</div>
                <div className="flex flex-wrap gap-2 pt-2">
                  {!s.delivery_user_id && !isAdmin && (
                    <Button size="sm" onClick={() => takeOrder(s.id)}>Tomar pedido</Button>
                  )}
                  {(s.delivery_user_id || isAdmin) && s.delivery_status !== "en_camino" && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus(s.id, "en_camino")}>
                      <Truck className="h-4 w-4 mr-1" /> En camino
                    </Button>
                  )}
                  {(s.delivery_user_id || isAdmin) && (
                    <Button size="sm" onClick={() => updateStatus(s.id, "entregado")}>
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Entregado
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
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
