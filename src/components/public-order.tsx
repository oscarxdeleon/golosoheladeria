import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Minus, Plus, Trash2, ShoppingCart, CheckCircle2, IceCream } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

interface Category { id: string; name: string; sort_order: number; }
interface Product { id: string; name: string; price: number; category_id: string | null; image_url: string | null; active: boolean; }
interface CartLine { key: string; product_id: string; name: string; unit_price: number; qty: number; }

type Source = "kiosk" | "table_qr" | "online_menu";

export function PublicOrder({
  source,
  tableId,
  tableLabel,
  readOnly = false,
}: {
  source: Source;
  tableId?: string;
  tableLabel?: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [activeCat, setActiveCat] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["public-settings"],
    queryFn: async () => (await supabase.from("settings").select("*").maybeSingle()).data,
  });
  const { data: cats = [] } = useQuery<Category[]>({
    queryKey: ["public-cats"],
    queryFn: async () => (await supabase.from("categories").select("*").eq("active", true).order("sort_order")).data ?? [],
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["public-products"],
    queryFn: async () => (await supabase.from("products").select("*").eq("active", true).order("name")).data ?? [],
  });

  const filtered = useMemo(
    () => products.filter((p) => activeCat === "all" || p.category_id === activeCat),
    [products, activeCat],
  );
  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);

  function add(p: Product) {
    setCart((c) => {
      const ex = c.find((l) => l.product_id === p.id);
      if (ex) return c.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: crypto.randomUUID(), product_id: p.id, name: p.name, unit_price: Number(p.price), qty: 1 }];
    });
  }
  function setQty(key: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, qty } : l))));
  }

  async function submit() {
    if (cart.length === 0) return toast.error("Agrega productos primero");
    setSubmitting(true);
    try {
      const ticket = Math.floor(Date.now() / 1000) % 100000;
      const { data: sale, error } = await supabase
        .from("sales")
        .insert({
          ticket_number: ticket,
          user_id: null,
          user_name: source === "kiosk" ? "Kiosko" : source === "table_qr" ? `Mesa QR ${tableLabel ?? ""}`.trim() : "Menú en línea",
          source,
          status: "pending",
          order_type: source === "table_qr" ? "mesa" : source === "kiosk" ? "kiosko" : "llevar",
          table_id: tableId ?? null,
          subtotal,
          total: subtotal,
          delivery_fee: 0,
          payment_method: "Pendiente",
          customer_name: customerName || null,
          customer_phone: phone || null,
          notes: notes || null,
        })
        .select()
        .single();
      if (error || !sale) throw error;
      const items = cart.map((l) => ({
        sale_id: sale.id,
        product_id: l.product_id,
        product_name: l.name,
        unit_price: l.unit_price,
        qty: l.qty,
        subtotal: l.unit_price * l.qty,
      }));
      const ins = await supabase.from("sale_items").insert(items);
      if (ins.error) throw ins.error;
      setTicketNumber(ticket);
      setConfirmOpen(true);
      setCart([]);
      setCustomerName("");
      setPhone("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["pending-sales"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al enviar pedido");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmOpen && ticketNumber) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <CheckCircle2 className="h-20 w-20 text-success mb-4" />
        <h1 className="font-display text-4xl">¡Pedido enviado!</h1>
        <p className="text-muted-foreground mt-2">Tu número de pedido es</p>
        <div className="font-display text-6xl text-primary mt-2">#{ticketNumber}</div>
        <p className="text-muted-foreground mt-4 max-w-sm">
          {source === "table_qr"
            ? "Un mesero llegará pronto. Mantén esta pantalla visible."
            : "Acércate a la caja con este número para pagar y recibir tu pedido."}
        </p>
        <Button className="mt-8" size="lg" onClick={() => setConfirmOpen(false)}>
          Hacer otro pedido
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 pb-32">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          {settings?.logo_url ? (
            <img src={settings.logo_url} alt="logo" className="h-10 w-10 rounded-lg object-contain bg-white" />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <IceCream className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1 leading-tight">
            <div className="font-display text-lg">{settings?.business_name ?? "Heladería Goloso"}</div>
            <div className="text-xs text-muted-foreground">
              {source === "kiosk" && "Auto-pedido · Kiosko"}
              {source === "table_qr" && (tableLabel ? `${tableLabel} · Pide desde tu mesa` : "Pide desde tu mesa")}
              {source === "online_menu" && "Menú en línea"}
            </div>
          </div>
          {!readOnly && itemCount > 0 && (
            <Badge className="text-base px-3 py-1">
              <ShoppingCart className="h-4 w-4 mr-1" />
              {itemCount}
            </Badge>
          )}
        </div>

        {/* Categorías */}
        <div className="max-w-5xl mx-auto px-4 pb-3 overflow-x-auto">
          <Tabs value={activeCat} onValueChange={setActiveCat}>
            <TabsList>
              <TabsTrigger value="all">Todos</TabsTrigger>
              {cats.map((c) => (
                <TabsTrigger key={c.id} value={c.id}>{c.name}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* Productos */}
      <main className="max-w-5xl mx-auto px-4 py-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {filtered.map((p) => (
          <Card
            key={p.id}
            className={`overflow-hidden transition ${readOnly ? "" : "cursor-pointer hover:shadow-md active:scale-[0.98]"}`}
            onClick={() => !readOnly && add(p)}
          >
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} className="h-28 w-full object-cover" loading="lazy" />
            ) : (
              <div className="h-28 w-full bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center">
                <IceCream className="h-8 w-8 text-muted-foreground/40" />
              </div>
            )}
            <CardContent className="p-3">
              <div className="font-medium leading-tight line-clamp-2">{p.name}</div>
              <div className="font-display text-primary mt-1">{formatMoney(p.price)}</div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">Sin productos</div>
        )}
      </main>

      {/* Cart bottom */}
      {!readOnly && cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t bg-background shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="max-w-5xl mx-auto px-4 py-3 space-y-3">
            <div className="max-h-48 overflow-y-auto space-y-2">
              {cart.map((l) => (
                <div key={l.key} className="flex items-center gap-2 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{formatMoney(l.unit_price)}</div>
                  </div>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setQty(l.key, l.qty - 1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center font-medium">{l.qty}</span>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setQty(l.key, l.qty + 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setQty(l.key, 0)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
            {source !== "table_qr" && (
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Tu nombre" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                <Input placeholder="Teléfono (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            )}
            <Input placeholder="Notas para cocina (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button size="lg" className="w-full" onClick={submit} disabled={submitting}>
              Enviar pedido · {formatMoney(subtotal)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
