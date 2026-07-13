import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, Utensils, ShoppingBag, Bike, Monitor, CheckCheck, User } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/branch-context";
import { notifyCustomerReady } from "@/lib/customer-ready-notify";
import kdsImg from "@/assets/kds-goloso-3d.png";
import golosoLogo from "@/assets/goloso-logo-official.png";


export const Route = createFileRoute("/_authenticated/kds")({
  head: () => ({ meta: [{ title: "KDS · Goloso POS" }] }),
  component: KdsPage,
});


interface SaleItem {
  id: string;
  product_name: string;
  qty: number;
  ready_at: string | null;
  modifiers: unknown;
}
interface Pending {
  id: string;
  ticket_number: number;
  user_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  source: string | null;
  notes: string | null;
  order_type: string;
  created_at: string;
  table_id: string | null;
  delivery_address: string | null;
  status: string;
  branch_id: string | null;
  sale_items: SaleItem[];
  restaurant_tables: { number: number; label: string | null } | null;
}

const TYPE_ICON: Record<string, typeof Utensils> = {
  mesa: Utensils, llevar: ShoppingBag, domicilio: Bike, kiosko: Monitor,
};
const TYPE_LABEL: Record<string, string> = {
  mesa: "Mesa", llevar: "Para llevar", domicilio: "Domicilio", kiosko: "Autopedido",
};

function useTicker(intervalMs = 1000) {
  const [, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT((x) => x + 1), intervalMs);
    return () => clearInterval(i);
  }, [intervalMs]);
}

