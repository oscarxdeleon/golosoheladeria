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
import { Minus, Plus, Trash2, ShoppingCart, CheckCircle2, IceCream, Banknote, ShoppingBag, Utensils, ArrowLeft, BellRing, Copy, Check, Bike, Store } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { ModifiersModal } from "@/components/modifiers-modal";
import { sendToLocalPrinter } from "@/lib/print-client";
import { PwaInstallButton } from "@/components/pwa-install-button";
import nequiLogo from "@/assets/nequi-logo-original.jpg";
import bancolombiaLogo from "@/assets/bancolombia-logo-original.png";
import golosoLogo from "@/assets/logo-goloso.png";

const CUSTOMER_STORAGE_KEY = "goloso.online.customer.v1";

type StoredOnlineCustomer = {
  name?: string;
  phone?: string;
  address?: string;
  neighborhood?: string;
  savedAt?: string;
};

function sanitizeOnlineCustomer(data: StoredOnlineCustomer): StoredOnlineCustomer {
  return {
    name: String(data.name ?? "").trim(),
    phone: String(data.phone ?? "").trim(),
    address: String(data.address ?? "").trim(),
    neighborhood: String(data.neighborhood ?? "").trim(),
    savedAt: data.savedAt ?? new Date().toISOString(),
  };
}

function readStoredOnlineCustomer(): StoredOnlineCustomer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredOnlineCustomer;
    const saved = sanitizeOnlineCustomer(parsed);
    return saved.name || saved.phone || saved.address || saved.neighborhood ? saved : null;
  } catch {
    return null;
  }
}

function writeStoredOnlineCustomer(data: StoredOnlineCustomer) {
  if (typeof window === "undefined") return;
  const saved = sanitizeOnlineCustomer({ ...data, savedAt: new Date().toISOString() });
  if (!saved.name && !saved.phone && !saved.address && !saved.neighborhood) return;
  try {
    window.localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* ignore */
  }
}

function toAbsolutePrintUrl(url?: string | null): string | undefined {
  const value = String(url ?? "").trim();
  if (!value) return undefined;
  if (/^data:/i.test(value)) return value;
  try {
    if (typeof window !== "undefined") return new URL(value, window.location.origin).href;
    return new URL(value).href;
  } catch {
    return undefined;
  }
}



type KioskService = "llevar" | "comer_aqui";
type OnlineService = "domicilio" | "recoger";

