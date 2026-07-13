import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banknote, ShoppingBag, Utensils, Inbox, User } from "lucide-react";
import autopedidoCharacter from "@/assets/autopedidos-character.png";
import golosoLogo from "@/assets/goloso-logo-official.png";
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
    <div className="space-y-4 premium-scope">
      {/* Header compacto premium — alineado como Mesas / Para Llevar */}
      <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-white via-sky-50/70 to-emerald-50/60 dark:from-slate-900 dark:via-sky-950/40 dark:to-emerald-950/30 shadow-[0_18px_45px_-20px_rgba(2,132,199,0.35),inset_0_1px_0_rgba(255,255,255,0.95)] ring-1 ring-white/70 dark:ring-white/5">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(600px 180px at 92% -10%, rgba(132,204,22,0.18), transparent 60%), radial-gradient(500px 160px at -5% 110%, rgba(14,165,233,0.20), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-4 px-3 py-2.5 sm:px-5 sm:py-3">
          <img
            src={golosoLogo}
            alt="Heladería Goloso"
            width={1200}
            height={960}
            loading="eager"
            className="h-14 sm:h-16 md:h-20 w-auto object-contain select-none shrink-0 drop-shadow-[0_10px_14px_rgba(2,132,199,0.35)]"
            draggable={false}
          />

          <h1
            className="uppercase leading-[0.85] tracking-[-0.02em] text-4xl sm:text-5xl md:text-6xl bg-clip-text text-transparent select-none shrink-0"
            style={{
              fontFamily: '"Titan One", "Fredoka", system-ui, sans-serif',
              backgroundImage:
                "linear-gradient(180deg, #7dd3fc 0%, #0ea5e9 45%, #0369a1 100%)",
              WebkitTextStroke: "2px #ffffff",
              paintOrder: "stroke fill",
              filter:
                "drop-shadow(0 2px 0 rgba(255,255,255,0.95)) drop-shadow(0 8px 14px rgba(2,132,199,0.45))",
            }}
          >
            Autopedido
          </h1>

          <div className="flex-1 flex justify-center">
            <img
              src={autopedidoCharacter}
              alt="Personaje Goloso con tablet de autopedidos"
              loading="eager"
              className="h-20 sm:h-24 md:h-28 w-auto object-contain select-none drop-shadow-[0_12px_18px_rgba(2,132,199,0.35)]"
              draggable={false}
            />
          </div>

          <Badge variant="secondary" className="text-xs px-2.5 py-1 shrink-0">
            {orders.length} pendiente{orders.length === 1 ? "" : "s"}
          </Badge>

          <button
            type="button"
            onClick={() => navigate({ to: "/ajustes" })}
            className="grid h-10 w-10 place-items-center rounded-full bg-white dark:bg-white/10 text-emerald-600 ring-2 ring-emerald-400/70 shadow-[0_6px_14px_-6px_rgba(16,185,129,0.5)] transition hover:scale-110 active:scale-95 shrink-0"
            aria-label="Perfil"
          >
            <User className="h-5 w-5" />
          </button>
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
