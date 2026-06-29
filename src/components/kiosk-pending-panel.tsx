import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Monitor, Search, ShoppingBag, Utensils, ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/format";

interface KioskSale {
  id: string;
  ticket_number: number;
  created_at: string;
  customer_name: string | null;
  notes: string | null;
  total: number;
  sale_items: { qty: number; product_name: string }[];
}

function timeAgo(d: string) {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h`;
}

function serviceFromNotes(n: string | null): { label: string; icon: typeof ShoppingBag } {
  const t = (n ?? "").toUpperCase();
  if (t.includes("COMER")) return { label: "Comer aquí", icon: Utensils };
  return { label: "Para llevar", icon: ShoppingBag };
}

export function KioskPendingPanel({ onSelect }: { onSelect: (saleId: string) => void }) {
  const [q, setQ] = useState("");

  const { data: orders = [] } = useQuery<KioskSale[]>({
    queryKey: ["kiosk-pending"],
    refetchInterval: 4000,
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("id,ticket_number,created_at,customer_name,notes,total,sale_items(qty,product_name)")
        .eq("source", "kiosk")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(30);
      return (data ?? []) as KioskSale[];
    },
  });

  const filtered = useMemo(() => {
    if (!q.trim()) return orders;
    const needle = q.trim().toLowerCase();
    return orders.filter(
      (o) =>
        String(o.ticket_number).includes(needle) ||
        (o.customer_name ?? "").toLowerCase().includes(needle),
    );
  }, [orders, q]);

  if (orders.length === 0) return null;

  return (
    <Card className="border-purple-500/40 bg-purple-50/40 dark:bg-purple-950/10">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 font-display text-lg">
            <Monitor className="h-5 w-5 text-purple-600" />
            Pedidos Kiosko · Pendientes de pago
          </div>
          <Badge className="bg-purple-600 text-white">{orders.length}</Badge>
          <div className="relative ml-auto w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar #pedido…"
              className="pl-9 h-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 max-h-[260px] overflow-auto">
          {filtered.map((o) => {
            const svc = serviceFromNotes(o.notes);
            const SvcIcon = svc.icon;
            return (
              <button
                key={o.id}
                onClick={() => onSelect(o.id)}
                className="group flex items-center gap-3 rounded-lg border bg-card p-3 text-left hover:border-purple-500 hover:shadow-md transition active:scale-[0.99]"
              >
                <div className="font-display text-3xl text-purple-600 w-14 shrink-0 text-center leading-none">
                  #{o.ticket_number}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <SvcIcon className="h-3 w-3" />
                    <span>{svc.label}</span>
                    <span>·</span>
                    <span>{timeAgo(o.created_at)}</span>
                  </div>
                  <div className="text-sm font-medium truncate">
                    {o.sale_items.map((i) => `${i.qty}× ${i.product_name}`).join(" · ") || "—"}
                  </div>
                  <div className="font-display text-base text-primary mt-0.5">{formatMoney(o.total)}</div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-purple-600" />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-sm text-muted-foreground py-6">
              Sin coincidencias para "{q}"
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