function KdsPage() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  useTicker(1000);

  const { data = [], isLoading } = useQuery({
    queryKey: ["kds-pending", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      if (!activeBranchId) return [];
      const { data, error } = await supabase
        .from("sales")
        .select("id,ticket_number,user_name,customer_name,customer_phone,source,notes,order_type,created_at,table_id,delivery_address,status,branch_id,sale_items(id,product_name,qty,ready_at,modifiers),restaurant_tables(number,label)")
        .eq("branch_id", activeBranchId)
        .in("status", ["pending", "confirmed"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Pending[];
    },
  });

  useEffect(() => {
    if (!activeBranchId) return;
    const ch = supabase
      .channel(`kds-realtime-${activeBranchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, (payload) => {
        const row = payload.new as { branch_id?: string | null } | null;
        if (row?.branch_id && row.branch_id !== activeBranchId) return;
        qc.invalidateQueries({ queryKey: ["kds-pending", activeBranchId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, () => {
        qc.invalidateQueries({ queryKey: ["kds-pending", activeBranchId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, activeBranchId]);

  async function markItemReady(sale: Pending, itemId: string) {
    const saleId = sale.id;
    // Optimistic update
    qc.setQueryData<Pending[]>(["kds-pending", activeBranchId], (old) =>
      (old ?? []).map((s) =>
        s.id !== saleId ? s : { ...s, sale_items: s.sale_items.map((i) => i.id === itemId ? { ...i, ready_at: new Date().toISOString() } : i) }
      )
    );
    const { error } = await supabase
      .from("sale_items")
      .update({ ready_at: new Date().toISOString() })
      .eq("id", itemId);
    if (error) {
      toast.error("No se pudo marcar el ítem");
      qc.invalidateQueries({ queryKey: ["kds-pending", activeBranchId] });
      return;
    }
    // "Marcar" solo actualiza el estado interno del ítem. NO envía WhatsApp
    // al cliente; ese aviso se dispara únicamente desde "Despachar todo".
  }

  async function markAllReady(sale: Pending) {
    const saleId = sale.id;
    const items = sale.sale_items;
    if (!activeBranchId) {
      toast.error("Selecciona una sede para actualizar la comanda");
      return;
    }
    const ids = items.filter((i) => !i.ready_at).map((i) => i.id);
    qc.setQueryData<Pending[]>(["kds-pending", activeBranchId], (old) =>
      (old ?? []).map((s) =>
        s.id !== saleId ? s : { ...s, sale_items: s.sale_items.map((i) => ({ ...i, ready_at: i.ready_at ?? new Date().toISOString() })) }
      )
    );
    if (ids.length > 0) {
      const { error } = await supabase
        .from("sale_items")
        .update({ ready_at: new Date().toISOString() })
        .in("id", ids);
      if (error) {
        toast.error("Error al despachar");
        qc.invalidateQueries({ queryKey: ["kds-pending", activeBranchId] });
        return;
      }
    }
    // Trigger auto-updates sales.status, but force-set just in case all were already ready
    await supabase.from("sales").update({ status: "ready", kds_ack_at: new Date().toISOString() }).eq("id", saleId).eq("branch_id", activeBranchId);
    toast.success("Pedido listo para servir");
    const notified = notifyCustomerReady(sale);
    if (notified) toast.success("WhatsApp enviado al cliente");
  }

  return (
    <div className="space-y-4 premium-scope">
      {/* Hero premium — título 3D degradado azul→verde + ilustración KDS 3D a la derecha */}
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-white via-sky-50/60 to-emerald-50/50 dark:from-slate-900 dark:via-sky-950/40 dark:to-emerald-950/30 shadow-[0_20px_60px_-20px_rgba(2,132,199,0.35),0_8px_24px_-12px_rgba(16,185,129,0.25),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-white/60 dark:ring-white/5">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(700px 240px at 90% -10%, rgba(16,185,129,0.18), transparent 60%), radial-gradient(600px 220px at -5% 110%, rgba(2,132,199,0.18), transparent 60%)",
          }}
        />
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-5 py-5 sm:px-10 sm:py-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/80 dark:bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300 shadow-sm ring-1 ring-sky-500/20 backdrop-blur">
              <Monitor className="h-3 w-3" /> Cocina · Goloso
            </div>
            <h1
              className="font-display mt-2 text-5xl sm:text-7xl md:text-8xl font-black uppercase tracking-tight leading-[0.9] bg-clip-text text-transparent animate-fade-in"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #0369a1 0%, #0284c7 35%, #10b981 75%, #84cc16 100%)",
                WebkitTextStroke: "0.5px rgba(255,255,255,0.4)",
                filter:
                  "drop-shadow(0 2px 0 rgba(255,255,255,0.6)) drop-shadow(0 8px 20px rgba(2,132,199,0.35))",
              }}
            >
              KDS
            </h1>
            <p className="mt-2 text-sm sm:text-base text-slate-700 dark:text-slate-200 font-semibold">
              Comandas en tiempo real
            </p>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Marca cada ítem como listo
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 dark:bg-white/10 px-3 py-1.5 text-sm font-bold text-sky-700 dark:text-sky-300 shadow-sm ring-1 ring-sky-500/20 backdrop-blur">
              <Clock className="h-4 w-4" /> {data.length} en preparación
            </div>
          </div>
          <img
            src={kdsImg}
            alt="KDS Cocina Goloso"
            width={1024}
            height={1024}
            loading="lazy"
            className="h-36 w-auto sm:h-56 md:h-64 object-contain select-none -mr-2 sm:-mr-4 drop-shadow-[0_20px_25px_rgba(2,132,199,0.35)] animate-fade-in"
            draggable={false}
          />
        </div>
      </div>


      {isLoading && <p className="text-muted-foreground">Cargando…</p>}

      {!isLoading && data.length === 0 && (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          ✓ No hay comandas en preparación
        </CardContent></Card>
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
          const borderColor = allReady
            ? "border-emerald-500"
            : mins >= 10 ? "border-destructive animate-pulse"
            : mins >= 5 ? "border-amber-400" : "border-primary";

          return (
            <Card
              key={s.id}
              className={`border-2 transition-all duration-500 ease-out ${borderColor} ${allReady ? "opacity-70 scale-[0.98]" : "opacity-100"}`}
            >
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
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${totalItems ? (readyItems / totalItems) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <ul className="space-y-1 border-t pt-2">
                  {s.sale_items?.map((i) => {
                    const isReady = !!i.ready_at;
                    return (
                      <li
                        key={i.id}
                        className={`flex items-center gap-2 rounded p-2 transition-all duration-300 ${isReady ? "bg-emerald-50 dark:bg-emerald-950/30 line-through text-muted-foreground" : "hover:bg-muted/50"}`}
                      >
                        <span className="font-bold w-8 shrink-0">{i.qty}×</span>
                        <span className="flex-1 whitespace-pre-line">{i.product_name}</span>
                        <Button
                          size="sm"
                          variant={isReady ? "ghost" : "default"}
                          disabled={isReady}
                          onClick={() => markItemReady(s, i.id)}
                          className="shrink-0 transition-transform active:scale-95"
                        >
                          <Check className="h-4 w-4 mr-1" />
                          {isReady ? "Listo" : "Marcar"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>

                {s.notes && (
                  <div className="rounded-lg border-2 border-amber-500 bg-amber-100 dark:bg-amber-900/40 p-3 animate-pulse">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-amber-900 dark:text-amber-200 mb-1">⚠️ Notas del pedido</div>
                    <div className="text-lg font-bold text-amber-950 dark:text-amber-100 whitespace-pre-line leading-snug">{s.notes}</div>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Cajero: {s.user_name ?? "—"}</span>
                  <span>{new Date(s.created_at).toLocaleTimeString("es-CO")}</span>
                </div>
                <Button
                  className="w-full transition-transform active:scale-95"
                  variant={allReady ? "secondary" : "default"}
                  onClick={() => markAllReady(s)}
                >
                  <CheckCheck className="h-4 w-4 mr-1" />
                  {allReady ? "Despachar pedido" : "Despachar todo"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
