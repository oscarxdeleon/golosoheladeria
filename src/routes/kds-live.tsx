import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, Utensils, ShoppingBag, Bike, Monitor, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { notifyCustomerReady } from "@/lib/customer-ready-notify";

export const Route = createFileRoute("/kds-live")({
  ssr: false,
  head: () => ({ meta: [{ title: "KDS Cocina · Goloso" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ sede: (s.sede as string) ?? "" }),
  component: KdsLive,
});

interface SaleItem {
  id: string; product_name: string; qty: number; ready_at: string | null; modifiers: unknown;
}
interface Pending {
  id: string; ticket_number: number; user_name: string | null; customer_name: string | null;
  notes: string | null; order_type: string; created_at: string; table_id: string | null;
  delivery_address: string | null; status: string; branch_id: string | null;
  sale_items: SaleItem[];
  restaurant_tables: { number: number; label: string | null } | null;
}

const TYPE_ICON: Record<string, typeof Utensils> = { mesa: Utensils, llevar: ShoppingBag, domicilio: Bike, kiosko: Monitor };
const TYPE_LABEL: Record<string, string> = { mesa: "Mesa", llevar: "Para llevar", domicilio: "Domicilio", kiosko: "Autopedido" };

function useTicker(ms = 1000) {
  const [, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT((x) => x + 1), ms); return () => clearInterval(i); }, [ms]);
}

function KdsLive() {
  const { sede } = Route.useSearch();
  const qc = useQueryClient();
  useTicker(1000);

  const { data = [], isLoading } = useQuery({
    queryKey: ["kds-public", sede],
    enabled: !!sede,
    refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kds_public_pending", { p_slug: sede });
      if (error) throw error;
      return (data ?? []) as unknown as Pending[];
    },
  });

  useEffect(() => {
    if (!sede) return;
    const ch = supabase
      .channel(`kds-public-${sede}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => {
        qc.invalidateQueries({ queryKey: ["kds-public", sede] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, () => {
        qc.invalidateQueries({ queryKey: ["kds-public", sede] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, sede]);

  async function markItemReady(saleId: string, itemId: string) {
    qc.setQueryData<Pending[]>(["kds-public", sede], (old) =>
      (old ?? []).map((s) => s.id !== saleId ? s : { ...s, sale_items: s.sale_items.map((i) => i.id === itemId ? { ...i, ready_at: new Date().toISOString() } : i) })
    );
    const { error } = await supabase.rpc("kds_public_mark_item_ready", { p_item_id: itemId });
    if (error) { toast.error("No se pudo marcar"); qc.invalidateQueries({ queryKey: ["kds-public", sede] }); }
  }

  async function markAllReady(saleId: string) {
    const { error } = await supabase.rpc("kds_public_mark_all_ready", { p_sale_id: saleId });
    if (error) { toast.error("Error al despachar"); return; }
    toast.success("Pedido listo");
    qc.invalidateQueries({ queryKey: ["kds-public", sede] });
  }

  if (!sede) {
    return <div className="p-8 text-center text-muted-foreground">Falta el parámetro <code>?sede=</code> en la URL.</div>;
  }

  return (
    <div className="min-h-screen bg-background p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">KDS — Cocina</h1>
          <p className="text-sm text-muted-foreground">Sede: {sede} · Acceso directo sin sesión</p>
        </div>
        <Badge variant="secondary" className="text-base px-3 py-1">
          <Clock className="h-4 w-4 mr-1" /> {data.length} en preparación
        </Badge>
      </div>

      {isLoading && <p className="text-muted-foreground">Cargando…</p>}
      {!isLoading && data.length === 0 && (
        <Card><CardContent className="py-16 text-center text-muted-foreground">✓ No hay comandas en preparación</CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map((s) => {
          const Icon = TYPE_ICON[s.order_type] ?? Utensils;
          const dest = s.restaurant_tables
            ? (s.restaurant_tables.label ?? `Mesa ${s.restaurant_tables.number}`)
            : (s.delivery_address ?? TYPE_LABEL[s.order_type] ?? s.order_type);
          const elapsedSec = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 1000);
          const mins = Math.floor(elapsedSec / 60);
          const secs = elapsedSec % 60;
          const totalItems = s.sale_items?.length ?? 0;
          const readyItems = s.sale_items?.filter((i) => i.ready_at).length ?? 0;
          const allReady = totalItems > 0 && readyItems === totalItems;
          const borderColor = allReady ? "border-emerald-500"
            : mins >= 10 ? "border-destructive animate-pulse"
            : mins >= 5 ? "border-amber-400" : "border-primary";
          return (
            <Card key={s.id} className={`border-2 transition-all ${borderColor} ${allReady ? "opacity-70" : ""}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge><Icon className="h-3 w-3 mr-1" /> {TYPE_LABEL[s.order_type] ?? s.order_type}</Badge>
                    <span className="font-display text-2xl">#{s.ticket_number}</span>
                  </div>
                  <Badge variant={mins >= 10 ? "destructive" : "outline"} className="tabular-nums">
                    <Clock className="h-3 w-3 mr-1" /> {mins}:{secs.toString().padStart(2, "0")}
                  </Badge>
                </div>
                <div className="font-medium">{dest}</div>
                {s.customer_name && <div className="text-sm text-muted-foreground">Cliente: {s.customer_name}</div>}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Avance: {readyItems}/{totalItems}</span>
                  <div className="flex-1 mx-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${totalItems ? (readyItems / totalItems) * 100 : 0}%` }} />
                  </div>
                </div>
                <ul className="space-y-1 border-t pt-2">
                  {s.sale_items?.map((i) => {
                    const isReady = !!i.ready_at;
                    return (
                      <li key={i.id} className={`flex items-center gap-2 rounded p-2 ${isReady ? "bg-emerald-50 dark:bg-emerald-950/30 line-through text-muted-foreground" : ""}`}>
                        <span className="font-bold w-8 shrink-0">{i.qty}×</span>
                        <span className="flex-1 whitespace-pre-line">{i.product_name}</span>
                        <Button size="sm" variant={isReady ? "ghost" : "default"} disabled={isReady} onClick={() => markItemReady(s.id, i.id)}>
                          <Check className="h-4 w-4 mr-1" />{isReady ? "Listo" : "Marcar"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                {s.notes && (
                  <div className="rounded-lg border-2 border-amber-500 bg-amber-100 dark:bg-amber-900/40 p-3">
                    <div className="text-xs font-extrabold uppercase text-amber-900 dark:text-amber-200 mb-1">⚠️ Notas</div>
                    <div className="text-lg font-bold text-amber-950 dark:text-amber-100 whitespace-pre-line">{s.notes}</div>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Cajero: {s.user_name ?? "—"}</span>
                  <span>{new Date(s.created_at).toLocaleTimeString("es-CO")}</span>
                </div>
                <Button className="w-full" variant={allReady ? "secondary" : "default"} onClick={() => markAllReady(s.id)}>
                  <CheckCheck className="h-4 w-4 mr-1" />{allReady ? "Despachar pedido" : "Despachar todo"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
