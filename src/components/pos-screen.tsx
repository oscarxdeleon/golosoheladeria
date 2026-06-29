import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Minus, Plus, Trash2, Search, ShoppingCart, Utensils, ShoppingBag, Bike, Monitor, Save, Banknote, Check, Printer } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { printSilent, type PrintPayload } from "@/lib/print-client";
import { useBranch } from "@/contexts/branch-context";

export type OrderType = "mesa" | "llevar" | "domicilio" | "kiosko";

interface Category { id: string; name: string; sort_order: number; }
interface Product { id: string; name: string; price: number; category_id: string | null; image_url: string | null; active: boolean; }
interface CartLine { key: string; product_id: string; name: string; unit_price: number; qty: number; }

const TYPE_META: Record<OrderType, { label: string; icon: typeof Utensils; color: string }> = {
  mesa: { label: "Mesa", icon: Utensils, color: "bg-primary text-primary-foreground" },
  llevar: { label: "Para llevar", icon: ShoppingBag, color: "bg-amber-500 text-white" },
  domicilio: { label: "A domicilio", icon: Bike, color: "bg-blue-500 text-white" },
  kiosko: { label: "Kiosko", icon: Monitor, color: "bg-purple-500 text-white" },
};

export interface Branding {
  business_name: string;
  nit?: string | null;
  address?: string | null;
  phone?: string | null;
  logo_url?: string | null;
  ticket_header?: string | null;
  ticket_footer?: string | null;
}

const DEFAULT_BRANDING: Branding = { business_name: "Heladería Goloso" };

function brandHeaderHTML(b: Branding) {
  const lines: string[] = [];
  if (b.nit) lines.push(`NIT: ${b.nit}`);
  if (b.address) lines.push(b.address);
  if (b.phone) lines.push(`Tel: ${b.phone}`);
  if (b.ticket_header) lines.push(b.ticket_header);
  const meta = lines.map((l) => `<div class="biz-meta">${l}</div>`).join("");
  const logo = b.logo_url
    ? `<div class="logo-wrap"><img src="${b.logo_url}" alt="logo" class="logo"/></div>`
    : "";
  return `${logo}<h1 class="biz-name">${b.business_name || "Heladería Goloso"}</h1>${meta}`;
}

function comandaHTML(o: {
  ticket: number; header: string; items: { name: string; qty: number }[];
  customer: string; notes: string; address: string; phone: string;
  user_name: string; created_at: string;
}) {
  const rows = o.items
    .map(
      (i) => `<tr>
        <td class="qty">${i.qty}×</td>
        <td class="name">${i.name}</td>
      </tr>`,
    )
    .join("");
  return `<!doctype html><html><head><title> </title>
  <style>
    @page{size:80mm auto;margin:0}
    @media print{html,body{width:80mm;margin:0!important;padding:0!important}}
    html,body{width:80mm}
    body{font-family:'Arial Black','Helvetica',sans-serif;font-size:26px;padding:5mm 4mm;width:72mm;margin:0;color:#000;font-weight:900;line-height:1.35}
    h1{font-size:42px;margin:0 0 10px;text-align:center;font-weight:900;letter-spacing:2px}
    h2{font-size:34px;margin:10px 0;font-weight:900;text-transform:uppercase;text-align:center;border:3px solid #000;padding:6px 0}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    td{vertical-align:top;padding:10px 0;border-bottom:2px dashed #000}
    td.qty{font-size:40px;font-weight:900;width:80px;text-align:right;padding-right:12px}
    td.name{font-size:32px;font-weight:900;text-transform:uppercase;line-height:1.2}
    hr{border:none;border-top:3px dashed #000;margin:8px 0}
    .meta{font-size:22px;font-weight:900;margin:4px 0}
    .notes{margin-top:10px;font-size:24px;font-weight:900;border:3px solid #000;padding:8px;line-height:1.35}
    .footer{margin-top:12px;text-align:center;font-size:24px;font-weight:900}
  </style></head>
  <body>
    <h1>COMANDA #${o.ticket}</h1>
    <div class="meta" style="text-align:center">${new Date(o.created_at).toLocaleString("es-CO")}</div>
    <div class="meta" style="text-align:center">Cajero: ${o.user_name}</div>
    <hr/>
    <h2>${o.header}</h2>
    ${o.customer ? `<div class="meta">Cliente: ${o.customer}</div>` : ""}
    ${o.address ? `<div class="meta">Dir: ${o.address}</div>` : ""}
    ${o.phone ? `<div class="meta">Tel: ${o.phone}</div>` : ""}
    <hr/>
    <table>${rows}</table>
    ${o.notes ? `<div class="notes">NOTAS:<br/>${o.notes}</div>` : ""}
    <div class="footer">*** ENVIAR A COCINA ***</div>
  </body></html>`;
}

