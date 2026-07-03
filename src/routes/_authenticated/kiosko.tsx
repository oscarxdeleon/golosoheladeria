import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Monitor, Banknote, ShoppingBag, Utensils, Inbox } from "lucide-react";
import autopedidoCharacterAsset from "@/assets/autopedidos_character.png.asset.json";
const autopedidoCharacter = autopedidoCharacterAsset.url;
import { formatMoney } from "@/lib/format";
import { useBranch } from "@/contexts/branch-context";

export const Route = createFileRoute("/_authenticated/kiosko")({
  head: () => ({ meta: [{ title: "Pedidos Autopedido · Goloso POS" }] }),
  component: AutopedidoInbox,
});

interface KioskOrder {
  id: string;
  ticket_number: number;
  created_at: string;
  customer_name: string | null;
  notes: string | null;
  total: number;
  sale_items: { qty: number; product_name: string }[];
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.floor(m / 60)} h`;
}

function serviceFromNotes(n: string | null) {
  const t = (n ?? "").toUpperCase();
  if (t.includes("COMER")) return { label: "Comer aquí", icon: Utensils };
  return { label: "Para llevar", icon: ShoppingBag };
}

function AutopedidoInbox() {
  const navigate = useNavigate();
  const { activeBranchId } = useBranch();

  const { data: orders = [], isLoading } = useQuery<KioskOrder[]>({
    queryKey: ["kiosk-pending", activeBranchId],
    refetchInterval: 4000,
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("id,ticket_number,created_at,customer_name,notes,total,sale_items(qty,product_name)")
        .eq("source", "kiosk")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(60);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data } = await q;
      return (data ?? []) as KioskOrder[];
    },
  });

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-purple-200/60 bg-gradient-to-br from-purple-50 via-fuchsia-50 to-indigo-50 dark:from-purple-950/40 dark:via-fuchsia-950/20 dark:to-indigo-950/40 dark:border-purple-900/50">
        <div className="pointer-events-none absolute -top-16 -right-10 h-64 w-64 rounded-full bg-purple-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-fuchsia-400/20 blur-3xl" />
        <div className="relative flex flex-col-reverse gap-4 p-6 md:flex-row md:items-center md:gap-6 md:p-8">
          <div className="flex-1 min-w-0 space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/70 dark:bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-200 backdrop-blur">
              <Monitor className="h-3.5 w-3.5" /> Autoservicio · Tiempo real
            </span>
            <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-purple-700 via-fuchsia-600 to-indigo-600 bg-clip-text text-transparent">
              Autopedidos
            </h1>
            <p className="max-w-lg text-sm md:text-base text-muted-foreground">
              Bandeja en tiempo real de pedidos de autoservicio pendientes de pago.
            </p>
            <div>
              <Badge className="bg-purple-600 text-white text-base px-3 py-1 shadow-sm">
                {orders.length} pendiente{orders.length === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>
          <img
            src={autopedidoCharacter}
            alt="Personaje Goloso con tablet de autopedidos"
            className="mx-auto h-48 md:h-64 lg:h-72 w-auto object-contain select-none bg-transparent border-0 shadow-none"
            draggable={false}
          />
        </div>
      </div>


      <Card>
        <CardHeader>
          <CardTitle>Pendientes de pago</CardTitle>
          <CardDescription>
            Selecciona un pedido para verificarlo y procesar el cobro en caja.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : orders.length === 0 ? (
            <div className="p-16 text-center text-muted-foreground">
              <Inbox className="mx-auto h-10 w-10 mb-3 opacity-50" />
              <p className="font-medium">Sin pedidos pendientes</p>
              <p className="text-sm">Los pedidos del kiosko aparecerán aquí automáticamente.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {orders.map((o) => {
                const svc = serviceFromNotes(o.notes);
                const SvcIcon = svc.icon;
                return (
                  <li key={o.id} className="flex flex-col md:flex-row md:items-center gap-4 p-4 hover:bg-muted/40 transition">
                    <div className="font-display text-4xl text-purple-600 w-20 shrink-0 text-center leading-none">
                      #{o.ticket_number}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-950/40 px-2 py-0.5 text-purple-700 dark:text-purple-300 font-medium">
                          <SvcIcon className="h-3 w-3" />
                          {svc.label}
                        </span>
                        <span>·</span>
                        <span>{timeAgo(o.created_at)}</span>
                        {o.customer_name && <><span>·</span><span>{o.customer_name}</span></>}
                      </div>
                      <ul className="text-sm">
                        {o.sale_items.map((i, idx) => (
                          <li key={idx} className="text-foreground">
                            <span className="font-medium">{i.qty}×</span> {i.product_name}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex md:flex-col items-center md:items-end gap-3 md:gap-2 md:text-right">
                      <div className="font-display text-2xl text-primary">{formatMoney(o.total)}</div>
                      <Button
                        size="lg"
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={() => navigate({ to: "/pos", search: { type: "kiosko", kioskSaleId: o.id } })}
                      >
                        <Banknote className="h-4 w-4 mr-1" /> Procesar Pago
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
