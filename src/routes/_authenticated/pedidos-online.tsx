import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  MessageCircle, RefreshCw, Phone, Clock, CheckCircle2, Printer, Banknote, MapPin, Check,
} from "lucide-react";
import { formatMoney, translateSaleStatus } from "@/lib/format";
import { toast } from "sonner";
import { printSilent, normalizeModifiers, composeDeliveryAddress, type PrintPayload } from "@/lib/print-client";
import { useBranch } from "@/contexts/branch-context";
import { useBranchCashSession } from "@/hooks/use-branch-cash-session";
import { CashPayPad } from "@/components/cash-pay-pad";
import { ticketHTML, printTicketFinal, type Branding, type TicketConfig } from "@/components/pos-screen";
import { ElectronicPaymentDialog } from "@/components/electronic-payment-dialog";
import nequiLogo from "@/assets/nequi-logo-transparent.webp";
import bancolombiaLogo from "@/assets/bancolombia-logo-original.png";

export const Route = createFileRoute("/_authenticated/pedidos-online")({
  head: () => ({ meta: [{ title: "Pedidos en línea · Goloso POS" }] }),
  component: OnlineOrdersPage,
});

interface SaleRow {
  id: string;
  ticket_number: number;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  total: number;
  subtotal: number;
  delivery_fee: number | null;
  delivery_address: string | null;
  delivery_neighborhood: string | null;
  payment_method: string | null;
  status: string;
  source: string;
  order_type: string | null;
  created_at: string;
  branch_id: string | null;
}
interface ItemRow { id: string; sale_id: string; product_name: string; qty: number; unit_price: number; modifiers?: unknown }

