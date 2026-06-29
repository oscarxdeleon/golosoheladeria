import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Minus, Plus, Trash2, ShoppingCart, CheckCircle2, IceCream, Banknote, Smartphone, Landmark, ShoppingBag, Utensils, ArrowLeft } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { ModifiersModal } from "@/components/modifiers-modal";

type KioskService = "llevar" | "comer_aqui";

interface Category { id: string; name: string; sort_order: number; }
interface Product { id: string; name: string; price: number; category_id: string | null; image_url: string | null; active: boolean; is_favorite?: boolean; show_in_online?: boolean; available_branch_ids?: string[] | null; modifier_group_ids?: string[] | null; }
interface CartModifier { id: string; group_id: string; group_name: string; name: string; price: number; qty: number; }
interface CartLine { key: string; product_id: string; name: string; unit_price: number; qty: number; modifiers: CartModifier[]; }

type Source = "kiosk" | "table_qr" | "online_menu";
type PayMethod = "Efectivo" | "Nequi" | "Bancolombia";

export function PublicOrder({
  source,
  tableId,
  tableLabel,
  branchSlug,
  readOnly = false,
}: {
  source: Source;
  tableId?: string;
  tableLabel?: string;
  branchSlug?: string;
  readOnly?: boolean;
}) {

  const qc = useQueryClient();
  const [activeCat, setActiveCat] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
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
  const [kioskService, setKioskService] = useState<KioskService | null>(null);
  const [resetCountdown, setResetCountdown] = useState(30);
  const resetTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: boolean; phone?: boolean; address?: boolean; neighborhood?: boolean }>({});
  const [modalProduct, setModalProduct] = useState<Product | null>(null);

  function resetKiosk() {
    if (resetTimerRef.current) {
      clearInterval(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setConfirmOpen(false);
    setTicketNumber(null);
    setCart([]);
    setCustomerName("");
    setPhone("");
    setAddress("");
    setNeighborhood("");
    setNotes("");
    setCashAmount("");
    setCartOpen(false);
    setActiveCat("all");
    setResetCountdown(30);
    if (source === "kiosk") setKioskService(null);
  }

  useEffect(() => {
    if (!confirmOpen || source !== "kiosk") return;
    setResetCountdown(30);
    resetTimerRef.current = setInterval(() => {
      setResetCountdown((s) => {
        if (s <= 1) {
          if (resetTimerRef.current) clearInterval(resetTimerRef.current);
          resetTimerRef.current = null;
          resetKiosk();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (resetTimerRef.current) clearInterval(resetTimerRef.current);
      resetTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, source]);



  const { data: settings } = useQuery({
    queryKey: ["public-settings"],
    queryFn: async () => (await supabase.from("settings").select("*").maybeSingle()).data,
  });
  const { data: branch } = useQuery({
    queryKey: ["public-branch", branchSlug ?? null],
    queryFn: async () => {
      if (!branchSlug) {
        const { data } = await supabase
          .from("branches")
          .select("id,name,slug")
          .eq("is_main", true)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        return data;
      }
      const { data } = await supabase
        .from("branches")
        .select("id,name,slug")
        .eq("slug", branchSlug)
        .maybeSingle();
      return data;
    },
  });
  const { data: cats = [] } = useQuery<Category[]>({
    queryKey: ["public-cats"],
    queryFn: async () => (await supabase.from("categories").select("*").eq("active", true).order("sort_order")).data ?? [],
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["public-products"],
    queryFn: async () => ((await supabase.from("products").select("*").eq("active", true).order("name")).data ?? []) as unknown as Product[],
  });

  const branchId = (branch as { id?: string } | null | undefined)?.id;
  const visibleProducts = useMemo(
    () => products.filter((p) => {
      if (p.show_in_online === false) return false;
      const ids = p.available_branch_ids;
      if (branchId && ids && ids.length > 0 && !ids.includes(branchId)) return false;
      return true;
    }),
    [products, branchId],
  );
  const favorites = useMemo(() => visibleProducts.filter((p) => p.is_favorite), [visibleProducts]);
  const filtered = useMemo(
    () => visibleProducts.filter((p) => activeCat === "all" || p.category_id === activeCat),
    [visibleProducts, activeCat],
  );
  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const isDelivery = source === "online_menu";
  const deliveryFee = isDelivery ? Number((settings as { delivery_fee?: number | null } | null | undefined)?.delivery_fee ?? 0) : 0;
  const total = subtotal + deliveryFee;

  const nequiNum = (settings as { nequi_number?: string | null } | null | undefined)?.nequi_number ?? "";
  const bancoAcc = (settings as { bancolombia_account?: string | null } | null | undefined)?.bancolombia_account ?? "";

  function add(p: Product) {
    if (p.modifier_group_ids && p.modifier_group_ids.length > 0) {
      setModalProduct(p);
      return;
    }
    setCart((c) => {
      const ex = c.find((l) => l.product_id === p.id && l.modifiers.length === 0);
      if (ex) return c.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: crypto.randomUUID(), product_id: p.id, name: p.name, unit_price: Number(p.price), qty: 1, modifiers: [] }];
    });
    toast.success(`${p.name} agregado`, { duration: 1200 });
  }
  function addWithModifiers(p: Product, mods: CartModifier[], unitExtra: number) {
    const label = mods.length
      ? [p.name, ...mods.map((m) => `  + ${m.qty}× ${m.name}`)].join("\n")
      : p.name;
    setCart((c) => [
      ...c,
      { key: crypto.randomUUID(), product_id: p.id, name: label, unit_price: Number(p.price) + unitExtra, qty: 1, modifiers: mods },
    ]);
    toast.success(`${p.name} agregado`, { duration: 1200 });
  }
  function setQty(key: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, qty } : l))));
  }


  function validate(): string | null {
    if (cart.length === 0) return "Agrega productos primero";
    const errs: typeof fieldErrors = {};
    if (isDelivery) {
      if (!customerName.trim()) errs.name = true;
      if (!phone.trim()) errs.phone = true;
      if (!address.trim()) errs.address = true;
      if (!neighborhood.trim()) errs.neighborhood = true;
      setFieldErrors(errs);
      if (errs.name || errs.phone || errs.address || errs.neighborhood) {
        return "Este campo es obligatorio para envíos a domicilio";
      }
    } else {
      setFieldErrors({});
    }
    if (payMethod === "Efectivo") {
      const v = Number(cashAmount.replace(/[^\d]/g, ""));
      if (!v || v < total) return `Con efectivo debes pagar al menos ${formatMoney(total)}`;
    }
    return null;
  }

  function buildWhatsappMessage(ticket: number) {
    const cashReceived = Number(cashAmount.replace(/[^\d]/g, "")) || 0;
    const change = cashReceived - total;
    const lines: string[] = [];
    lines.push(`*¡Nuevo Pedido de ${settings?.business_name ?? "Heladería Goloso"}!*`);
    lines.push(`*Pedido #:* ${ticket}`);
    if (customerName) lines.push(`*Cliente:* ${customerName}`);
    if (phone) lines.push(`*Teléfono:* ${phone}`);
    if (isDelivery) {
      lines.push(`*Dirección:* ${address} - *Barrio:* ${neighborhood}`);
    } else if (source === "table_qr" && tableLabel) {
      lines.push(`*Mesa:* ${tableLabel}`);
    }
    let pago = `*Método de Pago:* ${payMethod}`;
    if (payMethod === "Efectivo" && cashReceived > 0) {
      pago += ` (Paga con ${formatMoney(cashReceived)} - Cambio: ${formatMoney(change)})`;
    }
    lines.push(pago);
    if (notes) lines.push(`*Notas:* ${notes}`);
    lines.push(`*Detalle del Pedido:*`);
    cart.forEach((l) => {
      lines.push(`- ${l.qty} x ${l.name} (${formatMoney(l.unit_price)})`);
    });
    lines.push(`*Subtotal:* ${formatMoney(subtotal)}`);
    if (deliveryFee > 0) lines.push(`*Domicilio:* ${formatMoney(deliveryFee)}`);
    lines.push(`*Total a Pagar:* ${formatMoney(total)}`);
    return lines.join("\n");
  }


  async function submit() {
    const err = validate();
    if (err) return toast.error(err);
    setSubmitting(true);
    try {
      const cashReceived = Number(cashAmount.replace(/[^\d]/g, "")) || 0;
      const payment_details =
        payMethod === "Efectivo"
          ? { cash_received: cashReceived, change: cashReceived - total }
          : payMethod === "Nequi"
          ? { nequi_number: nequiNum }
          : { bancolombia_account: bancoAcc };



      const payload = {
        source,
        order_type: source === "table_qr" ? "mesa" : source === "kiosk" ? "kiosko" : "domicilio",
        table_id: tableId ?? null,
        branch_id: branch?.id ?? null,
        branch_slug: branchSlug ?? branch?.slug ?? null,
        user_name: source === "kiosk" ? `Kiosko${branch?.name ? " · " + branch.name : ""}` : source === "table_qr" ? `Mesa QR ${tableLabel ?? ""}`.trim() : `Menú en línea${branch?.name ? " · " + branch.name : ""}`,
        customer_name: customerName || null,
        customer_phone: phone || null,
        delivery_address: isDelivery ? address : null,
        delivery_neighborhood: isDelivery ? neighborhood : null,
        notes: source === "kiosk" && kioskService
          ? `[${kioskService === "llevar" ? "PARA LLEVAR" : "COMER AQUÍ"}]${notes ? " " + notes : ""}`
          : notes || null,
        payment_method: payMethod,
        payment_details,
        items: cart.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, unit_price: l.unit_price, modifiers: l.modifiers ?? [] })),
      };
      const { data, error } = await supabase.rpc("create_public_order", {
        _payload: JSON.parse(JSON.stringify(payload)),
      });
      if (error) throw error;
      const result = data as { ticket_number: number } | null;
      if (!result) throw new Error("Sin respuesta del servidor");

      // WhatsApp redirect (only para domicilio / online_menu)
      if (source === "online_menu") {
        const rawPhone = (settings as { phone?: string | null } | null | undefined)?.phone ?? "";
        const digits = rawPhone.replace(/[^\d]/g, "");
        if (digits) {
          const finalPhone = digits.length === 10 ? `57${digits}` : digits;
          const msg = encodeURIComponent(buildWhatsappMessage(result.ticket_number));
          window.open(`https://api.whatsapp.com/send?phone=${finalPhone}&text=${msg}`, "_blank");
        }
      }

      setTicketNumber(result.ticket_number);
      setConfirmOpen(true);
      setCartOpen(false);
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
    const isKiosk = source === "kiosk";
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-primary/10 via-background to-secondary/10">
        <CheckCircle2 className="h-24 w-24 text-success mb-4 animate-in zoom-in duration-500" />
        <h1 className="font-display text-5xl">¡Pedido enviado!</h1>
        <p className="text-muted-foreground mt-2 text-lg">Tu número de pedido es</p>
        <div className="font-display text-7xl text-primary mt-2 drop-shadow-sm">#{ticketNumber}</div>
        <p className="text-muted-foreground mt-4 max-w-md text-lg">
          {source === "table_qr"
            ? "Un mesero llegará pronto. Mantén esta pantalla visible."
            : isDelivery
            ? "Prepararemos tu pedido y lo enviaremos a tu dirección. Te contactaremos al teléfono registrado."
            : "Acércate a la caja con este número para pagar y recibir tu pedido."}
        </p>
        {isKiosk && (
          <>
            <div className="mt-8 inline-flex items-center gap-3 rounded-full bg-primary/10 px-6 py-3 border border-primary/20">
              <div className="relative h-10 w-10 flex items-center justify-center">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-primary/20" />
                  <circle
                    cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3"
                    strokeDasharray={`${(resetCountdown / 30) * 100.5} 100.5`}
                    className="text-primary transition-all duration-1000 ease-linear"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="font-display text-sm font-bold text-primary">{resetCountdown}</span>
              </div>
              <span className="font-medium text-primary">
                La pantalla se reiniciará en {resetCountdown} segundo{resetCountdown === 1 ? "" : "s"}...
              </span>
            </div>
            <Button className="mt-6" size="lg" variant="outline" onClick={resetKiosk}>
              <ArrowLeft className="h-5 w-5" /> Volver al inicio
            </Button>
          </>
        )}
        {!isKiosk && (
          <Button className="mt-8" size="lg" onClick={() => setConfirmOpen(false)}>
            Hacer otro pedido
          </Button>
        )}
      </div>
    );
  }

  if (source === "kiosk" && !kioskService) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-gradient-to-br from-primary/15 via-background to-secondary/20">
        <div className="min-h-full flex flex-col items-center justify-between py-8 px-6 md:py-12 md:px-12">
          {/* Encabezado: logo + sucursal + instrucción */}
          <div className="flex flex-col items-center text-center w-full">
            {settings?.logo_url ? (
              <img
                src={settings.logo_url}
                alt={settings?.business_name ?? "Heladería Goloso"}
                className="max-h-[28vh] max-w-[70vw] object-contain drop-shadow-xl animate-in fade-in zoom-in duration-700"
              />
            ) : (
              <div className="h-40 w-40 rounded-3xl bg-primary text-primary-foreground flex items-center justify-center shadow-2xl">
                <IceCream className="h-20 w-20" />
              </div>
            )}
            <h1 className="font-display text-3xl md:text-5xl mt-6 text-foreground uppercase tracking-wide">
              {settings?.business_name ?? "Heladería Goloso"}{branch?.name ? ` · ${branch.name}` : ""}
            </h1>

            <p className="text-muted-foreground text-base md:text-xl mt-2">
              Toca una opción para empezar tu pedido
            </p>
          </div>

          {/* Botones de tipo de pedido — apilados verticalmente */}
          <div className="w-full max-w-2xl mx-auto mt-8 flex flex-col gap-5">
            <button
              type="button"
              onClick={() => setKioskService("llevar")}
              className="group w-full flex items-center gap-6 rounded-3xl bg-primary text-primary-foreground px-8 py-7 md:py-9 shadow-xl ring-1 ring-primary/30 hover:shadow-2xl hover:brightness-110 transition-all duration-200 active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 text-left"
            >
              <div className="shrink-0 rounded-2xl bg-white/15 p-4 group-hover:scale-110 transition-transform">
                <ShoppingBag className="!h-14 !w-14 md:!h-16 md:!w-16" strokeWidth={2.2} />
              </div>
              <div className="flex-1">
                <div className="font-display text-3xl md:text-4xl font-extrabold leading-tight">
                  PARA LLEVAR
                </div>
                <div className="text-sm md:text-lg opacity-90 mt-1">Llévate tu pedido</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setKioskService("comer_aqui")}
              className="group w-full flex items-center gap-6 rounded-3xl bg-primary text-primary-foreground px-8 py-7 md:py-9 shadow-xl ring-1 ring-primary/30 hover:shadow-2xl hover:brightness-110 transition-all duration-200 active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 text-left"
            >
              <div className="shrink-0 rounded-2xl bg-white/15 p-4 group-hover:scale-110 transition-transform">
                <Utensils className="!h-14 !w-14 md:!h-16 md:!w-16" strokeWidth={2.2} />
              </div>
              <div className="flex-1">
                <div className="font-display text-3xl md:text-4xl font-extrabold leading-tight">
                  PARA COMER AQUÍ
                </div>
                <div className="text-sm md:text-lg opacity-90 mt-1">Disfruta en nuestro local</div>
              </div>
            </button>
          </div>
        </div>
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
            <div className="font-display text-lg">{settings?.business_name ?? "Heladería Goloso"}{branch?.name ? <span className="text-primary"> · {branch.name}</span> : null}</div>
            <div className="text-xs text-muted-foreground">
              {source === "kiosk" && `Auto-pedido · ${kioskService === "llevar" ? "Para llevar" : kioskService === "comer_aqui" ? "Comer aquí" : "Kiosko"}`}
              {source === "table_qr" && (tableLabel ? `${tableLabel} · Pide desde tu mesa` : "Pide desde tu mesa")}
              {source === "online_menu" && "Menú en línea · A domicilio"}
            </div>

          </div>
          {source === "kiosk" && kioskService && (
            <Button size="sm" variant="ghost" onClick={resetKiosk} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Inicio</span>
            </Button>
          )}
          {!readOnly && itemCount > 0 && (
            <Button size="sm" onClick={() => setCartOpen(true)} className="gap-1">
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">Ver carrito</span>
              <Badge variant="secondary" className="ml-1">{itemCount}</Badge>
            </Button>
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

      {favorites.length > 0 && activeCat === "all" && (
        <section className="max-w-5xl mx-auto px-4 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-yellow-400 to-pink-500 flex items-center justify-center shadow-md">
              <span className="text-white text-lg">⭐</span>
            </div>
            <h2 className="font-display text-xl sm:text-2xl bg-gradient-to-r from-pink-600 to-yellow-600 bg-clip-text text-transparent">
              Nuestros Favoritos
            </h2>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x">
            {favorites.map((p) => (
              <Card
                key={p.id}
                className={`shrink-0 w-40 sm:w-48 snap-start overflow-hidden border-2 border-yellow-300 shadow-md transition ${readOnly ? "" : "cursor-pointer hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.98]"}`}
                onClick={() => !readOnly && add(p)}
              >
                <div className="aspect-square w-full overflow-hidden bg-white p-2 flex items-center justify-center relative">
                  <span className="absolute top-1 right-1 text-xs bg-yellow-400 text-yellow-900 font-bold px-1.5 py-0.5 rounded-full shadow">★</span>
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="max-h-full max-w-full object-contain" loading="lazy" />
                  ) : (
                    <IceCream className="h-8 w-8 text-muted-foreground/40" />
                  )}
                </div>
                <CardContent className="p-3">
                  <div className="font-medium text-sm leading-tight line-clamp-2">{p.name}</div>
                  <div className="font-display text-primary mt-1">{formatMoney(p.price)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

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

      {!readOnly && cart.length > 0 && !cartOpen && (
        <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center px-4 pointer-events-none">
          <Button
            size="lg"
            onClick={() => setCartOpen(true)}
            className="pointer-events-auto shadow-lg gap-2 px-6"
          >
            <ShoppingCart className="h-5 w-5" />
            Ver carrito ({itemCount}) · {formatMoney(total)}
          </Button>
        </div>
      )}

      {!readOnly && cartOpen && cart.length > 0 && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center sm:justify-center" onClick={() => setCartOpen(false)}>
          <div
            className="w-full sm:max-w-lg bg-background border-t sm:border sm:rounded-xl shadow-xl max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between">
              <div className="font-display text-lg">Tu pedido</div>
              <Button size="sm" variant="ghost" onClick={() => setCartOpen(false)}>Seguir comprando</Button>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="space-y-2">
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
                  <div className="space-y-1">
                    <Input
                      placeholder={`Nombre ${isDelivery ? "del cliente *" : "*"}`}
                      value={customerName}
                      onChange={(e) => { setCustomerName(e.target.value); if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: false }); }}
                      className={fieldErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
                      required
                    />
                    {fieldErrors.name && <p className="text-xs text-destructive">Este campo es obligatorio para envíos a domicilio</p>}
                  </div>
                  <div className="space-y-1">
                    <Input
                      placeholder={`Teléfono de contacto ${isDelivery ? "*" : "(opcional)"}`}
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => { setPhone(e.target.value); if (fieldErrors.phone) setFieldErrors({ ...fieldErrors, phone: false }); }}
                      className={fieldErrors.phone ? "border-destructive focus-visible:ring-destructive" : ""}
                    />
                    {fieldErrors.phone && <p className="text-xs text-destructive">Este campo es obligatorio para envíos a domicilio</p>}
                  </div>
                  {isDelivery && (
                    <>
                      <div className="space-y-1">
                        <Input
                          placeholder="Dirección completa *"
                          value={address}
                          onChange={(e) => { setAddress(e.target.value); if (fieldErrors.address) setFieldErrors({ ...fieldErrors, address: false }); }}
                          className={fieldErrors.address ? "border-destructive focus-visible:ring-destructive" : ""}
                        />
                        {fieldErrors.address && <p className="text-xs text-destructive">Este campo es obligatorio para envíos a domicilio</p>}
                      </div>
                      <div className="space-y-1">
                        <Input
                          placeholder="Barrio *"
                          value={neighborhood}
                          onChange={(e) => { setNeighborhood(e.target.value); if (fieldErrors.neighborhood) setFieldErrors({ ...fieldErrors, neighborhood: false }); }}
                          className={fieldErrors.neighborhood ? "border-destructive focus-visible:ring-destructive" : ""}
                        />
                        {fieldErrors.neighborhood && <p className="text-xs text-destructive">Este campo es obligatorio para envíos a domicilio</p>}
                      </div>
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
                    {cashAmount && Number(cashAmount) >= total && (
                      <div className="text-xs text-success">Cambio: {formatMoney(Number(cashAmount) - total)}</div>
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

              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
                {deliveryFee > 0 && (
                  <div className="flex justify-between"><span>Tarifa de Domicilio</span><span>{formatMoney(deliveryFee)}</span></div>
                )}
                <div className="flex justify-between font-display text-lg pt-1 border-t"><span>Total</span><span>{formatMoney(total)}</span></div>
              </div>

              <Button size="lg" className="w-full" onClick={submit} disabled={submitting}>
                {submitting ? "Enviando..." : `Finalizar pedido · ${formatMoney(total)}`}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