const TICKET_STYLES = `@page{size:80mm auto;margin:0}
@media print{html,body{width:80mm;margin:0!important;padding:0!important}}
html,body{width:80mm}
body{font-family:'Helvetica','Arial',sans-serif;font-size:14px;padding:4mm;width:72mm;margin:0;color:#000;line-height:1.4}
.logo-wrap{text-align:center;margin:0 0 6px}
.logo{max-width:60mm;max-height:24mm;object-fit:contain;display:inline-block}
.biz-name{font-size:22px;margin:2px 0 4px;text-align:center;font-weight:900;letter-spacing:1px;text-transform:uppercase}
.biz-meta{font-size:12px;text-align:center;line-height:1.3}
h2{font-size:16px;margin:6px 0;text-align:center;font-weight:bold}
table{width:100%;border-collapse:collapse}
td{padding:3px 0;font-size:14px;vertical-align:top}
hr{border:none;border-top:1px dashed #000;margin:6px 0}
.muted{color:#222;font-size:12px;text-align:center}
.row{display:flex;justify-content:space-between;font-size:14px;padding:1px 0}
.row.total{font-weight:900;font-size:20px;margin-top:6px;border-top:2px solid #000;padding-top:6px}
.thanks{text-align:center;font-size:14px;font-weight:bold;margin-top:8px;line-height:1.4;white-space:pre-line}`;

function ticketHTML(o: {
  ticket: number; header: string;
  items: { name: string; qty: number; unit_price: number }[];
  subtotal: number; tax: number; deliveryFee: number; total: number;
  payment_method: string; customer: string; user_name: string; created_at: string;
  branding?: Branding;
}) {
  const b = o.branding ?? DEFAULT_BRANDING;
  const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
  const rows = o.items
    .map((i) => `<tr><td>${i.qty} × ${i.name}</td><td style="text-align:right;white-space:nowrap">${money(i.unit_price * i.qty)}</td></tr>`)
    .join("");
  return `<!doctype html><html><head><title> </title><style>${TICKET_STYLES}</style></head>
  <body>
    ${brandHeaderHTML(b)}
    <hr/>
    <div class="muted">${new Date(o.created_at).toLocaleString("es-CO")}</div>
    <div class="muted">Ticket #${o.ticket} · ${o.header}</div>
    ${o.customer ? `<div class="muted">Cliente: ${o.customer}</div>` : ""}
    <div class="muted">Cajero: ${o.user_name}</div>
    <hr/>
    <table>${rows}</table>
    <hr/>
    <div class="row"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
    ${o.tax > 0 ? `<div class="row"><span>Impuesto</span><span>${money(o.tax)}</span></div>` : ""}
    ${o.deliveryFee > 0 ? `<div class="row"><span>Domicilio</span><span>${money(o.deliveryFee)}</span></div>` : ""}
    <div class="row total"><span>TOTAL</span><span>${money(o.total)}</span></div>
    <div class="row"><span>Pago</span><span>${o.payment_method}</span></div>
    <hr/>
    <div class="thanks">${b.ticket_footer ? b.ticket_footer : "¡Gracias por tu compra!"}</div>
  </body></html>`;
}

