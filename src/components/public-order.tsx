import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Minus, Plus, Trash2, ShoppingCart, CheckCircle2, IceCream, Banknote, Smartphone, Landmark } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

interface Category { id: string; name: string; sort_order: number; }
interface Product { id: string; name: string; price: number; category_id: string | null; image_url: string | null; active: boolean; }
interface CartLine { key: string; product_id: string; name: string; unit_price: number; qty: number; }

type Source = "kiosk" | "table_qr" | "online_menu";
type PayMethod = "Efectivo" | "Nequi" | "Bancolombia";

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
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [notes, setNotes] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("Efectivo");
  const [cashAmount, setCashAmount] = useState("");
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
  const isDelivery = source === "online_menu";

  const nequiNum = (settings as { nequi_number?: string | null } | null | undefined)?.nequi_number ?? "";
  const bancoAcc = (settings as { bancolombia_account?: string | null } | null | undefined)?.bancolombia_account ?? "";

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

  function validate(): string | null {
    if (cart.length === 0) return "Agrega productos primero";
    if (source !== "table_qr") {
      if (!customerName.trim()) return "Ingresa tu nombre";
    }
    if (isDelivery) {
      if (!phone.trim()) return "El teléfono es obligatorio para domicilios";
      if (!address.trim()) return "La dirección es obligatoria";
      if (!neighborhood.trim()) return "El barrio es obligatorio";
    }
    if (payMethod === "Efectivo") {
      const v = Number(cashAmount.replace(/[^\d]/g, ""));
      if (!v || v < subtotal) return `Con efectivo debes pagar al menos ${formatMoney(subtotal)}`;
    }
    return null;
  }

  async function submit() {
    const err = validate();
    if (err) return toast.error(err);
    setSubmitting(true);
    try {
      const payment_details =
        payMethod === "Efectivo"
          ? { cash_received: Number(cashAmount.replace(/[^\d]/g, "")), change: Number(cashAmount.replace(/[^\d]/g, "")) - subtotal }
          : payMethod === "Nequi"
          ? { nequi_number: nequiNum }
          : { bancolombia_account: bancoAcc };

      const { data, error } = await supabase.rpc("create_public_order", {
        _payload: {
          source,
          order_type: source === "table_qr" ? "mesa" : source === "kiosk" ? "kiosko" : "domicilio",
          table_id: tableId ?? null,
          user_name: source === "kiosk" ? "Kiosko" : source === "table_qr" ? `Mesa QR ${tableLabel ?? ""}`.trim() : "Menú en línea",
          customer_name: customerName || null,
          customer_phone: phone || null,
          delivery_address: isDelivery ? address : null,
          delivery_neighborhood: isDelivery ? neighborhood : null,
          notes: notes || null,
          payment_method: payMethod,
          payment_details,
          items: cart.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty })),
        },
      });
      if (error) throw error;
      const result = data as { ticket_number: number } | null;
      if (!result) throw new Error("Sin respuesta del servidor");
      setTicketNumber(result.ticket_number);
      setConfirmOpen(true);
      setCart([]);
      setCustomerName("");
      setPhone("");
      setAddress("");
      setNeighborhood("");
      setNotes("");
      setCashAmount("");
      qc.invalidateQueries({ queryKey: ["pending-sales"] });
      qc.invalidateQueries({ queryKey: ["online-orders"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido al enviar el pedido";
      toast.error(msg, { description: "Revisa tu conexión y los datos del formulario." });
      console.error("create_public_order error", e);
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
            : isDelivery
            ? "Prepararemos tu pedido y lo enviaremos a tu dirección. Te contactaremos al teléfono registrado."
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
              {source === "online_menu" && "Menú en línea · A domicilio"}
            </div>
          </div>
          {!readOnly && itemCount > 0 && (
            <Badge className="text-base px-3 py-1">
              <ShoppingCart className="h-4 w-4 mr-1" />
              {itemCount}
            </Badge>
          )}
        </div>

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

      <main className="max-w-5xl mx-auto px-4 py-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {filtered.map((p) => (
          <Card
            key={p.id}
            className={`overflow-hidden transition ${readOnly ? "" : "cursor-pointer hover:shadow-md active:scale-[0.98]"}`}
            onClick={() => !readOnly && add(p)}
          >
            <div className="aspect-square w-full overflow-hidden bg-white p-2 flex items-center justify-center">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="max-h-full max-w-full object-contain" loading="lazy" />
              ) : (
                <IceCream className="h-8 w-8 text-muted-foreground/40" />
              )}
            </div>
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

      {!readOnly && cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t bg-background shadow-[0_-4px_20px_rgba(0,0,0,0.08)] max-h-[80vh] overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 py-3 space-y-3">
            <div className="max-h-40 overflow-y-auto space-y-2">
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
              <div className="space-y-2">
                <Input
                  placeholder={`Nombre ${source !== "table_qr" ? "*" : ""}`}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  required
                />
                <Input
                  placeholder={`Teléfono ${isDelivery ? "*" : "(opcional)"}`}
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {isDelivery && (
                  <>
                    <Input placeholder="Dirección de entrega *" value={address} onChange={(e) => setAddress(e.target.value)} />
                    <Input placeholder="Barrio *" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} />
                  </>
                )}
              </div>
            )}

            <Textarea
              placeholder="Notas para cocina (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />

            <div className="rounded-lg border p-3 space-y-3">
              <div className="text-sm font-medium">Método de pago</div>
              <RadioGroup value={payMethod} onValueChange={(v) => setPayMethod(v as PayMethod)} className="grid grid-cols-3 gap-2">
                {(["Efectivo", "Nequi", "Bancolombia"] as PayMethod[]).map((m) => (
                  <Label
                    key={m}
                    htmlFor={`pm-${m}`}
                    className={`flex flex-col items-center justify-center gap-1 rounded-md border p-2 cursor-pointer text-xs ${payMethod === m ? "border-primary bg-primary/5" : ""}`}
                  >
                    <RadioGroupItem id={`pm-${m}`} value={m} className="sr-only" />
                    {m === "Efectivo" && <Banknote className="h-5 w-5" />}
                    {m === "Nequi" && <Smartphone className="h-5 w-5" />}
                    {m === "Bancolombia" && <Landmark className="h-5 w-5" />}
                    <span className="font-medium">{m}</span>
                  </Label>
                ))}
              </RadioGroup>

              {payMethod === "Efectivo" && (
                <div className="space-y-1">
                  <Label className="text-xs">¿Con cuánto vas a pagar?</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="Ej: 50000"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value.replace(/[^\d]/g, ""))}
                  />
                  {cashAmount && Number(cashAmount) >= subtotal && (
                    <div className="text-xs text-success">Cambio: {formatMoney(Number(cashAmount) - subtotal)}</div>
                  )}
                </div>
              )}
              {payMethod === "Nequi" && (
                <div className="space-y-1">
                  <Label className="text-xs">Número Nequi del negocio</Label>
                  <Input value={nequiNum} readOnly placeholder="No configurado" />
                  <div className="text-[11px] text-muted-foreground">Transfiere a este número y trae el comprobante.</div>
                </div>
              )}
              {payMethod === "Bancolombia" && (
                <div className="space-y-1">
                  <Label className="text-xs">Cuenta Bancolombia del negocio</Label>
                  <Input value={bancoAcc} readOnly placeholder="No configurado" />
                  <div className="text-[11px] text-muted-foreground">Transfiere a esta cuenta y trae el comprobante.</div>
                </div>
              )}
            </div>

            <Button size="lg" className="w-full" onClick={submit} disabled={submitting}>
              {submitting ? "Enviando..." : `Enviar pedido · ${formatMoney(subtotal)}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