function waLink(phone: string, msg: string) {
  const clean = phone.replace(/[^\d]/g, "");
  const num = clean.startsWith("57") || clean.length > 10 ? clean : `57${clean}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

function comandaHTML(o: { ticket: number; header: string; items: { name: string; qty: number; modifiers?: string[] }[]; customer: string; notes: string; address: string; phone: string; created_at: string; }) {
  const rows = o.items.map((i) => {
    const mods = Array.isArray(i.modifiers) && i.modifiers.length
      ? `<div class="mods">${i.modifiers.map((m) => `<div>+ ${String(m).replace(/^\s*[+*]\s*/, "").trim()}</div>`).join("")}</div>`
      : "";
    return `<tr><td class="qty">${i.qty}×</td><td class="name">${i.name}${mods}</td></tr>`;
  }).join("");
  return `<!doctype html><html><head><title> </title><style>
    @page{size:80mm auto;margin:0}@media print{html,body{width:80mm;margin:0!important;padding:0!important}}
    html,body{width:80mm}body{font-family:'Arial Black','Helvetica',sans-serif;font-size:26px;padding:5mm 4mm;width:72mm;margin:0;color:#000;font-weight:900;line-height:1.35}
    h1{font-size:42px;margin:0 0 10px;text-align:center;letter-spacing:2px}h2{font-size:34px;margin:10px 0;text-transform:uppercase;text-align:center;border:3px solid #000;padding:6px 0}
    table{width:100%;border-collapse:collapse;margin-top:8px}td{vertical-align:top;padding:10px 0;border-bottom:2px dashed #000}
    td.qty{font-size:40px;width:80px;text-align:right;padding-right:12px}td.name{font-size:32px;text-transform:uppercase;line-height:1.2}.mods{font-size:40px;font-weight:900;line-height:1.35;margin-top:8px}.mods div{margin:6px 0}
    hr{border:none;border-top:3px dashed #000;margin:8px 0}.meta{font-size:22px;margin:4px 0}.notes{margin-top:10px;font-size:24px;border:3px solid #000;padding:8px}.footer{margin-top:12px;text-align:center;font-size:24px}
  </style></head><body>
    <h1>PEDIDO # ${o.ticket}</h1>
    <div class="meta" style="text-align:center">${new Date(o.created_at).toLocaleString("es-CO")}</div>
    <hr/><h2>${o.header}</h2>
    ${o.customer ? `<div class="meta">Cliente: ${o.customer}</div>` : ""}
    ${o.address ? `<div class="meta">Dir: ${o.address}</div>` : ""}
    ${o.phone ? `<div class="meta">Tel: ${o.phone}</div>` : ""}
    <hr/><table>${rows}</table>
    ${o.notes ? `<div class="notes">NOTAS:<br/>${o.notes}</div>` : ""}
    <div class="footer">*** ENVIAR A COCINA ***</div>
  </body></html>`;
}

function preCuentaHTML(o: { ticket: number; header: string; items: { name: string; qty: number; unit_price: number }[]; customer: string; address: string; phone: string; notes: string; subtotal: number; delivery_fee: number; total: number; created_at: string; }) {
  const rows = o.items.map((i) => `<tr><td>${i.qty}× ${i.name}</td><td class="r">${formatMoney(i.qty * i.unit_price)}</td></tr>`).join("");
  return `<!doctype html><html><head><title> </title><style>
    @page{size:80mm auto;margin:0}@media print{html,body{width:80mm;margin:0!important;padding:0!important}}
    html,body{width:80mm}body{font-family:'Arial Black','Helvetica',sans-serif;font-size:22px;padding:5mm 4mm;width:72mm;margin:0;color:#000;font-weight:900;line-height:1.3}
    h1{font-size:34px;margin:0 0 6px;text-align:center;letter-spacing:1px}
    h2{font-size:26px;margin:6px 0;text-align:center;border:2px solid #000;padding:4px 0}
    .meta{font-size:18px;margin:2px 0}
    table{width:100%;border-collapse:collapse;margin-top:6px}
    td{vertical-align:top;padding:6px 0;border-bottom:1px dashed #000;font-size:22px}
    .r{text-align:right;white-space:nowrap}
    .totals td{border:none;padding:3px 0}
    .total{font-size:34px;border-top:3px solid #000;padding-top:8px!important}
    hr{border:none;border-top:2px dashed #000;margin:6px 0}
    .notes{margin-top:8px;font-size:20px;border:2px solid #000;padding:6px}
    .footer{margin-top:10px;text-align:center;font-size:20px}
  </style></head><body>
    <h1>HELADERÍA GOLOSO</h1>
    <h2>PRE-CUENTA #${o.ticket}</h2>
    <div class="meta" style="text-align:center">${new Date(o.created_at).toLocaleString("es-CO")}</div>
    <div class="meta">Canal: ${o.header}</div>
    ${o.customer ? `<div class="meta">Cliente: ${o.customer}</div>` : ""}
    ${o.phone ? `<div class="meta">Tel: ${o.phone}</div>` : ""}
    ${o.address ? `<div class="meta">Dir: ${o.address}</div>` : ""}
    <hr/>
    <table>${rows}</table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="r">${formatMoney(o.subtotal)}</td></tr>
      ${o.delivery_fee > 0 ? `<tr><td>Domicilio</td><td class="r">${formatMoney(o.delivery_fee)}</td></tr>` : ""}
      <tr><td class="total">TOTAL</td><td class="r total">${formatMoney(o.total)}</td></tr>
    </table>
    ${o.notes ? `<div class="notes">NOTAS:<br/>${o.notes}</div>` : ""}
    <div class="footer">*** SOPORTE DE ENTREGA ***<br/>No es factura de venta</div>
  </body></html>`;
}

function OnlineOrdersPage() {
  const qc = useQueryClient();
  const { activeBranchId, activeBranch } = useBranch();
  const { session: cashSession } = useBranchCashSession(activeBranchId);
  const [payOrder, setPayOrder] = useState<SaleRow | null>(null);
  const [paying, setPaying] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [cashDialogOpen, setCashDialogOpen] = useState(false);
  const [successDialog, setSuccessDialog] = useState<{
    ticket: number;
    method: string;
    total: number;
    ticketArgs: Parameters<typeof ticketHTML>[0];
    waMessage: string | null;
    waPhone: string | null;
  } | null>(null);


  const { data: settings } = useQuery({
    queryKey: ["settings-one"],
    queryFn: async () => (await supabase.from("settings").select("*").maybeSingle()).data,
  });

  const { data: orders = [], isLoading, refetch } = useQuery<SaleRow[]>({
    queryKey: ["online-orders", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      if (!activeBranchId) return [];
      // Incluye pedidos del menú en línea + domicilios creados en POS que quedaron pendientes por pagar.
      const q = supabase
        .from("sales")
        .select("*")
        .eq("branch_id", activeBranchId)
        .or("source.eq.online_menu,source.eq.whatsapp_bot,and(order_type.eq.domicilio,payment_method.eq.Pendiente)")
        .order("created_at", { ascending: false })
        .limit(150);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SaleRow[];
    },

  });

  const ids = orders.map((o) => o.id);
  const { data: items = [] } = useQuery<ItemRow[]>({
    queryKey: ["online-orders-items", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("sale_items").select("*").in("sale_id", ids);
      if (error) throw error;
      return (data ?? []) as ItemRow[];
    },
  });

  useEffect(() => {
    if (!activeBranchId) return;
    const ch = supabase
      .channel(`po-page-${activeBranchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${activeBranchId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { source?: string | null; order_type?: string | null; payment_method?: string | null } | null;
          if (!row) return;
          const isOnline = row.source === "online_menu";
          const isBot = row.source === "whatsapp_bot";
          const isPosDomicilioPending = row.order_type === "domicilio" && row.payment_method === "Pendiente";
          if (!isOnline && !isBot && !isPosDomicilioPending) return;
          qc.invalidateQueries({ queryKey: ["online-orders", activeBranchId] });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, activeBranchId]);



  async function confirmAndPrint(o: SaleRow, its: ItemRow[]) {
    if (!activeBranchId || o.branch_id !== activeBranchId) {
      toast.error("Este pedido pertenece a otra sede. Cambia a la sede correcta para procesarlo.");
      return;
    }
    if (its.length === 0) {
      toast.error("El pedido no tiene productos válidos");
      return;
    }
    const header = o.order_type === "domicilio" ? "DOMICILIO" : o.order_type === "kiosko" ? "AUTOPEDIDO" : "MENÚ EN LÍNEA";
    // 1) Comanda de cocina
    const comandaItems = its.map((i) => ({
      name: i.product_name,
      qty: i.qty,
      modifiers: normalizeModifiers(i.modifiers),
      note: (i as { notes?: string | null }).notes ?? undefined,
    }));
    const comandaAddress = composeDeliveryAddress(o.delivery_address, o.delivery_neighborhood);
    const comandaPayload: PrintPayload = {
      type: "comanda",
      ticket: o.ticket_number,
      header,
      order_type: o.order_type ?? "online",
      items: comandaItems,
      customer: o.customer_name ?? "",
      notes: o.notes ?? "",
      address: comandaAddress,
      phone: o.customer_phone ?? "",
      user_name: "En línea",
      created_at: o.created_at,
    };
    void printSilent(comandaPayload, comandaHTML({
      ticket: o.ticket_number, header,
      items: comandaItems,
      customer: o.customer_name ?? "", notes: o.notes ?? "",
      address: comandaAddress, phone: o.customer_phone ?? "",
      created_at: o.created_at,
    }), { silent: true });

    // Estado intermedio: confirmado, listo para cobro. No se imprime ningún ticket de venta aquí.
    const { error } = await supabase
      .from("sales")
      .update({
        status: "confirmed",
        printed_at: new Date().toISOString(),
        kds_ack_at: new Date().toISOString(),
      })
      .eq("id", o.id)
      .eq("branch_id", activeBranchId);
    if (error) return toast.error(error.message);
    toast.success(`Pedido #${o.ticket_number} confirmado. Ya puedes proceder con el pago.`);
    qc.invalidateQueries({ queryKey: ["online-orders", activeBranchId] });
  }

  function printPreCuenta(o: SaleRow, its: ItemRow[]) {
    const header = o.order_type === "domicilio" ? "DOMICILIO" : o.order_type === "kiosko" ? "AUTOPEDIDO" : "MENÚ EN LÍNEA";
    const precAddress = composeDeliveryAddress(o.delivery_address, o.delivery_neighborhood);
    const payload: PrintPayload = {
      type: "precuenta",
      ticket: o.ticket_number,
      header: `PRE-CUENTA · ${header}`,
      items: its.map((i) => ({ name: i.product_name, qty: i.qty, unit_price: Number(i.unit_price) })),
      subtotal: Number(o.subtotal ?? 0),
      deliveryFee: Number(o.delivery_fee ?? 0),
      total: Number(o.total ?? 0),
      customer: o.customer_name ?? "",
      address: precAddress,
      phone: o.customer_phone ?? "",
      notes: o.notes ?? "",
      created_at: o.created_at,
      cashierMessage: "SOPORTE DE ENTREGA · No es factura de venta",
    };
    printSilent(payload, preCuentaHTML({
      ticket: o.ticket_number, header,
      items: its.map((i) => ({ name: i.product_name, qty: i.qty, unit_price: Number(i.unit_price) })),
      customer: o.customer_name ?? "", address: composeDeliveryAddress(o.delivery_address, o.delivery_neighborhood),
      phone: o.customer_phone ?? "", notes: o.notes ?? "",
      subtotal: Number(o.subtotal ?? 0), delivery_fee: Number(o.delivery_fee ?? 0),
      total: Number(o.total ?? 0), created_at: o.created_at,
    }), { silent: true });
    toast.success(`Pre-cuenta #${o.ticket_number} enviada a impresora`);
  }

  async function reject(id: string) {
    if (!confirm("¿Cancelar este pedido?")) return;
    const { error } = await supabase.from("sales").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido cancelado");
    qc.invalidateQueries({ queryKey: ["online-orders", activeBranchId] });
  }

  function resetPayState() {
    setPayOrder(null);
    setSelectedMethod(null);
    setPaymentRef("");
    setAmountReceived("");
    setCashDialogOpen(false);
  }

  /** Construye el ticket (args + mensaje WA) para diferir la impresión. */
  function buildTicketArtifacts(o: SaleRow, its: ItemRow[], method: string, cashReceived: number) {
    const header = o.order_type === "domicilio" ? "DOMICILIO" : o.order_type === "kiosko" ? "AUTOPEDIDO" : "MENÚ EN LÍNEA";
    const s = (settings ?? {}) as {
      business_name?: string; nit?: string; address?: string; phone?: string;
      logo_url?: string | null; ticket_header?: string | null; ticket_footer?: string | null;
      ticket_config?: Partial<TicketConfig> | null;
    };
    const branding: Branding = {
      business_name: activeBranch?.name || s.business_name || "Heladería Goloso",
      nit: activeBranch?.nit ?? s.nit ?? null,
      address: [activeBranch?.address, activeBranch?.neighborhood].filter(Boolean).join(" · ") || s.address || null,
      phone: activeBranch?.phone ?? s.phone ?? null,
      email: activeBranch?.email ?? null,
      logo_url: activeBranch?.logo_url ?? s.logo_url ?? null,
      ticket_header: activeBranch?.ticket_header ?? s.ticket_header ?? null,
      ticket_footer: activeBranch?.ticket_footer ?? s.ticket_footer ?? null,
      ticket_config: s.ticket_config ?? null,
    };
    const ticketArgs: Parameters<typeof ticketHTML>[0] = {
      ticket: o.ticket_number,
      header: `TICKET DE VENTA · ${header}`,
      items: its.map((i) => ({ name: i.product_name, qty: i.qty, unit_price: Number(i.unit_price) })),
      subtotal: Number(o.subtotal ?? 0),
      tax: 0,
      deliveryFee: Number(o.delivery_fee ?? 0),
      total: Number(o.total ?? 0),
      payment_method: method,
      customer: o.customer_name ?? "",
      user_name: "Pedido en línea",
      created_at: o.created_at,
      address: composeDeliveryAddress(o.delivery_address, o.delivery_neighborhood),
      phone: o.customer_phone ?? "",
      cash_received: method === "Efectivo" ? cashReceived : Number(o.total ?? 0),
      notes: o.notes ?? undefined,
      branding,
    };

    // Mensaje de WhatsApp con formato tipo ticket 80mm
    const phoneDigits = (o.customer_phone ?? "").replace(/[^\d]/g, "");
    let waMessage: string | null = null;
    if (phoneDigits && its.length > 0) {
      const bizName = (branding.business_name || "Heladería Goloso").toUpperCase();
      const bizNit = branding.nit || "";
      const bizAddr = branding.address || "";
      const bizPhone = branding.phone || "";
      const footer = branding.ticket_footer || "¡Gracias por Preferirnos!";
      const W = 32;
      const center = (t: string) => {
        const s2 = t.trim();
        if (s2.length >= W) return s2;
        const pad = Math.floor((W - s2.length) / 2);
        return " ".repeat(pad) + s2;
      };
      const dash = "-".repeat(W);
      const row = (l: string, r: string) => {
        const space = Math.max(1, W - l.length - r.length);
        return l + " ".repeat(space) + r;
      };
      const wrap = (t: string, w = W) => {
        const words = t.split(/\s+/);
        const out: string[] = [];
        let cur = "";
        for (const wd of words) {
          if ((cur + " " + wd).trim().length > w) { if (cur) out.push(cur); cur = wd; }
          else cur = (cur ? cur + " " : "") + wd;
        }
        if (cur) out.push(cur);
        return out;
      };
      const lines: string[] = [];
      lines.push(center(bizName));
      if (bizNit) lines.push(center(`NIT: ${bizNit}`));
      if (bizAddr) wrap(bizAddr).forEach((l) => lines.push(center(l)));
      if (bizPhone) lines.push(center(`TEL: ${bizPhone}`));
      lines.push(dash);
      lines.push(center(`TICKET DE VENTA`));
      lines.push(center(`TV-${String(o.ticket_number).padStart(6, "0")}`));
      lines.push(center(new Date(o.created_at).toLocaleString("es-CO")));
      lines.push(dash);
      if (o.customer_name) lines.push(`CLIENTE: ${o.customer_name.toUpperCase()}`);
      if (o.delivery_address) wrap(`DIR: ${o.delivery_address.toUpperCase()}`).forEach((l) => lines.push(l));
      if (o.delivery_neighborhood) wrap(`BARRIO: ${o.delivery_neighborhood.toUpperCase()}`).forEach((l) => lines.push(l));
      if (o.customer_phone) lines.push(`TEL:     ${o.customer_phone.toUpperCase()}`);
      lines.push(`PAGO:    ${method.toUpperCase()}`);
      lines.push(dash);
      lines.push(row("CANT  DESCRIPCION", "TOTAL"));
      lines.push(dash);
      for (const i of its) {
        const qty = String(i.qty).padEnd(4, " ");
        const money = formatMoney(i.unit_price * i.qty);
        const nameMax = W - qty.length - 1 - money.length - 1;
        const nameLines = wrap(i.product_name.toUpperCase(), Math.max(6, nameMax));
        lines.push(row(`${qty} ${nameLines[0]}`, money));
        for (let k = 1; k < nameLines.length; k++) lines.push("     " + nameLines[k]);
      }
      lines.push(dash);
      lines.push(row("SUBTOTAL", formatMoney(Number(o.subtotal ?? 0))));
      if (Number(o.delivery_fee ?? 0) > 0) {
        lines.push(row("DOMICILIO", formatMoney(Number(o.delivery_fee))));
      }
      lines.push(row("TOTAL", formatMoney(Number(o.total ?? 0))));
      if (method === "Efectivo") {
        const change = Math.max(0, cashReceived - Number(o.total ?? 0));
        lines.push(row("RECIBIDO", formatMoney(cashReceived)));
        lines.push(row("CAMBIO", formatMoney(change)));
      }
      lines.push(dash);
      lines.push(center(footer));
      const ticketBlock = "```\n" + lines.join("\n") + "\n```";
      waMessage = `🧾 *TICKET DE VENTA # ${o.ticket_number}*\n${bizName}\n\n${ticketBlock}\n\n¡Gracias por tu compra! 💛`;
    }

    return { ticketArgs, waMessage, waPhone: o.customer_phone ?? null };
  }

  /** Cobra el pedido con el método indicado. El ticket físico se imprime solo después de confirmar el pago. */
  async function payWithMethod(method: string, cashReceivedRaw?: string) {
    if (!payOrder) return;
    if (!activeBranchId || payOrder.branch_id !== activeBranchId) {
      toast.error("Este pedido pertenece a otra sede. Cambia a la sede correcta para cobrarlo.");
      return;
    }
    if (!cashSession?.id) {
      toast.error("No hay caja abierta en esta sede");
      return;
    }
    const cashReceived = Number((cashReceivedRaw ?? amountReceived).replace(/[^\d.]/g, "")) || 0;
    if (method === "Efectivo" && cashReceived < Number(payOrder.total)) {
      toast.error("Ingresa el monto recibido (≥ total)");
      return;
    }

    setPaying(true);
    const its = items.filter((i) => i.sale_id === payOrder.id);
    const noteSuffix = method === "Efectivo"
      ? `Recibido: ${cashReceived}`
      : paymentRef ? `Ref: ${paymentRef}` : "";
    const newNotes = [payOrder.notes, noteSuffix].filter(Boolean).join(" · ");

    const { data: paidRow, error } = await supabase
      .from("sales")
      .update({
        status: "paid",
        payment_method: method,
        cash_session_id: cashSession.id,
        notes: newNotes || null,
      })
      .eq("id", payOrder.id)
      .eq("branch_id", activeBranchId)
      .select("id,status,ticket_number,total")
      .maybeSingle();
    setPaying(false);
    if (error) return toast.error(error.message);
    if (!paidRow || paidRow.status !== "paid") {
      toast.error("No se pudo confirmar el pago. El ticket no será enviado.");
      return;
    }

    toast.success(`Pedido #${payOrder.ticket_number} cobrado con ${method}`);

    const artifacts = buildTicketArtifacts(payOrder, its, method, cashReceived);
    setTimeout(() => { void printTicketFinal(artifacts.ticketArgs); }, 0);
    setSuccessDialog({
      ticket: payOrder.ticket_number,
      method,
      total: Number(payOrder.total ?? 0),
      ...artifacts,
    });

    // Cerramos la UI de cobro pero mantenemos el diálogo de éxito.
    setPayOrder(null);
    setSelectedMethod(null);
    setPaymentRef("");
    setAmountReceived("");
    setCashDialogOpen(false);
    qc.invalidateQueries({ queryKey: ["online-orders", activeBranchId] });
  }





  function buildMsg(o: SaleRow, its: ItemRow[]) {
    const lines = its.map((i) => `• ${i.qty} × ${i.product_name} — ${formatMoney(i.unit_price * i.qty)}`).join("\n");
    return [
      `🍦 *Nuevo pedido en línea #${o.ticket_number}*`,
      `Cliente: ${o.customer_name ?? "—"}`,
      o.customer_phone ? `Tel: ${o.customer_phone}` : null,
      o.notes ? `Notas: ${o.notes}` : null,
      "",
      lines,
      "",
      `*TOTAL: ${formatMoney(o.total)}*`,
    ].filter(Boolean).join("\n");
  }

  const pending = orders.filter((o) => o.status === "pending");
  const confirmed = orders.filter((o) => o.status === "confirmed" || o.status === "ready");
  const history = orders.filter((o) => !["pending", "confirmed", "ready"].includes(o.status));
  const sedePhone: string | null = activeBranch?.phone ?? (settings as { phone?: string | null } | null | undefined)?.phone ?? null;

  return (
    <div className="space-y-4 premium-scope">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Pedidos en línea</h1>
          <p className="text-sm text-muted-foreground">
            Recibe automáticamente los pedidos del {activeBranch?.slug ? <a href={`/s/${activeBranch.slug}/menu`} className="underline">Menú en línea</a> : <Link to="/menu" className="underline">Menú en línea</Link>}.
            {sedePhone ? <> WhatsApp de la sede: <b>{sedePhone}</b></> : <> · <Link to="/ajustes" className="underline">Configura el WhatsApp en Ajustes</Link></>}
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Actualizar</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /> Nuevos pedidos ({pending.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <div className="text-muted-foreground text-sm">Cargando…</div>}
          {!isLoading && pending.length === 0 && <div className="text-muted-foreground text-sm py-8 text-center">Sin pedidos nuevos</div>}
          {pending.map((o) => {
            const its = items.filter((i) => i.sale_id === o.id);
            const msg = buildMsg(o, its);
            return (
              <div key={o.id} className="rounded-lg border p-3 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-lg flex items-center gap-2 flex-wrap">
                      <span>#{o.ticket_number} · {o.customer_name ?? "Cliente"}</span>
                      {o.source === "whatsapp_bot" && (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px]">🤖 Bot WhatsApp · Revisar</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(o.created_at).toLocaleString("es-CO")}
                      {o.customer_phone && <> · <Phone className="inline h-3 w-3" /> {o.customer_phone}</>}
                    </div>
                  </div>
                  <Badge variant="secondary">{formatMoney(o.total)}</Badge>
                </div>
                <ul className="text-sm space-y-0.5">
                  {its.map((i) => (
                    <li key={i.id}>{i.qty} × {i.product_name} <span className="text-muted-foreground">— {formatMoney(i.unit_price * i.qty)}</span></li>
                  ))}
                </ul>
                {(o.delivery_address || o.delivery_neighborhood) && (
                  <div className="text-xs text-muted-foreground">
                    {o.delivery_address && <>📍 {o.delivery_address}</>}
                    {o.delivery_neighborhood && <> · {o.delivery_neighborhood}</>}
                  </div>
                )}
                {o.notes && <div className="text-xs bg-muted rounded p-2"><b>Notas:</b> {o.notes}</div>}

                <div className="rounded-md border bg-muted/30 p-2 text-sm space-y-0.5">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(Number(o.subtotal ?? 0))}</span></div>
                  {Number(o.delivery_fee ?? 0) > 0 && (
                    <div className="flex justify-between"><span>Domicilio</span><span>{formatMoney(Number(o.delivery_fee))}</span></div>
                  )}
                  <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>{formatMoney(Number(o.total ?? 0))}</span></div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => confirmAndPrint(o, its)}>
                    <Printer className="h-4 w-4 mr-1" /> Confirmar e imprimir comanda
                  </Button>
                  {sedePhone && (
                    <Button asChild variant="outline" size="sm">
                      <a href={waLink(sedePhone, msg)} target="_blank" rel="noreferrer">
                        <MessageCircle className="h-4 w-4 mr-1" /> Avisar a la sede
                      </a>
                    </Button>
                  )}
                  {/* El ticket por WhatsApp al cliente se envía SOLO al confirmar el pago */}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => reject(o.id)}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Cancelar
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-2 border-primary/60">
        <CardHeader className="bg-primary/5">
          <CardTitle className="flex items-center gap-2 font-extrabold uppercase tracking-wide">
            <CheckCircle2 className="h-5 w-5 text-primary" /> Pedidos Confirmados en Espera ({confirmed.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground">En preparación / por despachar · pendientes de cobro</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {confirmed.length === 0 && <div className="text-muted-foreground text-sm py-8 text-center">No hay pedidos en espera</div>}
          {confirmed.map((o) => {
            const its = items.filter((i) => i.sale_id === o.id);
            return (
              <div key={o.id} className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-xl">#{o.ticket_number} · {o.customer_name ?? "Cliente"}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 mt-1">
                      <span>{new Date(o.created_at).toLocaleString("es-CO")}</span>
                      {o.customer_phone && <span><Phone className="inline h-3 w-3" /> {o.customer_phone}</span>}
                      {(o.delivery_address || o.delivery_neighborhood) && (
                        <span><MapPin className="inline h-3 w-3" /> {o.delivery_address}{o.delivery_neighborhood ? ` · ${o.delivery_neighborhood}` : ""}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge className="bg-amber-500 hover:bg-amber-500 text-white">{o.status === "ready" ? "Listo" : "En preparación"}</Badge>
                    <div className="font-display text-2xl text-primary mt-1">{formatMoney(o.total)}</div>
                  </div>
                </div>

                <ul className="text-sm space-y-0.5">
                  {its.map((i) => (
                    <li key={i.id}>{i.qty} × {i.product_name}</li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => printPreCuenta(o, its)}>
                    <Printer className="h-4 w-4 mr-1" /> Imprimir Pre-cuenta / Comanda
                  </Button>
                  <Button size="sm" onClick={() => setPayOrder(o)}>
                    <Banknote className="h-4 w-4 mr-1" /> Proceder con el pago
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => reject(o.id)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Historial reciente</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {history.slice(0, 20).map((o) => (
                <li key={o.id} className="py-2 flex justify-between">
                  <span>#{o.ticket_number} · {o.customer_name ?? "Cliente"} · <span className="text-muted-foreground">{new Date(o.created_at).toLocaleString("es-CO")}</span></span>
                  <span className="flex items-center gap-2"><Badge variant={o.status === "cancelled" ? "destructive" : "secondary"}>{translateSaleStatus(o.status)}</Badge>{formatMoney(o.total)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Diálogo principal de cobro — mismo estilo que POS mesas/llevar */}
      <Dialog open={!!payOrder && !cashDialogOpen} onOpenChange={(open) => { if (!open && !paying) resetPayState(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-primary" /> Cobrar {formatMoney(Number(payOrder?.total ?? 0))}
            </DialogTitle>
            <DialogDescription>
              Pedido #{payOrder?.ticket_number}
              {payOrder?.customer_name ? ` · ${payOrder.customer_name}` : ""}
              {Number(payOrder?.delivery_fee ?? 0) > 0 ? ` · Domicilio ${formatMoney(Number(payOrder!.delivery_fee))}` : ""}
            </DialogDescription>
          </DialogHeader>

          {!cashSession?.id && (
            <div className="rounded-md border border-amber-400 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              Abre caja en esta sede para poder cobrar.
            </div>
          )}

          <div className="flex flex-col gap-3 py-2">
            {(["Efectivo", "Nequi", "Bancolombia"] as const).map((methodName) => {
              const isCash = methodName === "Efectivo";
              const isNequi = methodName === "Nequi";
              const isBanco = methodName === "Bancolombia";
              const isDisabled = paying || !cashSession?.id;

              let style: CSSProperties = {
                background: "linear-gradient(180deg, #e5e7eb 0%, #cbd5e1 100%)",
                color: "#1f2937",
                boxShadow:
                  "inset 0 2px 0 rgba(255,255,255,0.6), inset 0 -4px 0 rgba(0,0,0,0.15), 0 6px 14px -4px rgba(0,0,0,0.35)",
                textShadow: "0 1px 0 rgba(255,255,255,0.4)",
              };
              if (isCash) {
                style = {
                  background: "linear-gradient(180deg, #4ade80 0%, #16a34a 100%)",
                  color: "#ffffff",
                  boxShadow:
                    "inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -5px 0 rgba(0,0,0,0.22), 0 8px 18px -6px rgba(22,163,74,0.55)",
                  textShadow: "0 2px 2px rgba(0,0,0,0.25)",
                };
              } else if (isNequi) {
                style = {
                  background: "linear-gradient(180deg, #bae6fd 0%, #38bdf8 100%)",
                  color: "#0c4a6e",
                  boxShadow:
                    "inset 0 2px 0 rgba(255,255,255,0.85), inset 0 -5px 0 rgba(0,0,0,0.15), 0 8px 18px -6px rgba(14,165,233,0.55)",
                };
              } else if (isBanco) {
                style = {
                  background: "linear-gradient(180deg, #fde047 0%, #eab308 100%)",
                  color: "#1a1a1a",
                  boxShadow:
                    "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -5px 0 rgba(0,0,0,0.2), 0 8px 18px -6px rgba(202,138,4,0.55)",
                };
              }

              return (
                <button
                  key={methodName}
                  type="button"
                  disabled={isDisabled}
                  style={style}
                  className="group relative flex h-20 w-full items-center justify-center gap-3 overflow-hidden rounded-full px-6 text-xl font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    if (isDisabled) return;
                    if (isCash) {
                      setSelectedMethod("Efectivo");
                      setAmountReceived("");
                      setCashDialogOpen(true);
                    } else {
                      setSelectedMethod(methodName);
                      void payWithMethod(methodName);
                    }
                  }}
                >
                  {isCash && (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
                      <Banknote className="h-6 w-6" strokeWidth={2.5} />
                    </span>
                  )}
                  {isNequi && (
                    <img
                      src={nequiLogo}
                      alt=""
                      aria-hidden="true"
                      className="h-14 w-14 shrink-0 object-contain drop-shadow-sm"
                      loading="eager"
                    />
                  )}
                  {isBanco && (
                    <img
                      src={bancolombiaLogo}
                      alt=""
                      aria-hidden="true"
                      className="h-14 w-14 shrink-0 object-contain drop-shadow-sm"
                      loading="eager"
                    />
                  )}
                  <span className="min-w-0 truncate">{methodName}</span>
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetPayState} disabled={paying}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-diálogo de EFECTIVO — mismo estilo que POS (billetes + input + cambio) */}
      <Dialog open={cashDialogOpen} onOpenChange={(open) => { if (!paying) setCashDialogOpen(open); }}>
        <DialogContent className="max-h-[92vh] sm:max-w-md p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="space-y-1 px-5 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-5 w-5 text-primary" /> Pago en efectivo
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ingresa el monto recibido del cliente para calcular el cambio.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Total a cobrar</span>
                <span className="font-display text-xl text-primary">{formatMoney(Number(payOrder?.total ?? 0))}</span>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-primary/5 px-4 py-2.5 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.6)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground text-center">Recibido</div>
              <div
                key={amountReceived}
                className="flex items-baseline justify-center gap-1 font-display font-bold tabular-nums tracking-tight text-foreground animate-scale-in"
              >
                <span className="text-xl text-primary/70">$</span>
                <span className="text-3xl sm:text-4xl leading-none">
                  {amountReceived === "" ? "0" : Number(amountReceived).toLocaleString("es-CO")}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground text-center mb-1">Digite el valor</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl font-semibold text-muted-foreground">$</span>
                <Input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  className="h-12 rounded-xl border-2 text-center font-display text-2xl font-bold tabular-nums tracking-wide shadow-inner"
                  value={amountReceived === "" ? "" : Number(amountReceived).toLocaleString("es-CO")}
                  onChange={(e) => setAmountReceived(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && Number(amountReceived) >= Number(payOrder?.total ?? 0) && !paying) {
                      void payWithMethod("Efectivo");
                    }
                  }}
                />
              </div>
            </div>

            <CashPayPad
              total={Number(payOrder?.total ?? 0)}
              cashReceived={amountReceived}
              onSetReceived={setAmountReceived}
              disabled={paying}
            />

            {amountReceived !== "" && (
              <div className={`rounded-xl p-3 text-sm flex justify-between items-center ${Number(amountReceived) < Number(payOrder?.total ?? 0) ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                <span className="font-medium">Cambio</span>
                <span className="font-display text-2xl font-bold tabular-nums">
                  {formatMoney(Math.max(0, Number(amountReceived) - Number(payOrder?.total ?? 0)))}
                </span>
              </div>
            )}
            {amountReceived !== "" && Number(amountReceived) < Number(payOrder?.total ?? 0) && (
              <div className="text-xs text-destructive text-center">
                Faltan {formatMoney(Number(payOrder?.total ?? 0) - Number(amountReceived))}
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t bg-background/95 backdrop-blur px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" onClick={() => setCashDialogOpen(false)} disabled={paying}>Cancelar</Button>
            <Button
              disabled={paying || amountReceived === "" || Number(amountReceived) < Number(payOrder?.total ?? 0)}
              onClick={() => { void payWithMethod("Efectivo"); }}
            >
              {paying ? "Cobrando…" : "Confirmar cobro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de éxito posterior al cobro: el ticket físico ya fue enviado a impresión. */}
      <Dialog open={!!successDialog} onOpenChange={(open) => { if (!open) setSuccessDialog(null); }}>
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
          <p className="text-center text-base font-medium">Ticket de venta enviado a impresión.</p>
          <DialogFooter className="sm:justify-center gap-2 flex-wrap">
            <Button
              variant="outline"
              className="font-bold"
              onClick={() => {
                setSuccessDialog(null);
              }}
            >
              Finalizar
            </Button>
            {successDialog?.waMessage && successDialog.waPhone && (
              <Button
                className="font-bold"
                onClick={() => {
                  const wa = successDialog?.waMessage;
                  const phone = successDialog?.waPhone;
                  setSuccessDialog(null);
                  if (wa && phone) window.open(waLink(phone, wa), "_blank", "noopener");
                }}
              >
                <MessageCircle className="h-4 w-4 mr-1" /> Enviar WhatsApp
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