interface Category { id: string; name: string; sort_order: number; online_sort_order?: number; kiosk_sort_order?: number; show_in_pos?: boolean; show_in_online_menu?: boolean; }
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
  const [onlineService, setOnlineService] = useState<OnlineService | null>(null);
  const [resetCountdown, setResetCountdown] = useState(30);
  const resetTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [kioskStage, setKioskStage] = useState<"ticket" | "feedback">("ticket");
  const ticketAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSentRating, setFeedbackSentRating] = useState<number | null>(null);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: boolean; phone?: boolean; address?: boolean; neighborhood?: boolean }>({});
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const [callingWaiter, setCallingWaiter] = useState(false);
  const [waiterCalledAt, setWaiterCalledAt] = useState<number | null>(null);
  const [copiedAccount, setCopiedAccount] = useState(false);

  // Recordar datos del cliente entre pedidos del menú en línea.
  useEffect(() => {
    if (source !== "online_menu") return;
    const saved = readStoredOnlineCustomer();
    if (!saved) return;
    setCustomerName((current) => current || saved.name || "");
    setPhone((current) => current || saved.phone || "");
    setAddress((current) => current || saved.address || "");
    setNeighborhood((current) => current || saved.neighborhood || "");
  }, [source]);

  useEffect(() => {
    if (source !== "online_menu") return;
    const hasCustomerData = customerName.trim() || phone.trim() || address.trim() || neighborhood.trim();
    if (!hasCustomerData) return;
    const saveTimer = window.setTimeout(() => {
      writeStoredOnlineCustomer({ name: customerName, phone, address, neighborhood });
    }, 400);
    return () => window.clearTimeout(saveTimer);
  }, [source, customerName, phone, address, neighborhood]);

  async function copyToClipboard(value: string, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedAccount(true);
      toast.success(`${label} copiado`);
      setTimeout(() => setCopiedAccount(false), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  async function callWaiter() {
    if (!tableId || callingWaiter) return;
    if (waiterCalledAt && Date.now() - waiterCalledAt < 30000) {
      toast.info("Ya avisamos al mesero. Espera un momento por favor.");
      return;
    }
    setCallingWaiter(true);
    try {
      const { error } = await supabase.rpc("create_waiter_call", { _table_id: tableId, _reason: undefined });
      if (error) throw error;
      setWaiterCalledAt(Date.now());
      toast.success("¡Listo! Un mesero irá a tu mesa en un momento.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo llamar al mesero");
    } finally {
      setCallingWaiter(false);
    }
  }

  function resetKiosk() {
    if (resetTimerRef.current) {
      clearInterval(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (ticketAdvanceRef.current) {
      clearTimeout(ticketAdvanceRef.current);
      ticketAdvanceRef.current = null;
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
    setKioskStage("ticket");
    setFeedbackSentRating(null);
    setLastSaleId(null);
    if (source === "kiosk") setKioskService(null);
  }

  // Kiosk: mostrar ticket ~8s, luego pasar a pantalla de calificación
  useEffect(() => {
    if (!confirmOpen || source !== "kiosk" || kioskStage !== "ticket") return;
    ticketAdvanceRef.current = setTimeout(() => {
      setKioskStage("feedback");
    }, 8000);
    return () => {
      if (ticketAdvanceRef.current) clearTimeout(ticketAdvanceRef.current);
      ticketAdvanceRef.current = null;
    };
  }, [confirmOpen, source, kioskStage]);

  // Kiosk: cuenta regresiva de 30s durante la pantalla de calificación
  useEffect(() => {
    if (!confirmOpen || source !== "kiosk" || kioskStage !== "feedback") return;
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
  }, [confirmOpen, source, kioskStage]);

  async function submitFeedback(rating: number) {
    if (feedbackSubmitting || feedbackSentRating != null) return;
    setFeedbackSubmitting(true);
    setFeedbackSentRating(rating);
    try {
      await supabase.from("kiosk_feedback").insert({
        rating,
        branch_id: branchId ?? null,
        sale_id: lastSaleId,
        source: "kiosk",
      });
    } catch (e) {
      console.error("kiosk_feedback insert failed", e);
    } finally {
      setFeedbackSubmitting(false);
      setTimeout(() => resetKiosk(), 1500);
    }
  }



  const { data: settings } = useQuery({
    queryKey: ["public-settings"],
    queryFn: async () => (await supabase.from("settings").select("*").eq("id", 1).maybeSingle()).data,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: branch } = useQuery({
    queryKey: ["public-branch", branchSlug ?? null],
    queryFn: async () => {
      if (!branchSlug) {
        const { data } = await supabase
          .from("branches")
          .select("id,name,slug,phone,address,nit,logo_url")
          .eq("is_main", true)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        return data;
      }
      const { data } = await supabase
        .from("branches")
        .select("id,name,slug,phone,address,nit,logo_url")
        .eq("slug", branchSlug)
        .maybeSingle();
      return data;
    },
  });
  const { data: cats = [] } = useQuery<Category[]>({
    queryKey: ["public-cats", source],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("*").eq("active", true);
      const list = ((data ?? []) as Category[]).filter((c) => c.show_in_online_menu !== false);
      const key: keyof Category = source === "kiosk" ? "kiosk_sort_order" : "online_sort_order";
      return list.sort((a, b) => {
        const oa = (a[key] as number | undefined) ?? a.sort_order ?? 0;
        const ob = (b[key] as number | undefined) ?? b.sort_order ?? 0;
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name, "es");
      });
    },
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["public-products"],
    queryFn: async () => ((await supabase.from("products").select("*").eq("active", true).order("name")).data ?? []) as unknown as Product[],
  });

  const branchId = (branch as { id?: string } | null | undefined)?.id;
  const visibleCatIds = useMemo(() => new Set(cats.map((c) => c.id)), [cats]);
  const visibleProducts = useMemo(
    () => products.filter((p) => {
      if (p.show_in_online === false) return false;
      if (p.category_id && !visibleCatIds.has(p.category_id)) return false;
      const ids = p.available_branch_ids;
      if (branchId && ids && ids.length > 0 && !ids.includes(branchId)) return false;
      return true;
    }),
    [products, branchId, visibleCatIds],
  );
  const favorites = useMemo(() => visibleProducts.filter((p) => p.is_favorite), [visibleProducts]);
  void favorites;
  const filtered = useMemo(() => {
    const list = visibleProducts.filter((p) => activeCat === "all" || p.category_id === activeCat);
    if (activeCat !== "all") return list;
    // Orden global: por categoría (sort_order) y luego nombre del producto.
    const order = new Map(cats.map((c, i) => [c.id, i]));
    return [...list].sort((a, b) => {
      const oa = a.category_id ? (order.get(a.category_id) ?? 999) : 999;
      const ob = b.category_id ? (order.get(b.category_id) ?? 999) : 999;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name, "es");
    });
  }, [visibleProducts, activeCat, cats]);

  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const isDelivery = source === "online_menu" && onlineService === "domicilio";
  const isPickup = source === "online_menu" && onlineService === "recoger";
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
    const phoneDigits = phone.replace(/\D/g, "");
    const phoneOk = phoneDigits.length >= 7;

    if (source !== "table_qr") {
      // Nombre y teléfono siempre obligatorios en menú en línea y kiosko.
      if (!customerName.trim()) errs.name = true;
      if (!phoneOk) errs.phone = true;
    }

    if (isDelivery) {
      if (!address.trim()) errs.address = true;
      if (!neighborhood.trim()) errs.neighborhood = true;
    }

    setFieldErrors(errs);
    if (errs.name) return "Ingresa tu nombre";
    if (errs.phone) return "Ingresa un teléfono de contacto válido";
    if (errs.address || errs.neighborhood) return "Completa la dirección de envío";

    if (isPickup && payMethod !== "Nequi" && payMethod !== "Bancolombia") {
      return "Para recoger en heladería el pago debe ser por Nequi o Bancolombia";
    }
    if (source !== "table_qr" && payMethod === "Efectivo") {
      const v = Number(cashAmount.replace(/[^\d]/g, ""));
      if (!v || v < total) return `Con efectivo debes pagar al menos ${formatMoney(total)}`;
    }
    return null;
  }


  function buildWhatsappMessage(ticket: number) {
    const cashReceived = Number(cashAmount.replace(/[^\d]/g, "")) || 0;
    const change = cashReceived - total;
    const br = branch as { name?: string | null; address?: string | null; phone?: string | null; nit?: string | null } | null | undefined;
    const sedeName = br?.name?.trim() || (settings as { business_name?: string } | null | undefined)?.business_name || "Heladería Goloso";
    const sedeAddr = br?.address || (settings as { address?: string | null } | null | undefined)?.address || "";
    const sedePhone = br?.phone || (settings as { phone?: string | null } | null | undefined)?.phone || "";
    const lines: string[] = [];
    lines.push(`*¡Nuevo Pedido de ${sedeName}!*`);
    if (sedeAddr) lines.push(`📍 ${sedeAddr}`);
    if (sedePhone) lines.push(`📞 ${sedePhone}`);
    lines.push(`*Pedido #:* ${ticket}`);
    if (customerName) lines.push(`*Cliente:* ${customerName}`);
    if (phone) lines.push(`*Teléfono:* ${phone}`);
    if (isDelivery) {
      lines.push(`*Dirección:* ${address} - *Barrio:* ${neighborhood}`);
    } else if (isPickup) {
      lines.push(`*Pedido para RECOGER en heladería*`);
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
    if (payMethod === "Nequi" || payMethod === "Bancolombia") {
      lines.push("");
      lines.push(`*¡ENVIANOS EL COMPROBANTE DE PAGO!!*`);
    }
    // Loyalty block
    const loyaltyEnabled = (settings as { loyalty_enabled?: boolean } | null | undefined)?.loyalty_enabled ?? true;
    const perK = Number((settings as { loyalty_points_per_1000?: number } | null | undefined)?.loyalty_points_per_1000 ?? 1);
    if (loyaltyEnabled && perK > 0 && phone) {
      const pts = Math.floor(total / 1000) * perK;
      if (pts > 0) {
        lines.push("");
        lines.push(`⭐ *Ganaste ${pts} puntos Goloso Club*`);
        lines.push(`Consulta tu saldo: ${typeof window !== "undefined" ? window.location.origin : ""}/mis-puntos`);
      }
    }
    return lines.join("\n");
  }


  async function submit() {
    const err = validate();
    if (err) return toast.error(err);
    setSubmitting(true);
    try {
      const cashReceived = Number(cashAmount.replace(/[^\d]/g, "")) || 0;
      const isTableQr = source === "table_qr";
      const payment_details = isTableQr
        ? {}
        : payMethod === "Efectivo"
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
        user_name: source === "kiosk" ? `Autopedido${branch?.name ? " · " + branch.name : ""}` : source === "table_qr" ? `Mesa QR ${tableLabel ?? ""}`.trim() : `Menú en línea${branch?.name ? " · " + branch.name : ""}`,
        customer_name: customerName || null,
        customer_phone: phone || null,
        delivery_address: isDelivery ? address : null,
        delivery_neighborhood: isDelivery ? neighborhood : null,
        notes: source === "kiosk" && kioskService
          ? `[${kioskService === "llevar" ? "PARA LLEVAR" : "COMER AQUÍ"}]${notes ? " " + notes : ""}`
          : isPickup
          ? `[RECOGER EN HELADERÍA]${notes ? " " + notes : ""}`
          : notes || null,
        payment_method: isTableQr ? "Pendiente" : payMethod,
        payment_details,
        items: cart.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, unit_price: l.unit_price, modifiers: l.modifiers ?? [] })),
      };

      const { data, error } = await supabase.rpc("create_public_order", {
        _payload: JSON.parse(JSON.stringify(payload)),
      });
      if (error) throw error;
      const result = data as { ticket_number: number; sale_id?: string | null } | null;
      if (!result) throw new Error("Sin respuesta del servidor");

      const savedOnlineCustomer = sanitizeOnlineCustomer({ name: customerName, phone, address, neighborhood });
      if (source === "online_menu") writeStoredOnlineCustomer(savedOnlineCustomer);

      // WhatsApp redirect (only para domicilio / online_menu)
      if (source === "online_menu") {
        const rawPhone = (branch as { phone?: string | null } | null | undefined)?.phone
          ?? (settings as { phone?: string | null } | null | undefined)?.phone
          ?? "";
        const digits = rawPhone.replace(/[^\d]/g, "");
        if (digits) {
          const finalPhone = digits.length === 10 ? `57${digits}` : digits;
          const msg = encodeURIComponent(buildWhatsappMessage(result.ticket_number));
          window.open(`https://api.whatsapp.com/send?phone=${finalPhone}&text=${msg}`, "_blank");
        }
      }

      setTicketNumber(result.ticket_number);
      setLastSaleId(result.sale_id ?? null);
      setKioskStage("ticket");
      setFeedbackSentRating(null);
      setConfirmOpen(true);
      setCartOpen(false);

      // Auto-impresión: solo comanda de cocina/preparación.
      // El ticket de venta se emite únicamente al confirmar el pago desde el POS.
      if (source === "kiosk" || source === "online_menu") {
        const br = branch as { name?: string | null; address?: string | null; phone?: string | null; nit?: string | null; logo_url?: string | null } | null | undefined;
        const st = settings as { business_name?: string | null; address?: string | null; phone?: string | null; nit?: string | null; logo_url?: string | null; footer_text?: string | null; email?: string | null; ticket_config?: Record<string, unknown> | null } | null | undefined;
        const printItems = cart.map((l) => ({ name: l.name, qty: l.qty, unit_price: l.unit_price }));
        const header = source === "kiosk"
          ? `PEDIDO AUTOPEDIDO${kioskService === "llevar" ? " · PARA LLEVAR" : kioskService === "comer_aqui" ? " · COMER AQUÍ" : ""}`
          : "PEDIDO EN LÍNEA";
        const business_name = br?.name?.trim() || st?.business_name || "Heladería Goloso";
        const address_biz = br?.address || st?.address || "";
        const phone_biz = br?.phone || st?.phone || "";
        const nit = br?.nit || st?.nit || "";
        const logo_url = toAbsolutePrintUrl(br?.logo_url || st?.logo_url) ?? toAbsolutePrintUrl(golosoLogo);
        const logo_fallback_url = toAbsolutePrintUrl(golosoLogo);
        const ticket_config = { ...(st?.ticket_config ?? {}), show_logo: true };
        const created_at = new Date().toISOString();

        // Comanda cocina
        void sendToLocalPrinter({
          type: "comanda",
          ticket: result.ticket_number,
          ticket_number: result.ticket_number,
          header,
          items: printItems,
          customer: customerName || undefined,
          notes: payload.notes ?? undefined,
          address: isDelivery ? address : undefined,
          phone: phone || undefined,
          created_at,
          business_name,
          nit,
          address_biz,
          phone_biz,
          logo_url,
          logo_fallback_url,
          ticket_config,
          ticket_template: "goloso_personalizado",
        });
      }

      setCart([]);

      if (source === "online_menu") {
        setCustomerName(savedOnlineCustomer.name || "");
        setPhone(savedOnlineCustomer.phone || "");
        setAddress(savedOnlineCustomer.address || "");
        setNeighborhood(savedOnlineCustomer.neighborhood || "");
      } else {
        setCustomerName("");
        setPhone("");
        setAddress("");
        setNeighborhood("");
      }
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

    // KIOSK: pantalla de calificación después del ticket
    if (isKiosk && kioskStage === "feedback") {
      const ratings = [
        { value: 1, emoji: "😡", label: "MUY MALO" },
        { value: 2, emoji: "🙁", label: "MALO" },
        { value: 3, emoji: "😐", label: "REGULAR" },
        { value: 4, emoji: "😊", label: "BUENO" },
        { value: 5, emoji: "🤩", label: "EXCELENTE" },
      ];
      return (
        <div
          className="min-h-screen flex flex-col items-center justify-between px-6 py-10 text-center text-white relative overflow-hidden"
          style={{ background: "radial-gradient(circle at 20% 15%, #1e3a8a 0%, #0b1a5c 55%, #060f3d 100%)" }}
        >
          <div className="absolute -top-24 -left-16 h-72 w-72 rounded-full bg-blue-500/40 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-blue-900/60 blur-3xl pointer-events-none" />

          <div className="flex-1 flex flex-col items-center justify-center gap-6 relative z-10">
            <img
              src="/__l5e/assets-v1/8acb9227-b9fd-468e-b2b8-63d3cc30c823/goloso-mascot.png"
              alt="Goloso"
              className="h-56 sm:h-72 w-auto drop-shadow-2xl select-none"
              draggable={false}
            />
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              ¿Cómo fue tu experiencia?
            </h1>
            <div className="flex items-center gap-2 text-2xl sm:text-3xl text-green-400 drop-shadow">
              {"★★★★★".split("").map((s, i) => (
                <span key={i}>{s}</span>
              ))}
            </div>

            <div className="w-full max-w-2xl rounded-3xl bg-white text-slate-900 shadow-2xl px-4 py-6 sm:px-8 sm:py-8">
              <div className="grid grid-cols-5 gap-2 sm:gap-4">
                {ratings.map((r) => {
                  const selected = feedbackSentRating === r.value;
                  const disabled = feedbackSubmitting || feedbackSentRating != null;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => submitFeedback(r.value)}
                      className={`flex flex-col items-center gap-2 rounded-2xl p-2 sm:p-3 transition active:scale-95 ${selected ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-slate-100"} ${disabled && !selected ? "opacity-50" : ""}`}
                    >
                      <span className="text-4xl sm:text-5xl leading-none">{r.emoji}</span>
                      <span className="text-[10px] sm:text-xs font-bold tracking-wide text-slate-700 whitespace-pre-line">
                        {r.label.replace(" ", "\n")}
                      </span>
                    </button>
                  );
                })}
              </div>
              {feedbackSentRating != null && (
                <p className="mt-4 text-sm font-semibold text-primary">
                  ¡Gracias por tu opinión!
                </p>
              )}
            </div>
          </div>

          <div className="relative z-10 mt-6 flex flex-col items-center gap-3">
            <div className="inline-flex items-center gap-3 rounded-full bg-white/10 px-5 py-2 border border-white/20 backdrop-blur">
              <div className="relative h-8 w-8 flex items-center justify-center">
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-white/20" />
                  <circle
                    cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3"
                    strokeDasharray={`${(resetCountdown / 30) * 100.5} 100.5`}
                    className="text-green-400 transition-all duration-1000 ease-linear"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-xs font-bold">{resetCountdown}</span>
              </div>
              <span className="text-sm font-medium">Volviendo al inicio en {resetCountdown}s</span>
            </div>
          </div>
        </div>
      );
    }

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
          <Button className="mt-8" size="lg" onClick={() => setKioskStage("feedback")}>
            Continuar
          </Button>
        )}
        {!isKiosk && (
          <Button className="mt-8" size="lg" onClick={() => setConfirmOpen(false)}>
            Hacer otro pedido
          </Button>
        )}
        {source === "table_qr" && tableId && (
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button
              size="lg"
              variant="outline"
              className="h-14 px-6 text-lg border-2 border-amber-500 text-amber-700 hover:bg-amber-50 animate-pulse"
              onClick={callWaiter}
              disabled={callingWaiter}
            >
              <BellRing className="h-6 w-6 mr-2" />
              {callingWaiter ? "Llamando…" : "Llamar al mesero"}
            </Button>
            <p className="text-xs text-muted-foreground">¿Necesitas algo más? Toca para avisar.</p>
          </div>
        )}
      </div>
    );
  }

  if (source === "kiosk" && !kioskService) {
    const kioskLogo = settings?.logo_url ?? null;
    const kioskName = (branch?.name?.trim() || settings?.business_name || "Heladería Goloso").toUpperCase();
    return (
      <div className="fixed inset-0 z-50 overflow-hidden bg-gradient-to-br from-white via-sky-50 to-fuchsia-50">
        <div className="h-full w-full flex flex-col items-center justify-between py-4 px-4 sm:py-6 sm:px-8 md:py-10">
          {/* Logo protagonista (a color, fondo transparente, sin recuadro) */}
          <div className="flex flex-col items-center text-center w-full min-h-0 flex-1 justify-center">
            {kioskLogo ? (
              <img
                src={kioskLogo}
                alt={kioskName}
                className="max-h-[40vh] max-w-[85vw] object-contain bg-transparent animate-in fade-in zoom-in duration-700 motion-safe:animate-[pulse_4s_ease-in-out_infinite]"
              />
            ) : (
              <div className="h-32 w-32 rounded-3xl bg-primary text-primary-foreground flex items-center justify-center shadow-2xl">
                <IceCream className="h-16 w-16" />
              </div>
            )}
            <h1 className="font-display font-black text-2xl sm:text-3xl md:text-4xl mt-4 tracking-wide text-slate-800">
              {kioskName}
            </h1>
            <p className="text-slate-600 text-sm sm:text-base md:text-lg mt-2 font-medium">
              Toca una opción para empezar tu pedido
            </p>
          </div>

          {/* Botones premium — compactos para caber en móvil/tablet */}
          <div className="w-full max-w-4xl mx-auto grid grid-cols-2 gap-3 sm:gap-5">
            <button
              type="button"
              onClick={() => setKioskService("comer_aqui")}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-600 text-white px-4 py-5 sm:py-8 shadow-2xl ring-1 ring-white/30 hover:scale-105 active:scale-95 transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300"
            >
              <span className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
              <div className="relative flex flex-col items-center gap-2 sm:gap-3">
                <div className="rounded-2xl bg-white/20 backdrop-blur-sm p-3 sm:p-4 shadow-inner group-hover:scale-110 transition-transform duration-300">
                  <Utensils className="!h-9 !w-9 sm:!h-12 sm:!w-12 md:!h-14 md:!w-14 drop-shadow-lg" strokeWidth={2.2} />
                </div>
                <div className="font-display font-black text-lg sm:text-2xl md:text-3xl tracking-wide drop-shadow">
                  COMER AQUÍ
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setKioskService("llevar")}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-fuchsia-600 text-white px-4 py-5 sm:py-8 shadow-2xl ring-1 ring-white/30 hover:scale-105 active:scale-95 transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-300"
            >
              <span className="pointer-events-none absolute -top-16 -left-16 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
              <div className="relative flex flex-col items-center gap-2 sm:gap-3">
                <div className="rounded-2xl bg-white/20 backdrop-blur-sm p-3 sm:p-4 shadow-inner group-hover:scale-110 transition-transform duration-300">
                  <ShoppingBag className="!h-9 !w-9 sm:!h-12 sm:!w-12 md:!h-14 md:!w-14 drop-shadow-lg" strokeWidth={2.2} />
                </div>
                <div className="font-display font-black text-lg sm:text-2xl md:text-3xl tracking-wide drop-shadow">
                  PARA LLEVAR
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (source === "online_menu" && !onlineService && !readOnly) {
    const onlineLogo = settings?.logo_url ?? null;
    const onlineName = (branch?.name?.trim() || settings?.business_name || "Heladería Goloso").toUpperCase();
    return (
      <div className="fixed inset-0 z-50 overflow-hidden bg-gradient-to-br from-white via-sky-50 to-fuchsia-50">
        {/* Botón instalar PWA arriba a la derecha (solo aparece si es instalable) */}
        <div className="absolute top-3 right-3 z-10">
          <PwaInstallButton className="h-9 gap-2 px-3 text-xs bg-gradient-primary text-primary-foreground shadow-glow" />
        </div>
        <div className="h-full w-full flex flex-col items-center justify-between py-6 px-4 sm:py-10 sm:px-8">
          <div className="flex flex-col items-center text-center w-full min-h-0 flex-1 justify-center">
            {onlineLogo ? (
              <img
                src={onlineLogo}
                alt={onlineName}
                className="max-h-[38vh] max-w-[85vw] object-contain bg-transparent animate-in fade-in zoom-in duration-700"
              />
            ) : (
              <div className="h-36 w-36 rounded-3xl bg-primary text-primary-foreground flex items-center justify-center shadow-2xl">
                <IceCream className="h-20 w-20" />
              </div>
            )}
            <h1 className="font-display font-black text-2xl sm:text-4xl mt-5 tracking-wide text-slate-800">
              {onlineName}
            </h1>
            <p className="text-slate-600 text-sm sm:text-base mt-2 font-medium">
              ¿Cómo quieres recibir tu pedido?
            </p>
          </div>

          <div className="w-full max-w-2xl mx-auto flex flex-col gap-5 sm:gap-6 pb-4">
            {[
              {
                key: "domicilio" as const,
                icon: Bike,
                title: "A DOMICILIO",
                subtitle: "Te lo llevamos a tu dirección",
                pay: "Efectivo" as const,
                titleAccent: "text-lime-400",
                titleBase: "text-white",
              },
              {
                key: "recoger" as const,
                icon: Store,
                title: "RECOGER EN HELADERÍA",
                subtitle: "Pásalo a recoger tú mismo",
                pay: "Nequi" as const,
                titleAccent: "text-lime-400",
                titleBase: "text-white",
                splitTitle: true,
              },
            ].map((btn) => {
              const Icon = btn.icon;
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => { setOnlineService(btn.key); setPayMethod(btn.pay); }}
                  className="group relative w-full rounded-[28px] p-[3px] bg-gradient-to-b from-lime-300 via-lime-500 to-lime-700 shadow-[0_18px_40px_-12px_rgba(16,94,90,0.55)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_26px_50px_-14px_rgba(16,94,90,0.7)] active:translate-y-0.5 active:shadow-[0_10px_20px_-8px_rgba(16,94,90,0.6)] focus:outline-none focus-visible:ring-4 focus-visible:ring-lime-300/60"
                >
                  <div
                    className="relative overflow-hidden rounded-[24px] px-4 py-5 sm:px-6 sm:py-6 flex items-center gap-4 sm:gap-6"
                    style={{
                      background:
                        "linear-gradient(160deg, #1f6d78 0%, #16545e 45%, #0e3d47 100%)",
                    }}
                  >
                    {/* brillo superior */}
                    <span className="pointer-events-none absolute inset-x-3 top-1 h-1/3 rounded-[20px] bg-gradient-to-b from-white/25 to-transparent" />
                    {/* sombra inferior interna */}
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />

                    {/* Icono cuadrado verde */}
                    <div className="relative shrink-0">
                      <div className="absolute inset-0 rounded-2xl bg-lime-700/70 blur-[2px] translate-y-1" />
                      <div
                        className="relative h-16 w-16 sm:h-20 sm:w-20 rounded-2xl flex items-center justify-center ring-1 ring-lime-200/60 transition-transform duration-200 group-hover:scale-[1.04] group-active:scale-95"
                        style={{
                          background:
                            "linear-gradient(160deg, #d4ff5a 0%, #a4e424 40%, #6fb31a 100%)",
                          boxShadow:
                            "inset 0 2px 4px rgba(255,255,255,0.55), inset 0 -6px 10px rgba(0,60,0,0.35), 0 4px 10px rgba(0,0,0,0.25)",
                        }}
                      >
                        <Icon className="h-9 w-9 sm:h-11 sm:w-11 text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]" strokeWidth={2.4} />
                      </div>
                    </div>

                    {/* Texto */}
                    <div className="relative flex-1 min-w-0 text-left">
                      <div
                        className={`font-display font-black leading-[1.05] tracking-wide text-2xl sm:text-3xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] ${btn.titleAccent}`}
                        style={{ WebkitTextStroke: "0.5px rgba(0,0,0,0.35)" }}
                      >
                        {btn.splitTitle ? (
                          <>
                            <span className={btn.titleBase}>RECOGER EN</span>
                            <br />
                            <span className={btn.titleAccent}>HELADERÍA</span>
                          </>
                        ) : (
                          <>
                            <span className={btn.titleBase}>A </span>
                            <span className={btn.titleAccent}>DOMICILIO</span>
                          </>
                        )}
                      </div>
                      {/* línea decorativa */}
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-lime-400 shadow-[0_0_6px_rgba(163,230,53,0.9)]" />
                        <span className="h-[2px] flex-1 bg-gradient-to-r from-lime-400/90 via-lime-400/60 to-transparent rounded-full" />
                        <span className="h-1.5 w-1.5 rounded-full bg-lime-400 shadow-[0_0_6px_rgba(163,230,53,0.9)]" />
                      </div>
                      <div className="mt-1 text-xs sm:text-sm font-medium text-white/90 truncate">
                        {btn.subtitle}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

        </div>
      </div>
    );
  }





  return (
    <div className="min-h-screen bg-muted/30 pb-32 overflow-x-hidden w-full max-w-full">
      <header className="sticky top-0 z-20 bg-background border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          {settings?.logo_url ? (
            <img src={settings.logo_url} alt="logo" className="h-16 w-16 object-contain bg-transparent" />



          ) : (
            <div className="h-16 w-16 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <IceCream className="h-7 w-7" />
            </div>
          )}
          <div className="flex-1 leading-tight">
            {(() => {
              const biz = settings?.business_name ?? "Heladería Goloso";
              const br = branch?.name?.trim();
              if (source === "table_qr") {
                const sedeName = br || biz;
                const mesaOnly = tableLabel ? tableLabel.split("·")[0].trim() : "";
                return (
                  <>
                    <div className="font-display text-2xl">{sedeName}</div>
                    {mesaOnly ? (
                      <div className="font-display text-lg font-extrabold tracking-tight">
                        {mesaOnly}
                      </div>
                    ) : null}
                  </>
                );
              }

              const showBranch = br && br.toLowerCase() !== biz.toLowerCase();
              return (
                <>
                  <div className="font-display text-lg">
                    {biz}
                    {showBranch ? <span className="text-primary"> · {br}</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {source === "kiosk" && `Auto-pedido · ${kioskService === "llevar" ? "Para llevar" : kioskService === "comer_aqui" ? "Comer aquí" : "Autopedido"}`}
                    {source === "online_menu" && `Menú en línea · ${onlineService === "recoger" ? "Recoger en heladería" : "A domicilio"}`}
                  </div>
                </>
              );
            })()}

          </div>

          {source === "kiosk" && kioskService && (
            <Button size="sm" variant="ghost" onClick={resetKiosk} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Inicio</span>
            </Button>
          )}
          {source === "online_menu" && onlineService && (
            <Button size="sm" variant="ghost" onClick={() => { setOnlineService(null); setCart([]); setCartOpen(false); }} className="gap-1">
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
          {source === "table_qr" && tableId && (
            <Button
              size="sm"
              onClick={callWaiter}
              disabled={callingWaiter}
              className="gap-1 bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-lg animate-pulse"
            >
              <BellRing className="h-4 w-4" />
              <span>Llamar al Mesero</span>
            </Button>
          )}
          <PwaInstallButton className="h-8 gap-1 px-3 text-xs bg-gradient-primary text-primary-foreground shadow-glow" />




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
              <div
                className="font-bold leading-tight line-clamp-2 uppercase tracking-wide text-[15px]"
                style={{ fontFamily: '"Bebas Neue", "Fraunces Variable", sans-serif', letterSpacing: "0.04em" }}
              >
                {p.name}
              </div>

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
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center sm:justify-center overflow-hidden" onClick={() => setCartOpen(false)}>
          <div
            className="w-full max-w-full sm:max-w-lg bg-background border-t sm:border sm:rounded-xl shadow-xl max-h-[92vh] overflow-y-auto overflow-x-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-background border-b px-3 py-3 flex items-center justify-between gap-2">
              <div className="font-display text-lg truncate">Tu pedido</div>
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setCartOpen(false)}>Seguir</Button>
            </div>
            <div className="px-3 py-3 space-y-3">
              <div className="space-y-2">
                {cart.map((l) => (
                  <div key={l.key} className="flex items-center gap-1.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium whitespace-pre-line break-words">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{formatMoney(l.unit_price)}</div>
                    </div>
                    <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={() => setQty(l.key, l.qty - 1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-5 text-center font-medium shrink-0">{l.qty}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={() => setQty(l.key, l.qty + 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive" onClick={() => setQty(l.key, 0)}>
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
                      name="customer-name"
                      autoComplete="name"
                      value={customerName}
                      onChange={(e) => { setCustomerName(e.target.value); if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: false }); }}
                      className={fieldErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
                      required
                    />
                    {fieldErrors.name && <p className="text-xs text-destructive">Este campo es obligatorio para envíos a domicilio</p>}
                  </div>
                  <div className="space-y-1">
                    <Input
                      placeholder="Teléfono de contacto *"
                      name="customer-phone"
                      autoComplete="tel"
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => { setPhone(e.target.value); if (fieldErrors.phone) setFieldErrors({ ...fieldErrors, phone: false }); }}
                      className={fieldErrors.phone ? "border-destructive focus-visible:ring-destructive" : ""}
                      required
                    />
                    {fieldErrors.phone && <p className="text-xs text-destructive">El teléfono es obligatorio para poder contactarte</p>}
                  </div>
                  {isDelivery && (
                    <>
                      <div className="space-y-1">
                        <Input
                          placeholder="Dirección completa *"
                          name="customer-address"
                          autoComplete="street-address"
                          value={address}
                          onChange={(e) => { setAddress(e.target.value); if (fieldErrors.address) setFieldErrors({ ...fieldErrors, address: false }); }}
                          className={fieldErrors.address ? "border-destructive focus-visible:ring-destructive" : ""}
                        />
                        {fieldErrors.address && <p className="text-xs text-destructive">Este campo es obligatorio para envíos a domicilio</p>}
                      </div>
                      <div className="space-y-1">
                        <Input
                          placeholder="Barrio *"
                          name="customer-neighborhood"
                          autoComplete="address-level3"
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
                placeholder="Notas para cocina"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />

              {source !== "table_qr" && (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="text-sm font-medium">Método de pago</div>
                {isPickup && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 p-2 text-xs leading-snug">
                    Para recoger en la heladería el pago se hace por <strong>Nequi</strong> o <strong>Bancolombia</strong>. Después de pagar, envíanos el <strong>comprobante de pago por WhatsApp</strong> para comenzar a preparar tu pedido.
                  </div>
                )}
                <RadioGroup value={payMethod} onValueChange={(v) => setPayMethod(v as PayMethod)} className={`grid ${isPickup ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
                  {(isPickup ? (["Nequi", "Bancolombia"] as PayMethod[]) : (["Efectivo", "Nequi", "Bancolombia"] as PayMethod[])).map((m) => (
                    <Label
                      key={m}
                      htmlFor={`pm-${m}`}
                      className={`flex flex-col items-center justify-center gap-1 rounded-md border p-2 cursor-pointer text-xs transition ${payMethod === m ? "border-primary bg-primary/5 shadow-sm" : "hover:bg-muted/40"}`}
                    >
                      <RadioGroupItem id={`pm-${m}`} value={m} className="sr-only" />
                      {m === "Efectivo" && (
                        <div className="h-10 w-10 flex items-center justify-center">
                          <Banknote className="h-6 w-6" />
                        </div>
                      )}
                      {m === "Nequi" && (
                        <img src={nequiLogo} alt="Nequi" width={40} height={40} loading="lazy" className="h-10 w-10 object-contain drop-shadow-sm" />
                      )}
                      {m === "Bancolombia" && (
                        <img src={bancolombiaLogo} alt="Bancolombia" width={40} height={40} loading="lazy" className="h-10 w-10 object-contain drop-shadow-sm" />
                      )}
                      <span className="font-medium">{m}</span>
                      {m === "Bancolombia" && <span className="text-[10px] text-muted-foreground -mt-1">Ahorros</span>}
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
                    <div className="flex gap-2">
                      <Input value={nequiNum} readOnly placeholder="No configurado" className="font-mono tracking-wide" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(nequiNum, "Número Nequi")}
                        disabled={!nequiNum}
                        aria-label="Copiar número Nequi"
                        className="shrink-0"
                      >
                        {copiedAccount ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">Transfiere a este número y trae el comprobante.</div>
                  </div>
                )}
                {payMethod === "Bancolombia" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Cuenta Bancolombia del negocio (Ahorros)</Label>
                    <div className="flex gap-2">
                      <Input value={bancoAcc} readOnly placeholder="No configurado" className="font-mono tracking-wide" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(bancoAcc, "Cuenta Bancolombia")}
                        disabled={!bancoAcc}
                        aria-label="Copiar cuenta Bancolombia"
                        className="shrink-0"
                      >
                        {copiedAccount ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">Transfiere a esta cuenta y trae el comprobante.</div>
                  </div>
                )}
              </div>
              )}

              {source === "table_qr" && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground leading-snug">
                  El pago se realiza directamente en caja. Al confirmar, tu pedido llegará al cajero para prepararlo.
                </div>
              )}


              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
                {deliveryFee > 0 && (
                  <div className="flex justify-between"><span>Tarifa de Domicilio</span><span>{formatMoney(deliveryFee)}</span></div>
                )}
                <div className="flex justify-between font-display text-lg pt-1 border-t"><span>Total</span><span>{formatMoney(total)}</span></div>
              </div>

              <Button size="lg" className="w-full" onClick={submit} disabled={submitting}>
                {submitting
                  ? "Enviando..."
                  : source === "table_qr"
                    ? "Confirmar pedido"
                    : `Finalizar pedido · ${formatMoney(total)}`}
              </Button>

            </div>
          </div>
        </div>
      )}
      <ModifiersModal
        product={
          modalProduct
            ? { id: modalProduct.id, name: modalProduct.name, price: Number(modalProduct.price), modifier_group_ids: modalProduct.modifier_group_ids ?? [] }
            : null
        }
        onClose={() => setModalProduct(null)}
        onConfirm={(mods, unitExtra) => {
          if (modalProduct) addWithModifiers(modalProduct, mods, unitExtra);
          setModalProduct(null);
        }}
      />
    </div>
  );
}
