import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Minus, Plus, Trash2, Search, ShoppingCart, CheckCircle2 } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TicketPreview } from "@/components/ticket-preview";

export const Route = createFileRoute("/_authenticated/caja")({
  head: () => ({ meta: [{ title: "Caja · Goloso POS" }] }),
  component: CajaPage,
});

interface Category { id: string; name: string; sort_order: number; }
interface Product { id: string; name: string; price: number; category_id: string | null; image_url: string | null; active: boolean; }
interface CartLine { key: string; product_id: string; name: string; unit_price: number; qty: number; }

function CajaPage() {
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const [paying, setPaying] = useState(false);
  const [lastSale, setLastSale] = useState<{ id: string; ticket_number: number; total: number; payment_method: string; lines: CartLine[]; customer: string; user_name: string; created_at: string } | null>(null);

  const { data: cats = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("*").eq("active", true).order("sort_order");
      return (data ?? []) as Category[];
    },
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*").eq("active", true).order("name");
      return (data ?? []) as Product[];
    },
  });
  const { data: methods = [] } = useQuery({
    queryKey: ["payment_methods"],
    queryFn: async () => {
      const { data } = await supabase.from("payment_methods").select("*").eq("active", true).order("sort_order");
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (activeCat !== "all" && p.category_id !== activeCat) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [products, activeCat, search]);

  const total = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);

  function add(p: Product) {
    setCart((prev) => {
      const k = p.id;
      const idx = prev.findIndex((l) => l.key === k);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { key: k, product_id: p.id, name: p.name, unit_price: Number(p.price), qty: 1 }];
    });
  }
  function dec(key: string) {
    setCart((p) => p.flatMap((l) => (l.key === key ? (l.qty <= 1 ? [] : [{ ...l, qty: l.qty - 1 }]) : [l])));
  }
  function remove(key: string) {
    setCart((p) => p.filter((l) => l.key !== key));
  }

  async function pay(method: string) {
    if (!user) return;
    if (cart.length === 0) {
      toast.error("Carrito vacío");
      return;
    }
    setPaying(true);
    try {
      const { data: sale, error } = await supabase
        .from("sales")
        .insert({
          user_id: user.id,
          user_name: profile?.full_name ?? user.email,
          subtotal: total,
          total,
          payment_method: method,
          customer_name: customer || null,
          notes: notes || null,
        })
        .select("id,ticket_number,total,payment_method,created_at")
        .single();
      if (error) throw error;
      const items = cart.map((l) => ({
        sale_id: sale.id,
        product_id: l.product_id,
        product_name: l.name,
        qty: l.qty,
        unit_price: l.unit_price,
        subtotal: l.unit_price * l.qty,
        modifiers: [],
      }));
      const { error: e2 } = await supabase.from("sale_items").insert(items);
      if (e2) throw e2;

      setLastSale({
        id: sale.id,
        ticket_number: sale.ticket_number,
        total: Number(sale.total),
        payment_method: sale.payment_method,
        lines: cart,
        customer,
        user_name: profile?.full_name ?? user.email ?? "",
        created_at: sale.created_at,
      });
      setCart([]);
      setCustomer("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["dashboard-today"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      toast.success(`Venta #${sale.ticket_number} registrada`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cobrar");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,420px]">
      {/* Catalog */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h1 className="font-display text-2xl">Caja</h1>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar producto…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <Tabs value={activeCat} onValueChange={setActiveCat}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="all">Todo</TabsTrigger>
            {cats.map((c) => (
              <TabsTrigger key={c.id} value={c.id}>{c.name}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => add(p)}
              className="group rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:shadow-md active:scale-[0.98]"
            >
              <div className="font-medium leading-tight">{p.name}</div>
              <div className="mt-2 font-display text-lg text-primary">{formatMoney(p.price)}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full text-center text-sm text-muted-foreground py-12">
              Sin productos. Agrégalos en Menú → Productos.
            </p>
          )}
        </div>
      </div>

      {/* Cart */}
      <Card className="h-fit lg:sticky lg:top-20">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            <h2 className="font-display text-xl">Pedido</h2>
            <span className="ml-auto text-sm text-muted-foreground">{cart.length} items</span>
          </div>

          <div className="max-h-[40vh] space-y-2 overflow-auto">
            {cart.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Toca un producto para agregarlo</p>
            )}
            {cart.map((l) => (
              <div key={l.key} className="flex items-center gap-2 rounded-lg bg-muted/50 p-2">
                <div className="flex-1">
                  <div className="font-medium text-sm">{l.name}</div>
                  <div className="text-xs text-muted-foreground">{formatMoney(l.unit_price)} c/u</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => dec(l.key)}><Minus className="h-3 w-3" /></Button>
                  <span className="w-6 text-center text-sm">{l.qty}</span>
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => add({ id: l.product_id, name: l.name, price: l.unit_price, category_id: null, image_url: null, active: true })}><Plus className="h-3 w-3" /></Button>
                </div>
                <div className="w-20 text-right text-sm font-medium">{formatMoney(l.unit_price * l.qty)}</div>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(l.key)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t pt-3">
            <Input placeholder="Nombre cliente (opcional)" value={customer} onChange={(e) => setCustomer(e.target.value)} />
            <Input placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-muted-foreground">Total</span>
            <span className="font-display text-3xl text-primary">{formatMoney(total)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {methods.map((m: { id: string; name: string }) => (
              <Button key={m.id} disabled={paying || cart.length === 0} onClick={() => pay(m.name)} variant={m.name === "Efectivo" ? "default" : "secondary"}>
                {m.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Ticket */}
      <Dialog open={!!lastSale} onOpenChange={(o) => !o && setLastSale(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              Venta registrada
            </DialogTitle>
          </DialogHeader>
          {lastSale && <TicketPreview sale={lastSale} />}
          <DialogFooter className="no-print">
            <Button variant="outline" onClick={() => setLastSale(null)}>Cerrar</Button>
            <Button onClick={() => window.print()}>Imprimir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
