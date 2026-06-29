import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  MessageCircle, RefreshCw, Phone, Clock, CheckCircle2, Printer, Banknote, CreditCard, Smartphone, MapPin,
} from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { printSilent, type PrintPayload } from "@/lib/print-client";
import { useBranch } from "@/contexts/branch-context";
import { useBranchCashSession } from "@/hooks/use-branch-cash-session";

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
interface ItemRow { id: string; sale_id: string; product_name: string; qty: number; unit_price: number; }

function waLink(phone: string, msg: string) {
  const clean = phone.replace(/[^\d]/g, "");
  const num = clean.startsWith("57") || clean.length > 10 ? clean : `57${clean}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

function comandaHTML(o: { ticket: number; header: string; items: { name: string; qty: number }[]; customer: string; notes: string; address: string; phone: string; created_at: string; }) {
  const rows = o.items.map((i) => `<tr><td class="qty">${i.qty}×</td><td class="name">${i.name}</td></tr>`).join("");
  return `<!doctype html><html><head><title> </title><style>
    @page{size:80mm auto;margin:0}@media print{html,body{width:80mm;margin:0!important;padding:0!important}}
    html,body{width:80mm}body{font-family:'Arial Black','Helvetica',sans-serif;font-size:26px;padding:5mm 4mm;width:72mm;margin:0;color:#000;font-weight:900;line-height:1.35}
    h1{font-size:42px;margin:0 0 10px;text-align:center;letter-spacing:2px}h2{font-size:34px;margin:10px 0;text-transform:uppercase;text-align:center;border:3px solid #000;padding:6px 0}
    table{width:100%;border-collapse:collapse;margin-top:8px}td{vertical-align:top;padding:10px 0;border-bottom:2px dashed #000}
    td.qty{font-size:40px;width:80px;text-align:right;padding-right:12px}td.name{font-size:32px;text-transform:uppercase;line-height:1.2}
    hr{border:none;border-top:3px dashed #000;margin:8px 0}.meta{font-size:22px;margin:4px 0}.notes{margin-top:10px;font-size:24px;border:3px solid #000;padding:8px}.footer{margin-top:12px;text-align:center;font-size:24px}
  </style></head><body>
    <h1>COMANDA #${o.ticket}</h1>
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

function reciboDomicilioHTML(o: { ticket: number; customer: string; address: string; neighborhood: string; phone: string; total: number; payment_method: string; created_at: string; }) {
  return `<!doctype html><html><head><title> </title><style>
    @page{size:80mm auto;margin:0}@media print{html,body{width:80mm;margin:0!important;padding:0!important}}
    html,body{width:80mm}body{font-family:'Arial Black','Helvetica',sans-serif;padding:5mm 4mm;width:72mm;margin:0;color:#000;font-weight:900;line-height:1.3}
    h1{font-size:30px;margin:0 0 4px;text-align:center;letter-spacing:1px}
    h2{font-size:38px;margin:6px 0;text-align:center;border:3px solid #000;padding:8px 0;background:#000;color:#fff}
    .label{font-size:18px;text-transform:uppercase;margin-top:10px;letter-spacing:1px}
    .val{font-size:30px;border-bottom:3px solid #000;padding:4px 0;word-wrap:break-word}
    .val.lg{font-size:34px}
    .total-box{margin-top:14px;border:4px double #000;padding:10px;text-align:center}
    .total-box .t{font-size:22px;text-transform:uppercase}
    .total-box .v{font-size:48px;line-height:1.1}
    .pay-box{margin-top:14px;border:3px solid #000;padding:10px}
    .pay-box .line{border-bottom:3px solid #000;height:42px;margin-top:6px}
    .footer{margin-top:14px;text-align:center;font-size:18px;border-top:2px dashed #000;padding-top:8px}
  </style></head><body>
    <h1>HELADERÍA GOLOSO</h1>
    <h2>DOMICILIO #${o.ticket}</h2>
    <div style="text-align:center;font-size:16px;margin-bottom:6px">${new Date(o.created_at).toLocaleString("es-CO")}</div>
    <div class="label">Cliente</div><div class="val lg">${o.customer || "—"}</div>
    <div class="label">Teléfono</div><div class="val lg">${o.phone || "—"}</div>
    <div class="label">Dirección</div><div class="val">${o.address || "—"}${o.neighborhood ? `<br/>${o.neighborhood}` : ""}</div>
    <div class="total-box">
      <div class="t">Total a cobrar</div>
      <div class="v">${formatMoney(o.total)}</div>
      <div style="font-size:18px;margin-top:4px">Pago: ${o.payment_method || "Pendiente"}</div>
    </div>
    <div class="pay-box">
      <div style="font-size:20px;text-transform:uppercase">Paga con:</div>
      <div class="line"></div>
      <div style="font-size:20px;text-transform:uppercase;margin-top:10px">Cambio:</div>
      <div class="line"></div>
    </div>
    <div class="footer">Entregar al domiciliario<br/>¡Gracias por tu compra!</div>
  </body></html>`;
}

function OnlineOrdersPage() {
  const qc = useQueryClient();
  const { activeBranchId, activeBranch } = useBranch();
  const { session: cashSession } = useBranchCashSession(activeBranchId);
  const [payOrder, setPayOrder] = useState<SaleRow | null>(null);
  const [paying, setPaying] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["settings-one"],
    queryFn: async () => (await supabase.from("settings").select("*").maybeSingle()).data,
  });

  const { data: orders = [], isLoading, refetch } = useQuery<SaleRow[]>({
    queryKey: ["online-orders", activeBranchId],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("*")
        .eq("source", "online_menu")
        .order("created_at", { ascending: false })
        .limit(150);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
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
    const ch = supabase
      .channel("po-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: "source=eq.online_menu" },
        () => qc.invalidateQueries({ queryKey: ["online-orders"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);


  async function confirmAndPrint(o: SaleRow, its: ItemRow[]) {
    const header = o.order_type === "domicilio" ? "DOMICILIO" : o.order_type === "kiosko" ? "KIOSKO" : "MENÚ EN LÍNEA";
    // 1) Comanda de cocina
    const comandaPayload: PrintPayload = {
      type: "comanda",
      ticket: o.ticket_number,
      header,
      items: its.map((i) => ({ name: i.product_name, qty: i.qty })),
      customer: o.customer_name ?? "",
      notes: o.notes ?? "",
      address: o.delivery_address ?? "",
      phone: o.customer_phone ?? "",
      user_name: "En línea",
      created_at: o.created_at,
    };
    printSilent(comandaPayload, comandaHTML({
      ticket: o.ticket_number, header,
      items: its.map((i) => ({ name: i.product_name, qty: i.qty })),
      customer: o.customer_name ?? "", notes: o.notes ?? "",
      address: o.delivery_address ?? "", phone: o.customer_phone ?? "",
      created_at: o.created_at,
    }));

    // 2) Recibo para el domiciliario (solo si es domicilio o hay dirección)
    if (o.order_type === "domicilio" || o.delivery_address) {
      const reciboPayload: PrintPayload = {
        type: "comprobante",
        ticket: o.ticket_number,
        header: `DOMICILIO #${o.ticket_number}`,
        items: its.map((i) => ({ name: i.product_name, qty: i.qty, unit_price: Number(i.unit_price) })),
        subtotal: Number(o.subtotal ?? 0),
        deliveryFee: Number(o.delivery_fee ?? 0),
        total: Number(o.total ?? 0),
        customer: o.customer_name ?? "",
        address: o.delivery_address ?? "",
        phone: o.customer_phone ?? "",
        payment_method: o.payment_method ?? "Pendiente",
        created_at: o.created_at,
        cashierMessage: "RECIBO DE DOMICILIO · Paga con: ____  Cambio: ____",
      };
      // Pequeño retraso para evitar colisión con la comanda en la cola del servidor
      setTimeout(() => {
        printSilent(reciboPayload, reciboDomicilioHTML({
          ticket: o.ticket_number,
          customer: o.customer_name ?? "",
          address: o.delivery_address ?? "",
          neighborhood: o.delivery_neighborhood ?? "",
          phone: o.customer_phone ?? "",
          total: Number(o.total ?? 0),
          payment_method: o.payment_method ?? "Pendiente",
          created_at: o.created_at,
        }));
      }, 600);
    }

    // Estado intermedio: confirmado, listo para cobro
    const { error } = await supabase
      .from("sales")
      .update({
        status: "confirmed",
        printed_at: new Date().toISOString(),
        kds_ack_at: new Date().toISOString(),
      })
      .eq("id", o.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["online-orders"] });
  }

  function printPreCuenta(o: SaleRow, its: ItemRow[]) {
    const header = o.order_type === "domicilio" ? "DOMICILIO" : o.order_type === "kiosko" ? "KIOSKO" : "MENÚ EN LÍNEA";
    const payload: PrintPayload = {
      type: "comprobante",
      ticket: o.ticket_number,
      header: `PRE-CUENTA · ${header}`,
      items: its.map((i) => ({ name: i.product_name, qty: i.qty, unit_price: Number(i.unit_price) })),
      subtotal: Number(o.subtotal ?? 0),
      deliveryFee: Number(o.delivery_fee ?? 0),
      total: Number(o.total ?? 0),
      customer: o.customer_name ?? "",
      created_at: o.created_at,
      cashierMessage: "SOPORTE DE ENTREGA · No es factura de venta",
    };
    printSilent(payload, preCuentaHTML({
      ticket: o.ticket_number, header,
      items: its.map((i) => ({ name: i.product_name, qty: i.qty, unit_price: Number(i.unit_price) })),
      customer: o.customer_name ?? "", address: o.delivery_address ?? "",
      phone: o.customer_phone ?? "", notes: o.notes ?? "",
      subtotal: Number(o.subtotal ?? 0), delivery_fee: Number(o.delivery_fee ?? 0),
      total: Number(o.total ?? 0), created_at: o.created_at,
    }));
    toast.success(`Pre-cuenta #${o.ticket_number} enviada a impresora`);
  }

  async function reject(id: string) {
    if (!confirm("¿Cancelar este pedido?")) return;
    const { error } = await supabase.from("sales").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido cancelado");
    qc.invalidateQueries({ queryKey: ["online-orders"] });
  }

  async function processPayment(method: string) {
    if (!payOrder) return;
    if (!cashSession?.id) {
      toast.error("No hay caja abierta en esta sede");
      return;
    }
    setPaying(true);
    const its = items.filter((i) => i.sale_id === payOrder.id);
    const { error } = await supabase
      .from("sales")
      .update({
        status: "paid",
        payment_method: method,
        cash_session_id: cashSession.id,
      })
      .eq("id", payOrder.id);
    setPaying(false);
    if (error) return toast.error(error.message);

    // Ticket de venta digital → WhatsApp del cliente
    if (payOrder.customer_phone) {
      const negocio = (settings as { business_name?: string } | null | undefined)?.business_name ?? "Heladería Goloso";
      const lines = its.map((i) => `• ${i.qty} × ${i.product_name} — ${formatMoney(i.unit_price * i.qty)}`).join("\n");
      const msg = [
        `🍦 *${negocio}*`,
        `Ticket de venta #${payOrder.ticket_number}`,
        new Date().toLocaleString("es-CO"),
        "",
        lines,
        "",
        `*TOTAL: ${formatMoney(payOrder.total)}*`,
        `Pago: ${method}`,
        "",
        "¡Gracias por tu compra! 💛",
      ].join("\n");
      window.open(waLink(payOrder.customer_phone, msg), "_blank", "noopener");
    }

    toast.success(`Pedido #${payOrder.ticket_number} cobrado con ${method}`);
    setPayOrder(null);
    qc.invalidateQueries({ queryKey: ["online-orders"] });
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
  const sedePhone: string | null = (settings as { phone?: string | null } | null | undefined)?.phone ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Pedidos en línea</h1>
          <p className="text-sm text-muted-foreground">
            Recibe automáticamente los pedidos del <Link to="/menu" className="underline">Menú en línea</Link>.
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
                    <div className="font-display text-lg">#{o.ticket_number} · {o.customer_name ?? "Cliente"}</div>
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
                  {o.customer_phone && (
                    <Button asChild variant="outline" size="sm">
                      <a href={waLink(o.customer_phone, `Hola ${o.customer_name ?? ""}, recibimos tu pedido #${o.ticket_number}. ¡Lo estamos preparando!`)} target="_blank" rel="noreferrer">
                        <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp cliente
                      </a>
                    </Button>
                  )}
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
                    <Banknote className="h-4 w-4 mr-1" /> Procesar Pago / Finalizar
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
                  <span className="flex items-center gap-2"><Badge variant={o.status === "cancelled" ? "destructive" : "secondary"}>{o.status}</Badge>{formatMoney(o.total)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!payOrder} onOpenChange={(open) => { if (!open) setPayOrder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cobrar pedido #{payOrder?.ticket_number}</DialogTitle>
            <DialogDescription>
              Selecciona el método de pago con el que se recaudó el dinero.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-muted p-3 text-center">
              <div className="text-xs text-muted-foreground">Total a cobrar</div>
              <div className="font-display text-3xl text-primary">{formatMoney(Number(payOrder?.total ?? 0))}</div>
              {payOrder?.customer_name && <div className="text-sm mt-1">{payOrder.customer_name}</div>}
            </div>
            {!cashSession?.id && (
              <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-sm text-destructive">
                Debes abrir caja en esta sede para registrar el cobro.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button disabled={paying || !cashSession?.id} onClick={() => processPayment("Efectivo")} className="h-16 flex-col">
                <Banknote className="h-5 w-5" /> Efectivo
              </Button>
              <Button disabled={paying || !cashSession?.id} onClick={() => processPayment("Nequi")} variant="secondary" className="h-16 flex-col">
                <Smartphone className="h-5 w-5" /> Nequi
              </Button>
              <Button disabled={paying || !cashSession?.id} onClick={() => processPayment("Bancolombia")} variant="secondary" className="h-16 flex-col">
                <CreditCard className="h-5 w-5" /> Bancolombia
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOrder(null)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
