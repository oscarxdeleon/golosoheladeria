import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingBag, Banknote, ChevronRight, Clock } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useBranch } from "@/contexts/branch-context";

interface PendingSale {
  id: string;
  ticket_number: number;
  created_at: string;
  customer_name: string | null;
  total: number;
  sale_items: { qty: number; product_name: string }[];
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.floor(m / 60)} h`;
}

export function LlevarPendingPanel() {
  const navigate = useNavigate();
  const { activeBranchId } = useBranch();

  const { data: orders = [] } = useQuery<PendingSale[]>({
    queryKey: ["llevar-pending", activeBranchId],
    refetchInterval: 5000,
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("id,ticket_number,created_at,customer_name,total,sale_items(qty,product_name)")
        .eq("branch_id", activeBranchId!)
        .eq("order_type", "llevar")
        .eq("status", "pending")
        .neq("source", "kiosk")
        .order("created_at", { ascending: true })
        .limit(40);
      return (data ?? []) as PendingSale[];
    },
  });

  if (orders.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/10">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 font-display text-2xl">
            <ShoppingBag className="h-7 w-7 text-amber-600" />
            Para llevar · Pendientes de pago
          </div>
          <Badge className="bg-amber-600 text-white text-sm px-3 py-1">{orders.length}</Badge>
          <span className="ml-auto text-sm text-muted-foreground inline-flex items-center gap-1">
            <Clock className="h-4 w-4" /> Cliente paga al recibir
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 max-h-[320px] overflow-auto">
          {orders.map((o) => (
            <button
              key={o.id}
              onClick={() => navigate({ to: "/pos", search: { type: "llevar", kioskSaleId: o.id } })}
              className="group flex items-center gap-3 rounded-lg border bg-card p-3 text-left hover:border-amber-500 hover:shadow-md transition active:scale-[0.99]"
            >
              <div className="font-display text-3xl text-amber-600 w-14 shrink-0 text-center leading-none">
                #{o.ticket_number}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">
                  {timeAgo(o.created_at)}
                  {o.customer_name ? ` · ${o.customer_name}` : ""}
                </div>
                <div className="text-sm font-medium truncate">
                  {o.sale_items.map((i) => `${i.qty}× ${i.product_name}`).join(" · ") || "—"}
                </div>
                <div className="font-display text-base text-primary mt-0.5">{formatMoney(o.total)}</div>
              </div>
              <Banknote className="h-5 w-5 text-amber-600 opacity-60 group-hover:opacity-100" />
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