function precuentaHTML(o: {
  header: string; items: { name: string; qty: number; unit_price: number }[];
  subtotal: number; tax: number; deliveryFee: number; total: number;
  customer: string; user_name: string;
  branding?: Branding;
}) {
  const b = o.branding ?? DEFAULT_BRANDING;
  const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
  const rows = o.items
    .map((i) => `<tr><td>${i.qty} × ${i.name}</td><td style="text-align:right;white-space:nowrap">${money(i.unit_price * i.qty)}</td></tr>`)
    .join("");
  return `<!doctype html><html><head><title> </title><style>${TICKET_STYLES}</style></head>
  <body>
    ${brandHeaderHTML(b)}
    <hr/>
    <h2>PRECUENTA</h2>
    <div class="muted">${new Date().toLocaleString("es-CO")}</div>
    <div class="muted">${o.header}</div>
    ${o.customer ? `<div class="muted">Cliente: ${o.customer}</div>` : ""}
    <div class="muted">Cajero: ${o.user_name}</div>
    <hr/>
    <table>${rows}</table>
    <hr/>
    <div class="row"><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
    ${o.tax > 0 ? `<div class="row"><span>Impuesto</span><span>${money(o.tax)}</span></div>` : ""}
    ${o.deliveryFee > 0 ? `<div class="row"><span>Domicilio</span><span>${money(o.deliveryFee)}</span></div>` : ""}
    <div class="row total"><span>TOTAL</span><span>${money(o.total)}</span></div>
    <hr/>
    <div class="muted">Documento no fiscal</div>
  </body></html>`;
}

function printComanda(o: Parameters<typeof comandaHTML>[0]) {
  const payload: PrintPayload = {
    type: "comanda", ticket: o.ticket, header: o.header,
    items: o.items, customer: o.customer, notes: o.notes,
    address: o.address, phone: o.phone, user_name: o.user_name, created_at: o.created_at,
  };
  printSilent(payload, comandaHTML(o));
}
function printTicketFinal(o: Parameters<typeof ticketHTML>[0]) {
  const payload: PrintPayload = {
    type: "ticket", ticket: o.ticket, header: o.header, items: o.items,
    subtotal: o.subtotal, tax: o.tax, deliveryFee: o.deliveryFee, total: o.total,
    payment_method: o.payment_method, customer: o.customer,
    user_name: o.user_name, created_at: o.created_at,
  };
  printSilent(payload, ticketHTML(o));
}
function printPrecuenta(o: Parameters<typeof precuentaHTML>[0]) {
  const payload: PrintPayload = {
    type: "precuenta", header: o.header, items: o.items,
    subtotal: o.subtotal, tax: o.tax, deliveryFee: o.deliveryFee, total: o.total,
    customer: o.customer, user_name: o.user_name,
  };
  printSilent(payload, precuentaHTML(o));
}




interface Props {
  orderType: OrderType;
  tableId?: string | null;
  title?: string;
  /** Modo mesero (tablet): oculta pagos, precuenta y caja. Solo Guardar/KDS. */
  meseroMode?: boolean;
  /** Callback ejecutado después de guardar la comanda; si se provee, suplanta el redirect interno. */
  onSaved?: () => void;
}

