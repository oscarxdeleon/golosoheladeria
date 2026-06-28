import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, Utensils, ShoppingBag, Bike, Monitor } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/kds")({
  head: () => ({ meta: [{ title: "KDS · Goloso POS" }] }),
  component: KdsPage,
});

interface Pending {
  id: string;
  ticket_number: number;
  user_name: string | null;
  customer_name: string | null;
  notes: string | null;
  order_type: string;
  created_at: string;
  table_id: string | null;
  delivery_address: string | null;
  sale_items: { id: string; product_name: string; qty: number }[];
  restaurant_tables: { number: number; label: string | null } | null;
}

const TYPE_ICON: Record<string, typeof Utensils> = {
  mesa: Utensils, llevar: ShoppingBag, domicilio: Bike, kiosko: Monitor,
};
const TYPE_LABEL: Record<string, string> = {
  mesa: "Mesa", llevar: "Para llevar", domicilio: "Domicilio", kiosko: "Kiosko",
};

function KdsPage() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["kds-pending"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,ticket_number,user_name,customer_name,notes,order_type,created_at,table_id,delivery_address,sale_items(id,product_name,qty),restaurant_tables(number,label)")
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Pending[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("kds-sales")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => {
        qc.invalidateQueries({ queryKey: ["kds-pending"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  async function markReady(id: string) {
    await supabase.from("sales").update({ kds_ack_at: new Date().toISOString() }).eq("id", id);
    toast.success("Marcado como listo");
    qc.invalidateQueries({ queryKey: ["kds-pending"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">KDS — Cocina</h1>
          <p className="text-sm text-muted-foreground">Comandas pendientes en tiempo real</p>
        </div>
        <Badge variant="secondary" className="text-base px-3 py-1">
          <Clock className="h-4 w-4 mr-1" /> {data.length} pendientes
        </Badge>
      </div>

      {isLoading && <p className="text-muted-foreground">Cargando…</p>}

      {!isLoading && data.length === 0 && (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          ✓ No hay comandas pendientes
        </CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map((s) => {
          const Icon = TYPE_ICON[s.order_type] ?? Utensils;
          const dest = s.restaurant_tables
            ? (s.restaurant_tables.label ?? `Mesa ${s.restaurant_tables.number}`)
            : (s.delivery_address ?? TYPE_LABEL[s.order_type] ?? s.order_type);
          const mins = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 60000);
          return (
            <Card key={s.id} className={`border-2 ${mins >= 10 ? "border-destructive" : mins >= 5 ? "border-amber-400" : "border-primary"}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge><Icon className="h-3 w-3 mr-1" /> {TYPE_LABEL[s.order_type] ?? s.order_type}</Badge>
                    <span className="font-display text-2xl">#{s.ticket_number}</span>
                  </div>
                  <Badge variant={mins >= 10 ? "destructive" : "outline"}>
                    <Clock className="h-3 w-3 mr-1" /> {mins}m
                  </Badge>
                </div>
                <div className="font-medium">{dest}</div>
                {s.customer_name && <div className="text-sm text-muted-foreground">Cliente: {s.customer_name}</div>}
                <ul className="space-y-1 border-t pt-2">
                  {s.sale_items?.map((i) => (
                    <li key={i.id} className="flex gap-2"><span className="font-bold w-8">{i.qty}×</span><span>{i.product_name}</span></li>
                  ))}
                </ul>
                {s.notes && <div className="rounded bg-amber-50 dark:bg-amber-950/20 p-2 text-sm"><b>Notas:</b> {s.notes}</div>}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Cajero: {s.user_name ?? "—"}</span>
                  <span>{new Date(s.created_at).toLocaleTimeString("es-CO")}</span>
                </div>
                <Button className="w-full" onClick={() => markReady(s.id)}>
                  <Check className="h-4 w-4 mr-1" /> Marcar listo
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