export function PosScreen({ orderType, tableId, title, meseroMode = false, onSaved }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { activeBranchId } = useBranch();
  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [pendingSaleId, setPendingSaleId] = useState<string | null>(null);
  const [cashDialogOpen, setCashDialogOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const [successDialog, setSuccessDialog] = useState<null | {
    ticket: number;
    method: string;
    total: number;
    printPayload: Parameters<typeof printTicketFinal>[0];
    redirectTo: "/mesas" | "/llevar" | "/domicilio" | "/kiosko" | null;
  }>(null);


  useEffect(() => {
    setCart([]);
    setCustomer("");
    setNotes("");
    setPendingSaleId(null);
  }, [orderType, tableId]);


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
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data } = await supabase.from("settings").select("delivery_fee,tax_rate,business_name,nit,address,phone,logo_url,ticket_header,ticket_footer").maybeSingle();
      return data as (Branding & { delivery_fee: number; tax_rate: number }) | null;
    },
  });
  const branding: Branding = {
    business_name: settings?.business_name || "Heladería Goloso",
    nit: settings?.nit ?? null,
    address: settings?.address ?? null,
    phone: settings?.phone ?? null,
    logo_url: settings?.logo_url ?? null,
    ticket_header: settings?.ticket_header ?? null,
    ticket_footer: settings?.ticket_footer ?? null,
  };


  const { data: openSession } = useQuery({
    queryKey: ["cash-session-open", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("cash_sessions")
        .select("id,opened_at")
        .eq("user_id", user!.id)
        .eq("status", "open")
        .maybeSingle();
      return data;
    },
  });
  const { data: mesa } = useQuery({
    queryKey: ["restaurant_tables", tableId],
    enabled: !!tableId,
    queryFn: async () => {
      const { data } = await supabase.from("restaurant_tables").select("id,number,label,seats").eq("id", tableId!).maybeSingle();
      return data;
    },
  });

  // Cargar pedido pendiente existente (mesa) para permitir cobro directo
  const { data: pendingSale } = useQuery({
    queryKey: ["pending-sale", orderType, tableId],
    enabled: orderType === "mesa" && !!tableId,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("id,ticket_number,customer_name,notes,created_at,sale_items(product_id,product_name,qty,unit_price)")
        .eq("table_id", tableId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as null | {
        id: string;
        ticket_number: number;
        customer_name: string | null;
        notes: string | null;
        created_at: string;
        sale_items: { product_id: string; product_name: string; qty: number; unit_price: number }[];
      };
    },
  });

  useEffect(() => {
    if (!pendingSale) return;
    setPendingSaleId(pendingSale.id);
    setCustomer(pendingSale.customer_name ?? "");
    setNotes(pendingSale.notes ?? "");
    setCart(
      (pendingSale.sale_items ?? []).map((i) => ({
        key: i.product_id,
        product_id: i.product_id,
        name: i.product_name,
        unit_price: Number(i.unit_price),
        qty: Number(i.qty),
      })),
    );
  }, [pendingSale]);


  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (activeCat !== "all" && p.category_id !== activeCat) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [products, activeCat, search]);

  const deliveryFee = orderType === "domicilio" ? Number(settings?.delivery_fee ?? 0) : 0;
  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const taxRate = Number(settings?.tax_rate ?? 0);
  const tax = Math.round((subtotal * taxRate) / 100);
  const total = subtotal + tax + deliveryFee;


  function add(p: Product) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { key: p.id, product_id: p.id, name: p.name, unit_price: Number(p.price), qty: 1 }];
    });
  }
  function dec(key: string) {
    setCart((p) => p.flatMap((l) => (l.key === key ? (l.qty <= 1 ? [] : [{ ...l, qty: l.qty - 1 }]) : [l])));
  }
  function remove(key: string) {
    setCart((p) => p.filter((l) => l.key !== key));
  }

  async function pay(method: string) {
    // Validaciones previas — si fallan, NO se imprime ni se libera nada
    if (!user) return toast.error("Inicia sesión para cobrar");
    if (!openSession) return toast.error("Debes abrir caja antes de cobrar");
    if (cart.length === 0) return toast.error("Carrito vacío");
    if (orderType === "domicilio" && (!address || !phone)) {
      return toast.error("Dirección y teléfono requeridos para domicilio");
    }

    setPaying(true);
    console.log(`[pay] iniciando cobro · método=${method} · pendingSaleId=${pendingSaleId ?? "(nuevo)"}`);

    try {
      // ───────────────────────────────────────────────────────────────
      // PASO 1: Registrar el pago / finalizar venta en base de datos
      // ───────────────────────────────────────────────────────────────
      let sale: { id: string; ticket_number: number; total: number; payment_method: string; created_at: string } | null = null;

      if (pendingSaleId) {
        const { data, error } = await supabase
          .from("sales")
          .update({
            user_id: user.id,
            user_name: profile?.full_name ?? user.email,
            subtotal,
            tax,
            total,
            payment_method: method,
            status: "paid",
            cash_session_id: openSession.id,
            customer_name: customer || null,
            notes: notes || null,
            delivery_address: orderType === "domicilio" ? address : null,
            delivery_phone: orderType === "domicilio" ? phone : null,
            delivery_fee: deliveryFee,
          })
          .eq("id", pendingSaleId)
          .select("id,ticket_number,total,payment_method,created_at")
          .maybeSingle();
        if (error) {
          console.error("[pay] update sale error", error);
          throw new Error(error.message || "No se pudo actualizar la venta");
        }
        if (!data) throw new Error("La venta pendiente ya no existe o no tienes permisos para cobrarla");
        sale = data;
      } else {
        const { data, error } = await supabase
          .from("sales")
          .insert({
            user_id: user.id,
            user_name: profile?.full_name ?? user.email,
            subtotal,
            tax,
            total,
            payment_method: method,
            status: "paid",
            cash_session_id: openSession.id,
            customer_name: customer || null,
            notes: notes || null,
            order_type: orderType,
            table_id: tableId ?? null,
            branch_id: activeBranchId,
            delivery_address: orderType === "domicilio" ? address : null,
            delivery_phone: orderType === "domicilio" ? phone : null,
            delivery_fee: deliveryFee,
          })
          .select("id,ticket_number,total,payment_method,created_at")
          .maybeSingle();
        if (error) {
          console.error("[pay] insert sale error", error);
          throw new Error(error.message || "No se pudo registrar la venta");
        }
        if (!data) throw new Error("No se pudo registrar la venta (respuesta vacía)");
        sale = data;

        const items = cart.map((l) => ({
          sale_id: sale!.id,
          product_id: l.product_id,
          product_name: l.name,
          qty: l.qty,
          unit_price: l.unit_price,
          subtotal: l.unit_price * l.qty,
          modifiers: [],
        }));
        const { error: e2 } = await supabase.from("sale_items").insert(items);
        if (e2) {
          console.error("[pay] insert items error", e2);
          throw new Error(e2.message || "No se pudieron guardar los productos de la venta");
        }
      }

      console.log(`[pay] venta #${sale.ticket_number} registrada como ${method}`);

      // ───────────────────────────────────────────────────────────────
      // PASO 2: Liberar mesa y limpiar estado local
      // ───────────────────────────────────────────────────────────────
      if (orderType === "mesa" && tableId) {
        const { error: tErr } = await supabase
          .from("restaurant_tables")
          .update({ status: "free", current_guests: null, occupied_at: null })
          .eq("id", tableId);
        if (tErr) console.warn("[pay] no se pudo liberar mesa", tErr);
        qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
      }

      const snapshotItems = cart.map((l) => ({ name: l.name, qty: l.qty, unit_price: l.unit_price }));
      const snapshotCustomer = customer;
      const snapshotNotes = notes;
      const snapshotAddress = address;
      const snapshotPhone = phone;
      const snapshotHeader = header;
      const snapshotUserName = profile?.full_name ?? user.email ?? "";

      setCart([]);
      setCustomer("");
      setNotes("");
      setAddress("");
      setPhone("");
      setPendingSaleId(null);
      setCashDialogOpen(false);
      setCashReceived("");

      qc.invalidateQueries({ queryKey: ["dashboard-today"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["pending-sale"] });
      qc.invalidateQueries({ queryKey: ["kds-pending"] });

      toast.success(`Venta #${sale.ticket_number} cobrada con ${method}`);

      // ───────────────────────────────────────────────────────────────
      // PASO 3: Mostrar modal de confirmación post-venta
      // (la impresión y la redirección quedan a cargo del cajero desde el modal)
      // ───────────────────────────────────────────────────────────────
      const redirectTo: "/mesas" | "/llevar" | "/domicilio" | "/kiosko" | null =
        orderType === "mesa" ? "/mesas"
        : orderType === "llevar" ? "/llevar"
        : orderType === "domicilio" ? "/domicilio"
        : orderType === "kiosko" ? "/kiosko"
        : null;

      setSuccessDialog({
        ticket: sale.ticket_number,
        method: sale.payment_method,
        total: Number(sale.total),
        redirectTo,
        printPayload: {
          ticket: sale.ticket_number,
          header: snapshotHeader,
          items: snapshotItems,
          subtotal,
          tax,
          deliveryFee,
          total: Number(sale.total),
          payment_method: sale.payment_method,
          customer: snapshotCustomer,
          user_name: snapshotUserName,
          created_at: sale.created_at,
          branding,
        },

      });

      // Mantener referencia a snapshots no usados para evitar warnings
      void snapshotNotes; void snapshotAddress; void snapshotPhone;
    } catch (err) {
      console.error("[pay] error fatal", err);
      const msg = err instanceof Error ? err.message : "Error al cobrar";
      toast.error(`No se pudo cobrar: ${msg}`);
      // NO se imprime nada porque la venta no quedó registrada
    } finally {
      setPaying(false);
    }
  }

  async function saveComanda() {
    if (!user) return toast.error("Inicia sesión para guardar el pedido");
    if (cart.length === 0) return toast.error("Carrito vacío");
    if (orderType === "domicilio" && (!address || !phone)) {
      return toast.error("Dirección y teléfono requeridos para domicilio");
    }
    setPaying(true);
    try {
      let sale: { id: string; ticket_number: number; created_at: string };
      if (pendingSaleId) {
        // Actualizar pedido pendiente existente y reemplazar items
        const { data, error } = await supabase
          .from("sales")
          .update({
            user_id: user.id,
            user_name: profile?.full_name ?? user.email,
            subtotal,
            tax,

            total,
            customer_name: customer || null,
            notes: notes || null,
            delivery_address: orderType === "domicilio" ? address : null,
            delivery_phone: orderType === "domicilio" ? phone : null,
            delivery_fee: deliveryFee,
            printed_at: new Date().toISOString(),
          })
          .eq("id", pendingSaleId)
          .select("id,ticket_number,created_at")
          .single();
        if (error) throw new Error(error.message || "No se pudo actualizar el pedido");
        sale = data;
        await supabase.from("sale_items").delete().eq("sale_id", pendingSaleId);
      } else {
        const { data, error } = await supabase
          .from("sales")
          .insert({
            user_id: user.id,
            user_name: profile?.full_name ?? user.email,
            subtotal,
            tax,

            total,
            payment_method: "Pendiente",
            status: "pending",
            source: "pos",
            printed_at: new Date().toISOString(),
            customer_name: customer || null,
            notes: notes || null,
            order_type: orderType,
            table_id: tableId ?? null,
            branch_id: activeBranchId,
            delivery_address: orderType === "domicilio" ? address : null,
            delivery_phone: orderType === "domicilio" ? phone : null,
            delivery_fee: deliveryFee,
          })
          .select("id,ticket_number,created_at")
          .single();
        if (error) {
          console.error("save sale error", error);
          throw new Error(error.message || "No se pudo guardar el pedido");
        }
        sale = data;
        setPendingSaleId(sale.id);
      }

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
      if (e2) {
        console.error("save items error", e2);
        throw new Error(e2.message || "No se pudieron guardar los productos");
      }

      // Marcar mesa como ocupada si aplica
      if (orderType === "mesa" && tableId) {
        await supabase
          .from("restaurant_tables")
          .update({ status: "occupied", occupied_at: new Date().toISOString() })
          .eq("id", tableId);
        qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
      }

      // Imprimir comanda en segundo plano (no bloquea la UI)
      const snap = cart.map((l) => ({ name: l.name, qty: l.qty }));
      setTimeout(() => {
        printComanda({
          ticket: sale.ticket_number,
          header,
          items: snap,
          customer,
          notes,
          address: orderType === "domicilio" ? address : "",
          phone: orderType === "domicilio" ? phone : "",
          user_name: profile?.full_name ?? user.email ?? "",
          created_at: sale.created_at,
        });
      }, 0);

      qc.invalidateQueries({ queryKey: ["kds-pending"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["pending-sale"] });
      toast.success(`Comanda #${sale.ticket_number} enviada a cocina y KDS`);

      // Limpiar estado local y regresar al panel principal
      setCart([]);
      setCustomer("");
      setNotes("");
      setAddress("");
      setPhone("");
      setPendingSaleId(null);

      if (onSaved) {
        onSaved();
      } else {
        if (orderType === "mesa") navigate({ to: "/mesas" });
        else if (orderType === "llevar") navigate({ to: "/llevar" });
        else if (orderType === "domicilio") navigate({ to: "/domicilio" });
        else if (orderType === "kiosko") navigate({ to: "/kiosko" });
      }

    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setPaying(false);
    }
  }


  async function handlePrecuenta() {
    // Si el pedido ya está guardado, recargar items desde la base para garantizar el monto correcto
    let items = cart.map((l) => ({ name: l.name, qty: l.qty, unit_price: l.unit_price }));
    let sub = subtotal;
    let tx = tax;
    let tot = total;
    if (pendingSaleId) {
      const { data } = await supabase
        .from("sales")
        .select("subtotal,tax,total,delivery_fee,sale_items(product_name,qty,unit_price)")
        .eq("id", pendingSaleId)
        .maybeSingle();
      if (data) {
        items = (data.sale_items ?? []).map((i) => ({ name: i.product_name, qty: Number(i.qty), unit_price: Number(i.unit_price) }));
        sub = Number(data.subtotal);
        tx = Number(data.tax ?? 0);
        tot = Number(data.total);
      }
    }
    if (items.length === 0) return toast.error("Carrito vacío");
    printPrecuenta({
      header,
      items,
      subtotal: sub,
      tax: tx,
      deliveryFee,
      total: tot,
      customer,
      user_name: profile?.full_name ?? user?.email ?? "",
      branding,
    });

  }






  const meta = TYPE_META[orderType];
  const Icon = meta.icon;
  const header = title ?? (mesa ? `${mesa.label ?? `Mesa ${mesa.number}`}` : meta.label);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,420px]">
      {!meseroMode && !openSession && (
        <div className="lg:col-span-2 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm flex items-center justify-between gap-3">
          <span>
            <strong>Caja cerrada.</strong> Debes abrir caja antes de cobrar ventas.
          </span>
          <a href="/caja" className="rounded-md bg-amber-500 px-3 py-1 text-white text-xs font-medium hover:bg-amber-600">
            Ir a Caja
          </a>
        </div>
      )}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Badge className={meta.color}>
              <Icon className="h-3 w-3 mr-1" /> {meta.label}
            </Badge>
            <h1 className="font-display text-2xl">{header}</h1>
          </div>
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
              className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left transition hover:border-primary hover:shadow-md active:scale-[0.98]"
            >
              <div className="aspect-square w-full overflow-hidden bg-white p-2 flex items-center justify-center">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="max-h-full max-w-full object-contain transition group-hover:scale-105" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl font-display text-primary/40 bg-gradient-to-br from-secondary/30 to-accent/20 rounded-lg">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="font-medium leading-tight line-clamp-2 text-sm">{p.name}</div>
                <div className="mt-1 font-display text-lg text-primary">{formatMoney(p.price)}</div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full text-center text-sm text-muted-foreground py-12">
              Sin productos. Agrégalos en Menú → Productos.
            </p>
          )}
        </div>

      </div>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            <h2 className="font-display text-xl">Pedido</h2>
            {pendingSaleId && (
              <Badge variant="secondary" className="bg-success/15 text-success border-success/30">
                En cocina
              </Badge>
            )}
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
            {orderType === "domicilio" && (
              <>
                <Input placeholder="Dirección de entrega" value={address} onChange={(e) => setAddress(e.target.value)} />
                <Input placeholder="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </>
            )}
            <Input placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="space-y-1 border-t pt-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            {deliveryFee > 0 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Domicilio</span>
                <span>{formatMoney(deliveryFee)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-display text-3xl text-primary">{formatMoney(total)}</span>
            </div>
          </div>

          <div className={meseroMode ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 gap-2"}>
            {!meseroMode && (
              <Button
                disabled={cart.length === 0}
                onClick={handlePrecuenta}
                variant="outline"
              >
                Precuenta
              </Button>
            )}
            <Button
              disabled={paying || cart.length === 0}
              onClick={saveComanda}
              variant={meseroMode ? "default" : "outline"}
              className={meseroMode ? "h-14 text-lg" : "border-primary text-primary hover:bg-primary/10"}
            >
              <Save className="h-4 w-4 mr-1" /> {meseroMode ? "Guardar y enviar a KDS" : "Guardar / KDS"}
            </Button>
          </div>


          {!meseroMode && (
            <div className="border-t pt-3">
              <div className="text-xs text-muted-foreground mb-2">Cobrar ahora:</div>
              <div className="grid grid-cols-2 gap-2">
                {methods.map((m: { id: string; name: string }) => {
                  const isCash = m.name.toLowerCase().includes("efectivo");
                  return (
                    <Button
                      key={m.id}
                      disabled={paying || cart.length === 0 || !openSession}
                      onClick={() => {
                        if (isCash) {
                          setCashReceived("");
                          setCashDialogOpen(true);
                        } else {
                          pay(m.name);
                        }
                      }}
                      variant={isCash ? "default" : "secondary"}
                    >
                      {isCash && <Banknote className="h-4 w-4 mr-1" />}
                      {m.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={cashDialogOpen} onOpenChange={(open) => { if (!paying) setCashDialogOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-primary" /> Pago en efectivo
            </DialogTitle>
            <DialogDescription>Ingresa el monto recibido del cliente para calcular el cambio.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total a cobrar</span><span className="font-display text-xl text-primary">{formatMoney(total)}</span></div>
            </div>
            <div>
              <label className="text-sm font-medium">Recibido</label>
              <Input
                autoFocus
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && Number(cashReceived) >= total && !paying) {
                    pay("Efectivo");
                    setCashDialogOpen(false);
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Button variant="outline" size="sm" onClick={() => setCashReceived(String(total))}>
                Exacto
              </Button>
              {[1000, 2000, 5000].map((v) => (
                <Button
                  key={v}
                  variant="secondary"
                  size="sm"
                  onClick={() => setCashReceived(String((Number(cashReceived) || 0) + v))}
                >
                  +{formatMoney(v)}
                </Button>
              ))}
              {[20000, 50000, 100000].map((v) => (
                <Button key={v} variant="outline" size="sm" onClick={() => setCashReceived(String(Math.max(total, v)))}>
                  {formatMoney(v)}
                </Button>
              ))}
            </div>


            {cashReceived !== "" && (
              <div className={`rounded-lg p-3 text-sm flex justify-between items-center ${Number(cashReceived) < total ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                <span>Cambio</span>
                <span className="font-display text-2xl">{formatMoney(Math.max(0, Number(cashReceived) - total))}</span>
              </div>
            )}
            {cashReceived !== "" && Number(cashReceived) < total && (
              <div className="text-xs text-destructive">Faltan {formatMoney(total - Number(cashReceived))}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashDialogOpen(false)} disabled={paying}>Cancelar</Button>
            <Button
              disabled={paying || cashReceived === "" || Number(cashReceived) < total}
              onClick={async () => {
                await pay("Efectivo");
                setCashDialogOpen(false);
                setCashReceived("");
              }}
            >
              {paying ? "Cobrando…" : "Confirmar cobro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!successDialog}
        onOpenChange={(open) => {
          if (!open && successDialog) {
            const redirect = successDialog.redirectTo;
            setSuccessDialog(null);
            if (redirect) navigate({ to: redirect });
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <DialogTitle className="text-center text-2xl">¡Venta realizada con éxito!</DialogTitle>
            <DialogDescription className="text-center">
              {successDialog && (
                <>
                  Ticket <b>#{successDialog.ticket}</b> · {successDialog.method} ·{" "}
                  <b>{formatMoney(successDialog.total)}</b>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="text-center text-sm text-muted-foreground">
            ¿Deseas imprimir el ticket para el cliente?
          </p>
          <DialogFooter className="sm:justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const redirect = successDialog?.redirectTo ?? null;
                setSuccessDialog(null);
                if (redirect) navigate({ to: redirect });
              }}
            >
              No imprimir
            </Button>
            <Button
              onClick={() => {
                const payload = successDialog?.printPayload;
                const redirect = successDialog?.redirectTo ?? null;
                setSuccessDialog(null);
                if (payload) {
                  setTimeout(() => printTicketFinal(payload), 0);
                }
                if (redirect) navigate({ to: redirect });
              }}
            >
              <Printer className="h-4 w-4 mr-1" /> Imprimir Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
