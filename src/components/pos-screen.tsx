import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Minus, Plus, Trash2, Search, ShoppingCart, Utensils, ShoppingBag, Bike, Monitor, Save, Banknote, Check, Printer, Star, ChefHat, StickyNote, Users, XCircle } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { printSilent, sendToLocalPrinter, kickCashDrawer, normalizeModifiers, type PrintPayload } from "@/lib/print-client";
import { useBranch } from "@/contexts/branch-context";
import { ModifiersModal } from "@/components/modifiers-modal";
import { useBranchCashSession } from "@/hooks/use-branch-cash-session";
import { CashPayPad } from "@/components/cash-pay-pad";
import { SplitBillDialog, type SplitPart } from "@/components/split-bill-dialog";
import { Split, Smartphone, Building2 } from "lucide-react";
import { CreditActionButtons, CreditSaleDialog, CreditPaymentDialog } from "@/components/credit-dialogs";
import nequiLogo from "@/assets/nequi-logo-transparent.png";
import bancolombiaLogo from "@/assets/bancolombia-logo-original.png";
import golosoLogo from "@/assets/logo-goloso.png";





export type OrderType = "mesa" | "llevar" | "domicilio" | "kiosko";

interface Category { id: string; name: string; sort_order: number; show_in_pos?: boolean; show_in_online_menu?: boolean; }
interface Product { id: string; name: string; price: number; category_id: string | null; image_url: string | null; active: boolean; is_favorite?: boolean; modifier_group_ids?: string[] | null; available_branch_ids?: string[] | null; }
interface SaleModifier { id: string; group_id: string; group_name: string; name: string; price: number; qty: number; }
interface CartLine { key: string; product_id: string; name: string; unit_price: number; qty: number; modifiers: SaleModifier[]; notes?: string; }

const TYPE_META: Record<OrderType, { label: string; icon: typeof Utensils; color: string }> = {
  mesa: { label: "Mesa", icon: Utensils, color: "bg-primary text-primary-foreground" },
  llevar: { label: "Para llevar", icon: ShoppingBag, color: "bg-amber-500 text-white" },
  domicilio: { label: "A domicilio", icon: Bike, color: "bg-blue-500 text-white" },
  kiosko: { label: "Autopedido", icon: Monitor, color: "bg-purple-500 text-white" },
};

export interface TicketConfig {
  show_logo: boolean;
  show_business_name: boolean;
  show_nit: boolean;
  show_address: boolean;
  show_phone: boolean;
  show_email: boolean;
  show_ticket_number: boolean;
  show_date: boolean;
  show_customer: boolean;
  show_customer_address: boolean;
  show_customer_phone: boolean;
  show_payment_method: boolean;
  show_subtotal: boolean;
  show_tax: boolean;
  show_delivery_fee: boolean;
  show_cash_received: boolean;
  show_thanks: boolean;
  show_decorations: boolean;
  title_text: string;
  number_prefix: string;
  thanks_text: string;
  extra_footer: string;
}

export const DEFAULT_TICKET_CONFIG: TicketConfig = {
  show_logo: true, show_business_name: true, show_nit: true, show_address: true,
  show_phone: true, show_email: true, show_ticket_number: true, show_date: true,
  show_customer: true, show_customer_address: true, show_customer_phone: true,
  show_payment_method: true, show_subtotal: true, show_tax: true, show_delivery_fee: true,
  show_cash_received: true, show_thanks: true, show_decorations: true,
  title_text: "TICKET DE VENTA", number_prefix: "TV-",
  thanks_text: "¡Gracias por Preferirnos!", extra_footer: "",
};

export interface Branding {
  business_name: string;
  nit?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logo_url?: string | null;
  ticket_header?: string | null;
  ticket_footer?: string | null;
  ticket_config?: Partial<TicketConfig> | null;
}

const DEFAULT_BRANDING: Branding = { business_name: "Heladería Goloso" };

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

export function comandaHTML(o: {
  ticket: number; header: string; items: { name: string; qty: number; modifiers?: string[] }[];
  customer: string; notes: string; address: string; phone: string;
  user_name: string; created_at: string;
  order_type?: string;
  branding?: Branding;
  /** Cuando true, imprime un banner "ADICIÓN AL PEDIDO" (productos añadidos
   *  a un pedido de mesa ya servido). */
  is_addition?: boolean;
}) {
  const b = o.branding ?? DEFAULT_BRANDING;
  const rows = o.items
    .map(
      (i) => `<tr>
        <td class="qty">${i.qty}×</td>
        <td class="name">${i.name}</td>
      </tr>`,
    )
    .join("");
  const logoHTML = b.logo_url
    ? `<div style="text-align:center;margin:0 0 6px"><img src="${b.logo_url}" alt="logo" style="width:40mm;height:40mm;object-fit:contain;display:block;margin:0 auto;background:#fff"/></div>`
    : "";
  return `<!doctype html><html><head><title> </title>
  <style>
    @page{size:80mm auto;margin:0}
    @media print{html,body{width:80mm;margin:0!important;padding:0!important}}
    html,body{width:80mm}
    body{font-family:'Arial','Helvetica',sans-serif;font-size:11px;padding:4mm 3mm;width:74mm;margin:0;color:#000;font-weight:700;line-height:1.2}
    h1{font-size:15px;margin:0 0 3px;text-align:center;font-weight:900;letter-spacing:0.5px}
    .sede{font-size:11px;text-align:center;font-weight:900;text-transform:uppercase;margin:0 0 2px}
    h2.order-type{font-size:26px;margin:10px 0;font-weight:900;text-transform:uppercase;text-align:center;border:2.5px solid #000;padding:10px 4px;letter-spacing:1.5px;line-height:1.1}
    table{width:100%;border-collapse:collapse;margin-top:3px}
    td{vertical-align:top;padding:3px 0;border-bottom:1px dashed #000}
    td.qty{font-size:13px;font-weight:900;width:36px;text-align:right;padding-right:8px}
    td.name{font-size:12px;font-weight:800;text-transform:uppercase;line-height:1.15;white-space:pre-line}
    hr{border:none;border-top:1px dashed #000;margin:3px 0}
    .meta{font-size:10px;font-weight:700;margin:1px 0}
    .meta.big{font-size:11px;font-weight:800}
    .notes{margin-top:5px;font-size:11px;font-weight:800;border:1.5px solid #000;padding:4px;line-height:1.2;text-transform:uppercase}
    .notes .lbl{font-size:10px;letter-spacing:0.5px;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:2px}
    .footer{margin-top:6px;text-align:center;font-size:11px;font-weight:900}

  </style></head>
  <body>
    ${logoHTML}
    <div class="sede">${b.business_name || "Heladería Goloso"}</div>
    <h1>PEDIDO #${o.ticket}</h1>
    <div class="meta" style="text-align:center">${new Date(o.created_at).toLocaleString("es-CO")}</div>
    <div class="meta" style="text-align:center">Cajero: ${o.user_name}</div>
    <hr/>
    <h2 class="order-type">${o.header}</h2>
    ${o.customer ? `<div class="meta big">Cliente: ${o.customer}</div>` : ""}
    ${o.address ? `<div class="meta big">Dir: ${o.address}</div>` : ""}
    ${o.phone ? `<div class="meta big">Tel: ${o.phone}</div>` : ""}
    <hr/>
    <table>${rows}</table>
    ${o.notes ? `<div class="notes"><div class="lbl">OBSERVACIÓN:</div>${o.notes}</div>` : ""}
    <div class="footer">*** ENVIAR A COCINA ***</div>
  </body></html>`;
}

/* SVG icons (Lucide) inlined for thermal-printer reliability */
const SVG = {
  idCard: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h3M15 12h3M7 16h10"/></svg>`,
  pin:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
  phone:  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>`,
  cal:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  user:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  card:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>`,
  bill:   `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`,
  mail:   `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>`,
};

const TICKET_STYLES = `@page{size:80mm auto;margin:0}
@media print{html,body{width:80mm;margin:0!important;padding:0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#000}.logo{filter:none}*{color:#000!important}}
html,body{width:80mm}
*{box-sizing:border-box}
body{font-family:'Helvetica Neue','Arial',sans-serif;font-size:15px;padding:4mm;width:72mm;margin:0;color:#000;line-height:1.35}
.logo-wrap{text-align:center;margin:0 0 4px}
.logo{width:40mm;height:40mm;object-fit:contain;display:block;margin:0 auto;background:#fff}
.biz-name{font-size:30px;margin:6px 0 8px;text-align:center;font-weight:900;letter-spacing:1px;text-transform:uppercase;font-family:'Arial Black','Helvetica',sans-serif;line-height:1.05}
.biz-meta{display:flex;align-items:center;justify-content:center;gap:8px;font-size:17px;font-weight:700;line-height:1.3;margin:4px 0;text-align:center}
.biz-meta svg{flex-shrink:0;width:18px;height:18px}
.dots,.dashed{border:0;border-top:1.5px dashed #000;margin:8px 0;width:100%;height:0}
.ticket-no{text-align:center;font-weight:900;font-size:22px;letter-spacing:1px;font-family:'Arial Black','Impact',sans-serif;text-transform:uppercase;margin:6px 0;line-height:1.1}
.ticket-no .num{font-weight:900;font-size:22px;margin-left:6px;letter-spacing:1.5px;text-transform:none}
.info{display:grid;grid-template-columns:auto 1fr;column-gap:10px;row-gap:8px;font-size:17px;margin:8px 0 4px}
.info .label{display:flex;align-items:center;gap:6px;font-weight:900;white-space:nowrap;text-transform:none;font-size:17px}
.info .label svg{flex-shrink:0;width:18px;height:18px}
.info .val{text-align:left;word-break:break-word;font-size:17px;font-weight:600}
.tbl{width:100%;border-collapse:collapse;margin-top:4px}
.tbl thead th{font-size:13px;font-weight:900;text-transform:uppercase;padding:8px 0;border-top:1.5px dashed #000;border-bottom:0;font-family:'Arial Black',sans-serif;letter-spacing:.6px}
.tbl th.qty,.tbl td.qty{width:22%;text-align:left}
.tbl th.det,.tbl td.det{text-align:center;padding:0 4px;white-space:pre-line}
.tbl th.tot,.tbl td.tot{width:30%;text-align:right;white-space:nowrap}
.tbl td{padding:8px 0;font-size:16px;vertical-align:top;font-weight:700}
.tbl td.qty{font-weight:700;font-size:16px;text-align:left;padding-left:4px}
.tbl tbody tr:last-child td{border-bottom:1.5px dashed #000}
.sub-row{display:flex;justify-content:flex-end;gap:14px;font-size:15px;padding:4px 0}
.sub-row.first{padding-top:8px}
.sub-row .lbl{font-weight:900;text-transform:uppercase;letter-spacing:.4px}
.total-row{display:flex;justify-content:space-between;align-items:baseline;margin:6px 0 8px;padding:4px 0}
.total-row .lbl{font-family:'Arial Black',sans-serif;font-weight:900;font-size:36px;letter-spacing:.5px}
.total-row .val{font-family:'Arial Black',sans-serif;font-weight:900;font-size:42px}
.cash{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:16px;padding:10px 0;border-top:1.5px dashed #000;border-bottom:1.5px dashed #000;margin-top:2px}
.cash .ln{display:flex;align-items:center;gap:6px}
.cash .ln .lf{display:flex;align-items:center;gap:6px;font-weight:900}
.cash .ln .lf svg{width:20px;height:20px}
.cash .ln .rv{font-weight:700}
.thanks{text-align:center;font-family:'Brush Script MT','Lucida Handwriting','Segoe Script',cursive;font-style:italic;font-weight:700;font-size:22px;margin:10px 0 4px;white-space:nowrap;line-height:1.15;overflow:hidden}
.deco{display:none}
.deco-bot{display:none}`;


export function ticketHTML(o: {
  ticket: number; header: string;
  items: { name: string; qty: number; unit_price: number }[];
  subtotal: number; tax: number; deliveryFee: number; tip?: number; total: number;
  payment_method: string; customer: string; user_name: string; created_at: string;
  address?: string; phone?: string; cash_received?: number;
  notes?: string;
  branding?: Branding;
}) {
  const b = o.branding ?? DEFAULT_BRANDING;
  const cfg: TicketConfig = { ...DEFAULT_TICKET_CONFIG, ...(b.ticket_config ?? {}) };
  const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    const date = d.toISOString().slice(0, 10);
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const s = d.getSeconds().toString().padStart(2, "0");
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${date}&nbsp;&nbsp;${String(h).padStart(2, "0")}:${m}:${s}&nbsp;${ap}`;
  };
  const received = Number(o.cash_received ?? o.total);
  const change = Math.max(0, received - o.total);
  const ticketNo = String(o.ticket).trim().replace(/^#+\s*/, "");
  const logoHTML = (cfg.show_logo && b.logo_url)
    ? `<div class="logo-wrap"><img src="${b.logo_url}" alt="logo" class="logo"/></div>`
    : "";
  const rows = o.items
    .map(
      (i) => `<tr>
        <td class="qty">${i.qty}</td>
        <td class="det">${i.name.toUpperCase()}</td>
        <td class="tot">${money(i.unit_price * i.qty)}</td>
      </tr>`,
    )
    .join("");
  const infoRows: string[] = [];
  if (cfg.show_date) infoRows.push(`<div class="label">${SVG.cal} Fecha:</div><div class="val">${fmtDate(o.created_at)}</div>`);
  if (cfg.show_customer) infoRows.push(`<div class="label">${SVG.user} Cliente:</div><div class="val">${(o.customer || "Mostrador").toUpperCase()}</div>`);
  if (cfg.show_customer_address && o.address) infoRows.push(`<div class="label">${SVG.pin} Dirección:</div><div class="val">${o.address.toUpperCase()}</div>`);
  if (cfg.show_customer_phone && o.phone) infoRows.push(`<div class="label">${SVG.phone} Teléfono:</div><div class="val">${o.phone.toUpperCase()}</div>`);
  if (cfg.show_payment_method) infoRows.push(`<div class="label">${SVG.card} Forma de Pago:</div><div class="val">${(o.payment_method || "").toUpperCase()}</div>`);
  const thanksText = (cfg.thanks_text || b.ticket_footer || "¡Gracias por Preferirnos!");
  return `<!doctype html><html><head><meta charset="utf-8"/><title> </title><style>${TICKET_STYLES}</style></head>
  <body>
    ${logoHTML}
    ${cfg.show_business_name ? `<h1 class="biz-name">${(b.business_name || "Heladería Goloso").toUpperCase()}</h1>` : ""}
    ${cfg.show_nit ? `<div class="biz-meta">${SVG.idCard}<span>NIT: ${b.nit ?? "—"}</span></div>` : ""}
    ${cfg.show_address && b.address ? `<div class="biz-meta">${SVG.pin}<span>${b.address}</span></div>` : ""}
    ${cfg.show_phone && b.phone ? `<div class="biz-meta">${SVG.phone}<span>${b.phone}</span></div>` : ""}
    ${cfg.show_email && b.email ? `<div class="biz-meta">${SVG.mail}<span>${b.email}</span></div>` : ""}
    <hr class="dashed"/>
    <div class="ticket-no">${cfg.title_text || "TICKET DE VENTA"}<span class="num">#${ticketNo}</span></div><hr class="dashed"/>
    ${infoRows.length ? `<div class="info">${infoRows.join("")}</div><hr class="dashed"/>` : ""}
    <table class="tbl">
      <thead><tr><th class="qty">CANTIDAD</th><th class="det">DETALLE</th><th class="tot">TOTAL</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${cfg.show_subtotal ? `<div class="sub-row first"><span class="lbl">Subtotal:</span><span>${money(o.subtotal)}</span></div>` : ""}
    ${cfg.show_tax && o.tax > 0 ? `<div class="sub-row"><span class="lbl">Impuesto:</span><span>${money(o.tax)}</span></div>` : ""}
    ${cfg.show_delivery_fee && o.deliveryFee > 0 ? `<div class="sub-row"><span class="lbl">Domicilio:</span><span>${money(o.deliveryFee)}</span></div>` : ""}
    ${Number(o.tip) > 0 ? `<div class="sub-row"><span class="lbl">Propina:</span><span>${money(Number(o.tip))}</span></div>` : ""}
    <div class="total-row"><span class="lbl">TOTAL:</span><span class="val">${money(o.total)}</span></div>
    ${o.notes ? `<div style="margin-top:6px;padding:8px;border:1.5px dashed #000;font-size:13px;line-height:1.35"><div style="font-weight:900;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">NOTAS DEL PEDIDO:</div><div style="white-space:pre-line;font-weight:700">${o.notes}</div></div>` : ""}
    ${cfg.show_cash_received ? `<div class="cash">
      <div class="ln"><span class="lf">${SVG.bill} Recibido:</span><span class="rv">${money(received)}</span></div>
      <div class="ln"><span class="lf">Cambio:</span><span class="rv">${money(change)}</span></div>
    </div>` : ""}
    ${cfg.show_thanks ? `<div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px">
      <span style="font-size:26px">🍨</span>
      <div class="thanks" style="margin:0">${thanksText}</div>
      <span style="font-size:26px">🍨</span>
    </div>` : ""}
    ${cfg.extra_footer ? `<div style="text-align:center;font-size:13px;margin-top:6px;white-space:pre-line;font-weight:700">${cfg.extra_footer}</div>` : ""}
    ${cfg.show_decorations ? `<div class="deco">♥ · 🍦 · ♥ · 🍧 · ♥ · 🍦 · ♥</div>` : ""}
  </body></html>`;
}




function precuentaHTML(o: {
  header: string; items: { name: string; qty: number; unit_price: number }[];
  subtotal: number; tax: number; deliveryFee: number; total: number;
  customer: string; user_name: string;
  ticket?: number | null;
  created_at?: string | null;
  branding?: Branding;
}) {
  const b = o.branding ?? DEFAULT_BRANDING;
  const money = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
  const rows = o.items
    .map((i) => `<tr><td style="white-space:pre-line">${i.qty} × ${i.name}</td><td style="text-align:right;white-space:nowrap;vertical-align:top">${money(i.unit_price * i.qty)}</td></tr>`)
    .join("");
  const when = o.created_at ? new Date(o.created_at) : new Date();
  const ticketStr = o.ticket ? String(o.ticket).padStart(6, "0") : "PENDIENTE";
  return `<!doctype html><html><head><title> </title><style>${TICKET_STYLES}</style></head>
  <body>
    ${brandHeaderHTML(b)}
    <hr/>
    <h2>PRECUENTA</h2>
    <div class="muted">No. ${ticketStr}</div>
    <div class="muted">${when.toLocaleString("es-CO")}</div>
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

// Cache en memoria de las impresoras por área. Evita hacer un round-trip
// a Supabase por cada impresión (comanda + ticket = 2 queries).
type PrinterCfg = { ip?: string; port?: number; open_drawer_on_print?: boolean };
type PrintersRow = { name: string | null; ip: string | null; port: number | null; open_drawer_on_print: boolean | null; area: string | null; active: boolean | null };
let _printersCache: PrintersRow[] | null = null;
let _printersFetchedAt = 0;
const PRINTERS_TTL_MS = 60_000;
let _printersInflight: Promise<PrintersRow[]> | null = null;

async function loadPrinters(): Promise<PrintersRow[]> {
  const now = Date.now();
  if (_printersCache && now - _printersFetchedAt < PRINTERS_TTL_MS) return _printersCache;
  if (_printersInflight) return _printersInflight;
  _printersInflight = (async () => {
    try {
      const { data } = await supabase
        .from("printers")
        .select("name,ip,port,open_drawer_on_print,active,area")
        .eq("active", true);
      _printersCache = (data as PrintersRow[] | null) ?? [];
      _printersFetchedAt = Date.now();
      return _printersCache;
    } catch (e) {
      console.warn("[print] no se pudo consultar impresora", e);
      return _printersCache ?? [];
    } finally {
      _printersInflight = null;
    }
  })();
  return _printersInflight;
}

export function invalidatePrintersCache() {
  _printersCache = null;
  _printersFetchedAt = 0;
}

async function fetchPrinterByArea(areas: string[]): Promise<PrinterCfg> {
  const data = await loadPrinters();
  const p = areas.map((area) => data.find((printer) => printer.area === area)).find(Boolean);
  const looksLikeIp = (value?: string | null) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value ?? "").trim());
  let ip = p?.ip?.trim() || (looksLikeIp(p?.name) ? String(p?.name).trim() : undefined);
  let port = p?.port ?? undefined;

  if (!ip && areas.includes("caja")) {
    try {
      const { data: settingsPrinter } = await supabase
        .from("settings")
        .select("cashier_printer_ip,cashier_printer_port")
        .limit(1)
        .maybeSingle();
      ip = (settingsPrinter as { cashier_printer_ip?: string | null } | null)?.cashier_printer_ip?.trim() || undefined;
      port = (settingsPrinter as { cashier_printer_port?: number | null } | null)?.cashier_printer_port ?? port;
    } catch (e) {
      console.warn("[print] no se pudo consultar impresora de caja en ajustes", e);
    }
  }

  return { ip, port, open_drawer_on_print: p?.open_drawer_on_print ?? undefined };
}

async function fetchCajaPrinter(): Promise<PrinterCfg> {
  return fetchPrinterByArea(["caja"]);
}

async function fetchComandaPrinter(): Promise<PrinterCfg> {
  return fetchPrinterByArea(["cocina", "barra", "caja"]);
}

export async function printComanda(o: Parameters<typeof comandaHTML>[0]) {
  const { ip, port } = await fetchComandaPrinter();
  const b = o.branding ?? DEFAULT_BRANDING;
  const payload: PrintPayload = {
    type: "comanda", ticket: o.ticket, header: o.header,
    items: o.items, customer: o.customer, notes: o.notes,
    address: o.address, phone: o.phone, user_name: o.user_name, created_at: o.created_at,
    order_type: o.order_type,
    business_name: b.business_name,
    is_addition: o.is_addition,
    printer_ip: ip, printer_port: port,
  };
  const ok = await sendToLocalPrinter(payload);
  if (!ok) {
    console.warn("[print] comanda no enviada: servidor local no disponible");
  }
  return ok;
}


export async function printTicketFinal(o: Parameters<typeof ticketHTML>[0]): Promise<void> {
  const cajaCfg = await fetchCajaPrinter();
  const printerIp = cajaCfg.ip;
  const printerPort = cajaCfg.port;
  const openDrawer = !!cajaCfg.open_drawer_on_print;

  const b = o.branding ?? DEFAULT_BRANDING;
  const logoUrl = toAbsolutePrintUrl(b.logo_url) ?? toAbsolutePrintUrl(golosoLogo);
  const logoFallbackUrl = toAbsolutePrintUrl(golosoLogo);
  const payload: PrintPayload = {
    type: "ticket",
    ticket: o.ticket,
    ticket_number: o.ticket,
    header: o.header,
    items: o.items,
    subtotal: o.subtotal,
    tax: o.tax,
    deliveryFee: o.deliveryFee,
    tip: o.tip,
    total: o.total,
    payment_method: o.payment_method,
    customer: o.customer,
    notes: o.notes,
    address: o.address,
    phone: o.phone,
    user_name: o.user_name,
    created_at: o.created_at,
    cash_received: o.cash_received,
    business_name: b.business_name,
    nit: b.nit ?? undefined,
    address_biz: b.address ?? undefined,
    phone_biz: b.phone ?? undefined,
    email_biz: b.email ?? undefined,
    footer_text: b.ticket_footer ?? undefined,
    logo_url: logoUrl,
    logo_fallback_url: logoFallbackUrl,
    ticket_config: { ...DEFAULT_TICKET_CONFIG, ...(b.ticket_config ?? {}), show_logo: true },
    ticket_template: "goloso_personalizado",
    printer_ip: printerIp,
    printer_port: printerPort,
    open_drawer: openDrawer,
  };

  // Impresión SIEMPRE silenciosa vía servidor de impresión local (ESC/POS).
  // No abrimos NUNCA el diálogo del navegador — el cajero no debe ser
  // interrumpido con ventanas emergentes ni selección de impresora.
  const ok = await sendToLocalPrinter(payload);
  if (!ok) {
    console.warn(
      "[print] ticket no impreso: servidor local no disponible. " +
        'Configura localStorage.LOCAL_PRINT_URL="http://localhost:3001/print"',
    );
  }
  if (openDrawer && printerIp) {
    void kickCashDrawer({ printer_ip: printerIp, printer_port: printerPort });
  }
}


function printPrecuenta(o: Parameters<typeof precuentaHTML>[0]) {
  const payload: PrintPayload = {
    type: "precuenta", header: o.header, items: o.items,
    subtotal: o.subtotal, tax: o.tax, deliveryFee: o.deliveryFee, total: o.total,
    customer: o.customer, user_name: o.user_name,
    ticket: o.ticket ?? undefined,
    ticket_number: o.ticket ?? undefined,
    created_at: o.created_at ?? undefined,
  };
  printSilent(payload, precuentaHTML(o), { silent: true });
}




interface Props {
  orderType: OrderType;
  tableId?: string | null;
  /** ID de una venta pendiente del Autopedido a cargar para cobrar en caja. */
  kioskSaleId?: string | null;
  title?: string;
  /** Modo mesero (tablet): oculta pagos, precuenta y caja. Solo Guardar/KDS. */
  meseroMode?: boolean;
  /** Callback ejecutado después de guardar la comanda; si se provee, suplanta el redirect interno. */
  onSaved?: () => void;
  /** Datos iniciales del cliente (usado por el selector de domicilio). */
  initialCustomer?: string;
  initialPhone?: string;
  initialAddress?: string;
  initialNeighborhood?: string;
  /** Imagen decorativa opcional para el encabezado (aparece entre el título y el buscador). */
  headerImage?: string;
  /** Texto alternativo de la imagen del encabezado. */
  headerImageAlt?: string;
}

export function PosScreen({ orderType, tableId, kioskSaleId, title, meseroMode: meseroModeProp = false, onSaved, initialCustomer, initialPhone, initialAddress, initialNeighborhood, headerImage, headerImageAlt }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, profile, primaryRole, isAdmin } = useAuth();
  // Los usuarios con rol "mesero" nunca pueden cobrar: forzamos meseroMode aunque
  // el POS se abra desde una ruta que no lo pase (oculta cobros, precuenta y caja).
  const meseroMode = meseroModeProp || (primaryRole === "mesero" && !isAdmin);
  const { activeBranchId, activeBranch } = useBranch();
  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState(initialCustomer ?? "");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState(initialAddress ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [neighborhood, setNeighborhood] = useState(initialNeighborhood ?? "");
  const [fieldErrors, setFieldErrors] = useState<{ customer?: boolean; address?: boolean; neighborhood?: boolean; phone?: boolean }>({});
  const [paying, setPaying] = useState(false);
  const [pendingSaleId, setPendingSaleId] = useState<string | null>(null);
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const [noteProduct, setNoteProduct] = useState<Product | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteQty, setNoteQty] = useState(1);
  const [cashDialogOpen, setCashDialogOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [tip, setTip] = useState<number>(0);
  const [tipDialogOpen, setTipDialogOpen] = useState(false);
  const [tipInput, setTipInput] = useState<string>("");
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [abonoDialogOpen, setAbonoDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const canCancelSales = primaryRole === "cajero" || isAdmin;
  const [successDialog, setSuccessDialog] = useState<null | {
    ticket: number;
    method: string;
    total: number;
    printPayload: Parameters<typeof printTicketFinal>[0];
    redirectTo: "/mesas" | "/llevar" | "/domicilio" | "/kiosko" | null;
  }>(null);


  // Cantidades ya impresas por línea (product_id → qty) — permite reimprimir
  // en la comanda SOLO los ítems agregados después del último guardado, y
  // evita la duplicación de productos ya enviados a cocina.
  const printedQtyRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setCart([]);
    setCustomer(initialCustomer ?? "");
    setAddress(initialAddress ?? "");
    setPhone(initialPhone ?? "");
    setNeighborhood(initialNeighborhood ?? "");
    setNotes("");
    setPendingSaleId(null);
    setTip(0);
    setTipInput("");
    printedQtyRef.current = {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, tableId, initialCustomer, initialPhone, initialAddress, initialNeighborhood]);

  // Enfocar buscador al entrar al POS (sidebar queda como el usuario lo tenga)
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);


  // Atajos de teclado: F2 buscar, Esc limpiar búsqueda
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if (e.key === "Escape" && document.activeElement === searchRef.current) { setSearch(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);



  const { data: cats = [] } = useQuery({
    queryKey: ["categories", "pos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("categories")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      return ((data ?? []) as Category[]).filter((c) => c.show_in_pos !== false);
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
      const { data } = await supabase.from("settings").select("delivery_fee,tax_rate,business_name,nit,address,phone,logo_url,ticket_header,ticket_footer,ticket_config,enable_tips").maybeSingle();
      return data as (Branding & { delivery_fee: number; tax_rate: number; enable_tips?: boolean | null; ticket_config?: Partial<TicketConfig> | null }) | null;
    },
  });
  const tipsEnabled = !!settings?.enable_tips;
  const branding: Branding = {
    business_name: activeBranch?.name || settings?.business_name || "Heladería Goloso",
    nit: activeBranch?.nit ?? settings?.nit ?? null,
    address: [activeBranch?.address, activeBranch?.neighborhood].filter(Boolean).join(" · ") || settings?.address || null,
    phone: activeBranch?.phone ?? settings?.phone ?? null,
    email: activeBranch?.email ?? null,
    logo_url: activeBranch?.logo_url ?? settings?.logo_url ?? null,
    ticket_header: activeBranch?.ticket_header ?? settings?.ticket_header ?? null,
    ticket_footer: activeBranch?.ticket_footer ?? settings?.ticket_footer ?? null,
    ticket_config: settings?.ticket_config ?? null,
  };



  // Sesión de caja a nivel de SEDE (la usa la tablet de meseros para heredar el turno_id de la caja matriz)
  const { session: branchSession } = useBranchCashSession(activeBranchId);
  const openSession = branchSession;
  const effectiveSessionId = branchSession?.id ?? null;
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
        .select("id,ticket_number,customer_name,notes,created_at,printed_at,sale_items(product_id,product_name,qty,unit_price)")
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
        printed_at: string | null;
        sale_items: { product_id: string; product_name: string; qty: number; unit_price: number }[];
      };
    },
  });

  useEffect(() => {
    if (!pendingSale) return;
    // No hidrates el carrito mientras el usuario está en pleno guardado —
    // podría reintroducir ítems recién guardados sobre un cart ya limpio.
    if (paying) return;
    setPendingSaleId(pendingSale.id);
    setCustomer(pendingSale.customer_name ?? "");
    setNotes(pendingSale.notes ?? "");
    const hydrated = (pendingSale.sale_items ?? []).map((i) => ({
      key: i.product_id,
      product_id: i.product_id,
      name: i.product_name,
      unit_price: Number(i.unit_price),
      qty: Number(i.qty),
      modifiers: [] as SaleModifier[],
    }));
    setCart(hydrated);
    // Solo asumimos ítems ya enviados si el registro tiene confirmación real
    // de impresión. Si el primer envío falló, el siguiente Guardar imprimirá todo.
    const printed: Record<string, number> = {};
    if (pendingSale.printed_at) {
      for (const l of hydrated) printed[l.key] = (printed[l.key] ?? 0) + l.qty;
    }
    printedQtyRef.current = printed;
  }, [pendingSale, paying]);


  // Cargar pedido pendiente del Autopedido (al ser seleccionado desde el panel)
  const { data: kioskSale } = useQuery({
    queryKey: ["kiosk-sale", kioskSaleId],
    enabled: !!kioskSaleId,
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("id,ticket_number,customer_name,notes,created_at,payment_method,sale_items(product_id,product_name,qty,unit_price)")
        .eq("id", kioskSaleId!)
        .maybeSingle();
      return data as null | {
        id: string;
        ticket_number: number;
        customer_name: string | null;
        notes: string | null;
        created_at: string;
        payment_method: string | null;
        sale_items: { product_id: string; product_name: string; qty: number; unit_price: number }[];
      };
    },
  });

  useEffect(() => {
    if (!kioskSale) return;
    setPendingSaleId(kioskSale.id);
    setCustomer(kioskSale.customer_name ?? "");
    setNotes(kioskSale.notes ?? "");
    setCart(
      (kioskSale.sale_items ?? []).map((i) => ({
        key: i.product_id,
        product_id: i.product_id,
        name: i.product_name,
        unit_price: Number(i.unit_price),
        qty: Number(i.qty),
        modifiers: [],
      })),
    );
  }, [kioskSale]);


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visibleCatIds = new Set(cats.map((c) => c.id));
    const seenIds = new Set<string>();
    const base = products.filter((p) => {
      // Filtrar por sede activa: si el producto tiene sedes asignadas, debe incluir la activa.
      const bids = p.available_branch_ids;
      if (activeBranchId && bids && bids.length > 0 && !bids.includes(activeBranchId)) return false;
      // Dedupe defensivo por id (evita cualquier duplicado accidental)
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      // Si la categoría del producto está oculta en POS, descártalo
      if (p.category_id && !visibleCatIds.has(p.category_id)) return false;
      if (activeCat !== "all" && p.category_id !== activeCat) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // Favoritos primero, luego el resto; ambos alfabéticos.
    return [...base].sort((a, b) => {
      const fa = a.is_favorite ? 0 : 1;
      const fb = b.is_favorite ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.name.localeCompare(b.name, "es");
    });
  }, [products, cats, activeCat, search, activeBranchId]);


  const deliveryFee = orderType === "domicilio" ? Number(settings?.delivery_fee ?? 0) : 0;
  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0);
  const taxRate = Number(settings?.tax_rate ?? 0);
  const tax = Math.round((subtotal * taxRate) / 100);
  const effectiveTip = tipsEnabled ? Math.max(0, Math.round(tip)) : 0;
  const total = subtotal + tax + deliveryFee + effectiveTip;


  function add(p: Product) {
    if (p.modifier_group_ids && p.modifier_group_ids.length > 0) {
      setModalProduct(p);
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === p.id && l.modifiers.length === 0);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { key: p.id, product_id: p.id, name: p.name, unit_price: Number(p.price), qty: 1, modifiers: [] }];
    });
    toast.success(p.name, { duration: 900, position: "bottom-center" });
  }
  function addWithModifiers(p: Product, mods: SaleModifier[], unitExtra: number, note?: string) {
    const label = mods.length
      ? [p.name, ...mods.map((m) => `  + ${m.qty}× ${m.name}`)].join("\n")
      : p.name;
    setCart((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        product_id: p.id,
        name: label,
        unit_price: Number(p.price) + unitExtra,
        qty: 1,
        modifiers: mods,
        notes: note,
      },
    ]);
  }
  function addWithNote(p: Product, note: string, qty: number) {
    setCart((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        product_id: p.id,
        name: p.name,
        unit_price: Number(p.price),
        qty: Math.max(1, qty),
        modifiers: [],
        notes: note.trim() || undefined,
      },
    ]);
  }
  function dec(key: string) {
    setCart((p) => p.flatMap((l) => (l.key === key ? (l.qty <= 1 ? [] : [{ ...l, qty: l.qty - 1 }]) : [l])));
  }
  function remove(key: string) {
    setCart((p) => p.filter((l) => l.key !== key));
  }

  function validateDelivery(): boolean {
    if (orderType !== "domicilio") {
      setFieldErrors({});
      return true;
    }
    const errs = {
      customer: !customer.trim(),
      address: !address.trim(),
      neighborhood: !neighborhood.trim(),
      phone: !phone.trim(),
    };
    setFieldErrors(errs);
    if (errs.customer || errs.address || errs.neighborhood || errs.phone) {
      toast.error("Este campo es obligatorio para envíos a domicilio");
      return false;
    }
    return true;
  }

  async function pay(method: string, paymentDetails?: Record<string, unknown> | null, creditCustomer?: { id: string; name: string } | null) {
    const payDetailsJson = (paymentDetails ?? null) as unknown as import("@/integrations/supabase/types").Json;
    // Validaciones previas — si fallan, NO se imprime ni se libera nada
    if (!user) return toast.error("Inicia sesión para cobrar");
    if (!effectiveSessionId) return toast.error("Debes abrir caja antes de cobrar");
    if (cart.length === 0) return toast.error("Carrito vacío");
    if (!validateDelivery()) return;

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
            payment_details: payDetailsJson,
            status: "paid",
            cash_session_id: effectiveSessionId,
            customer_name: customer || null,
            notes: notes || null,
            delivery_address: orderType === "domicilio" ? address : null,
            delivery_phone: orderType === "domicilio" ? phone : null,
            delivery_neighborhood: orderType === "domicilio" ? neighborhood : null,
            delivery_fee: deliveryFee,
            tip_amount: effectiveTip,
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
            payment_details: payDetailsJson,
            status: "paid",
            cash_session_id: effectiveSessionId,
            customer_name: customer || null,
            notes: notes || null,
            order_type: orderType,
            table_id: tableId ?? null,
            branch_id: activeBranchId,
            delivery_address: orderType === "domicilio" ? address : null,
            delivery_phone: orderType === "domicilio" ? phone : null,
            delivery_neighborhood: orderType === "domicilio" ? neighborhood : null,
            delivery_fee: deliveryFee,
            tip_amount: effectiveTip,
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
          modifiers: JSON.parse(JSON.stringify(l.modifiers ?? [])),
          notes: l.notes?.trim() ? l.notes.trim() : null,
        }));

        const { error: e2 } = await supabase.from("sale_items").insert(items);
        if (e2) {
          console.error("[pay] insert items error", e2);
          throw new Error(e2.message || "No se pudieron guardar los productos de la venta");
        }
      }

      console.log(`[pay] venta #${sale.ticket_number} registrada como ${method}`);

      // Si es venta a crédito, crear cuenta por cobrar
      if (creditCustomer) {
        // Vincular cliente a la venta
        await supabase.from("sales").update({ customer_id: creditCustomer.id, customer_name: creditCustomer.name }).eq("id", sale.id);
        const { error: cErr } = await supabase.from("credits").insert({
          sale_id: sale.id,
          customer_id: creditCustomer.id,
          branch_id: activeBranchId,
          ticket_number: sale.ticket_number,
          total: Number(sale.total),
          balance: Number(sale.total),
          status: "pendiente",
          created_by: user.id,
          created_by_name: profile?.full_name ?? user.email ?? "Cajero",
        });
        if (cErr) {
          console.error("[pay] insert credit error", cErr);
          toast.error("La venta se registró pero no se pudo crear el crédito: " + cErr.message);
        } else {
          toast.success(`Crédito creado para ${creditCustomer.name}`);
        }
      }

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
      setNeighborhood("");
      setFieldErrors({});
      setPendingSaleId(null);
      setCashDialogOpen(false);
      setCashReceived("");
      setTip(0);
      setTipInput("");

      qc.invalidateQueries({ queryKey: ["dashboard-today"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["pending-sale"] });
      qc.invalidateQueries({ queryKey: ["kds-pending"] });
      qc.invalidateQueries({ queryKey: ["kiosk-pending"] });
      qc.invalidateQueries({ queryKey: ["kiosk-orders"] });

      toast.success(`Venta #${sale.ticket_number} cobrada con ${method}`);

      // ───────────────────────────────────────────────────────────────
      // PASO 3: Mostrar modal de confirmación post-venta
      // (la impresión y la redirección quedan a cargo del cajero desde el modal)
      // ───────────────────────────────────────────────────────────────
      // Tras finalizar cualquier venta (mesa/llevar/domicilio/autopedido)
      // volvemos al Panel de Mesas, que es la pantalla principal del cajero.
      const redirectTo: "/mesas" = "/mesas";

      // Mostrar diálogo de confirmación para imprimir el ticket.
      // La impresión SOLO se ejecuta si el cajero pulsa "Sí, imprimir".
      const ticketPayload: Parameters<typeof printTicketFinal>[0] = {
        ticket: sale.ticket_number,
        header: snapshotHeader,
        items: snapshotItems,
        subtotal,
        tax,
        deliveryFee,
        tip: effectiveTip,
        total: Number(sale.total),
        payment_method: sale.payment_method,
        customer: snapshotCustomer,
        user_name: snapshotUserName,
        created_at: sale.created_at,
        address: snapshotAddress,
        phone: snapshotPhone,
        notes: snapshotNotes,
        cash_received: method === "Efectivo" && cashReceived !== "" ? Number(cashReceived) : Number(sale.total),
        branding,
      };
      setSuccessDialog({
        ticket: sale.ticket_number,
        method: sale.payment_method,
        total: Number(sale.total),
        printPayload: ticketPayload,
        redirectTo,
      });



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
    if (paying) {
      console.warn("[pos] saveComanda ignorado: ya hay una operación en curso");
      return;
    }
    if (!user) return toast.error("Inicia sesión para guardar el pedido");
    if (!effectiveSessionId) return toast.error("No hay caja abierta en esta sede");
    if (cart.length === 0) return toast.error("Carrito vacío");
    if (!validateDelivery()) return;
    console.log("[pos] saveComanda inicio · user=", user.id, "· pendingSaleId=", pendingSaleId, "· items=", cart.length);
    setPaying(true);

    // Watchdog: si algo se cuelga (red, RLS que no responde, token vencido)
    // liberamos el botón a los 25s con un mensaje claro para el cajero. Esto
    // evita el bug "no responde a la primera" que dejaba `paying=true` para
    // siempre cuando una llamada de Supabase no resolvía.
    const watchdog = window.setTimeout(() => {
      console.error("[pos] saveComanda: watchdog disparado a los 15s — liberando UI");
      setPaying(false);
      toast.error("La operación tardó demasiado. Reintenta o recarga la página.");
    }, 25000);

    // Guardamos si es la PRIMERA vez que se guarda este pedido.
    // Cuando es nuevo debemos imprimir SIEMPRE toda la comanda, sin depender
    // del baseline `printedQtyRef` (que aún podría estar desactualizado por
    // la hidratación asincrónica de un pedido pendiente previo).
    const isFirstSave = !pendingSaleId;
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
            delivery_neighborhood: orderType === "domicilio" ? neighborhood : null,
            delivery_fee: deliveryFee,
            cash_session_id: effectiveSessionId,
          })
          .eq("id", pendingSaleId)
          .select("id,ticket_number,created_at")
          .maybeSingle();
        if (error) throw new Error(error.message || "No se pudo actualizar el pedido");
        if (!data) {
          // Sin permiso o el pedido pertenece a otro usuario — reiniciamos flujo como venta nueva
          console.warn("[pos] update devolvió 0 filas (posible RLS), reintentando como INSERT");
          setPendingSaleId(null);
          const ins = await supabase
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
              customer_name: customer || null,
              notes: notes || null,
              order_type: orderType,
              table_id: tableId ?? null,
              branch_id: activeBranchId,
              delivery_address: orderType === "domicilio" ? address : null,
              delivery_phone: orderType === "domicilio" ? phone : null,
              delivery_neighborhood: orderType === "domicilio" ? neighborhood : null,
              delivery_fee: deliveryFee,
              cash_session_id: effectiveSessionId,
            })
            .select("id,ticket_number,created_at")
            .single();
          if (ins.error) throw new Error(ins.error.message || "No se pudo guardar el pedido");
          sale = ins.data;
        } else {
          sale = data;
          await supabase.from("sale_items").delete().eq("sale_id", pendingSaleId);
        }
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
            customer_name: customer || null,
            notes: notes || null,
            order_type: orderType,
            table_id: tableId ?? null,
            branch_id: activeBranchId,
            delivery_address: orderType === "domicilio" ? address : null,
            delivery_phone: orderType === "domicilio" ? phone : null,
            delivery_neighborhood: orderType === "domicilio" ? neighborhood : null,
            delivery_fee: deliveryFee,
            cash_session_id: effectiveSessionId,
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

      console.log("[pos] saveComanda · sale guardado #", sale.ticket_number);

      const items = cart.map((l) => ({
        sale_id: sale.id,
        product_id: l.product_id,
        product_name: l.name,
        qty: l.qty,
        unit_price: l.unit_price,
        subtotal: l.unit_price * l.qty,
        modifiers: JSON.parse(JSON.stringify(l.modifiers ?? [])),
        notes: l.notes?.trim() ? l.notes.trim() : null,
      }));

      const { error: e2 } = await supabase.from("sale_items").insert(items);
      if (e2) {
        console.error("save items error", e2);
        throw new Error(e2.message || "No se pudieron guardar los productos");
      }

      // La mesa se marca como "ocupada" automáticamente por el trigger DB
      // `auto_occupy_table_on_sale_item` cuando se inserta el primer producto.
      // No hacemos UPDATE manual aquí para evitar dejar mesas ocupadas si el
      // flujo se interrumpe antes de guardar productos.
      if (orderType === "mesa" && tableId) {
        qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
      }


      // Delta de impresión: solo los ítems (o cantidades) NUEVAS respecto a
      // lo ya enviado a cocina en comandas previas de la misma mesa. Evita que
      // se repitan los productos ya impresos.
      // En el PRIMER guardado imprimimos SIEMPRE todo el carrito. En saves
      // posteriores solo imprimimos el delta (ítems o cantidades añadidas
      // desde la última comanda enviada a cocina) para evitar duplicados.
      const alreadyPrinted = isFirstSave ? {} : { ...printedQtyRef.current };
      const deltaLines = cart
        .map((l) => {
          const prev = alreadyPrinted[l.key] ?? 0;
          const newQty = Math.max(0, l.qty - prev);
          return { line: l, newQty };
        })
        .filter((x) => x.newQty > 0);

      const printItems =
        deltaLines.length > 0
          ? deltaLines.map(({ line, newQty }) => ({
              name: line.name,
              qty: newQty,
              modifiers: normalizeModifiers(line.modifiers),
            }))
          : []; // sin ítems nuevos → no imprimimos comanda para no duplicar



      // Cuando NO es el primer guardado, esta comanda contiene solo los
      // productos adicionales que el cliente pidió después de recibir su
      // pedido inicial. Marcamos `is_addition` para que el servidor imprima
      // un banner "ADICIÓN AL PEDIDO" y evite confusiones en cocina.
      const isAddition = !isFirstSave && printItems.length > 0;
      const printSnapshot = {
        ticket: sale.ticket_number,
        header,
        items: printItems,
        customer,
        notes,
        address: orderType === "domicilio" ? address : "",
        phone: orderType === "domicilio" ? phone : "",
        user_name: profile?.full_name ?? user.email ?? "",
        created_at: sale.created_at,
        order_type: orderType,
        branding,
        is_addition: isAddition,
      };

      // Actualizar baseline: lo que hay en el carrito ahora ya se considera impreso.
      const newBaseline: Record<string, number> = {};
      for (const l of cart) newBaseline[l.key] = (newBaseline[l.key] ?? 0) + l.qty;
      printedQtyRef.current = newBaseline;

      // 1º DB ya guardada · 2º KDS realtime · 3º Impresión física en background.
      qc.invalidateQueries({ queryKey: ["kds-pending"] });
      qc.invalidateQueries({ queryKey: ["sales"] });

      if (printItems.length === 0) {
        toast.success(`Pedido #${sale.ticket_number} actualizado (sin ítems nuevos para imprimir)`);
      } else {
        toast.success(`Comanda #${sale.ticket_number} enviada a cocina y KDS`);
        try {
          const printed = await printComanda(printSnapshot);
          if (printed) {
            await supabase.from("sales").update({ printed_at: new Date().toISOString() }).eq("id", sale.id);
            toast.success(`Impresión #${sale.ticket_number} enviada`);
          } else {
            toast.warning("Comanda guardada, pero no se pudo imprimir (revisa el servidor local)");
          }
        } catch (e) {
          console.error("[print] comanda", e);
          toast.warning("Comanda guardada, pero no se pudo imprimir (revisa el servidor local)");
        }
      }

      // Limpiar estado local y regresar al panel principal
      setCart([]);
      setCustomer("");
      setNotes("");
      setAddress("");
      setPhone("");
      setNeighborhood("");
      setFieldErrors({});
      setPendingSaleId(null);
      qc.invalidateQueries({ queryKey: ["pending-sale"] });

      // CRÍTICO: liberamos `paying` ANTES de navegar. Antes se hacía en el
      // `finally`, pero al navegar el componente se desmonta y el setState
      // no llega — si el usuario volvía a la misma mesa (mismo componente
      // recuperado por React) veía el botón atascado en "Enviando…".
      window.clearTimeout(watchdog);
      setPaying(false);

      if (onSaved) {
        onSaved();
      } else {
        if (orderType === "mesa") navigate({ to: "/mesas" });
        else if (orderType === "llevar") navigate({ to: "/llevar" });
        else if (orderType === "domicilio") navigate({ to: "/domicilio" });
        else if (orderType === "kiosko") navigate({ to: "/kiosko" });
      }
    } catch (err) {
      console.error("[pos] saveComanda error", err);
      toast.error(err instanceof Error ? err.message : "Error al guardar");
      window.clearTimeout(watchdog);
      setPaying(false);
    }
  }



  async function handlePrecuenta() {
    // Si el pedido ya está guardado, recargar items desde la base para garantizar el monto correcto
    let items = cart.map((l) => ({ name: l.name, qty: l.qty, unit_price: l.unit_price }));
    let dFee = deliveryFee;
    let ticketNum: number | null = null;
    let createdAt: string | null = null;
    if (pendingSaleId) {
      const { data } = await supabase
        .from("sales")
        .select("ticket_number,created_at,delivery_fee,sale_items(product_name,qty,unit_price)")
        .eq("id", pendingSaleId)
        .maybeSingle();
      if (data) {
        items = (data.sale_items ?? []).map((i) => ({ name: i.product_name, qty: Number(i.qty), unit_price: Number(i.unit_price) }));
        dFee = Number(data.delivery_fee ?? 0);
        ticketNum = data.ticket_number ?? null;
        createdAt = data.created_at ?? null;
      }
    }
    if (items.length === 0) return toast.error("Carrito vacío");
    if (!ticketNum) {
      return toast.error("Guarda primero el pedido para generar el consecutivo de la precuenta");
    }
    // Recalcular subtotal/tax/total desde los items para evitar desfases
    // con valores almacenados que pudieron quedar desactualizados.
    const sub = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
    const tx = Math.round((sub * taxRate) / 100);
    const tot = sub + tx + dFee;
    printPrecuenta({
      header,
      items,
      subtotal: sub,
      tax: tx,
      deliveryFee: dFee,
      total: tot,
      customer,
      user_name: profile?.full_name ?? user?.email ?? "",
      ticket: ticketNum,
      created_at: createdAt,
      branding,
    });

  }






  const meta = TYPE_META[orderType];
  const Icon = meta.icon;
  const header = title
    ?? (kioskSale ? `Autopedido · Pedido #${kioskSale.ticket_number}` : mesa ? `${mesa.label ?? `Mesa ${mesa.number}`}` : meta.label);

  // Guard: no intentar dibujar la pantalla hasta que estén listos el usuario
  // y la sede activa. Esto evita TypeError por dereferenciar `user`/`activeBranch`
  // en el primer render (causa típica del crash "This page didn't load").
  if (!user || !activeBranchId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
          <p className="text-sm">Cargando POS…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative grid gap-4 pb-32 lg:grid-cols-[1fr,420px]">
      {meseroMode && paying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-8 py-6 shadow-2xl">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
            <p className="text-sm font-medium">Enviando comanda…</p>
            <p className="text-xs text-muted-foreground">Caja · Cocina · KDS</p>
          </div>
        </div>
      )}


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
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-row sm:items-center sm:gap-4">
          <div className={`flex min-w-0 items-center gap-2 ${orderType === "llevar" ? "justify-center sm:justify-start w-full sm:w-auto" : ""}`}>
            {orderType !== "llevar" && (
              <Badge className={`${meta.color} shrink-0`}>
                <Icon className="h-3 w-3 mr-1" /> {meta.label}
              </Badge>
            )}
            <h1 className={`font-display font-extrabold tracking-tight truncate ${orderType === "llevar" ? "text-3xl sm:text-4xl uppercase" : "text-2xl"}`}>{header}</h1>
          </div>
          {headerImage && (
            <img
              src={headerImage}
              alt={headerImageAlt ?? ""}
              className="block h-[90px] sm:h-[130px] md:h-[160px] w-auto object-contain select-none shrink-0 mx-auto bg-transparent border-0 shadow-none"
              draggable={false}
            />
          )}
          <div className="relative col-span-2 w-full sm:col-auto sm:ml-auto sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Buscar producto…  (F2)"
              className="pl-9 rounded-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length > 0) {
                  e.preventDefault();
                  const p = filtered[0];
                  if (p.modifier_group_ids && p.modifier_group_ids.length > 0) setModalProduct(p);
                  else { add(p); setSearch(""); }
                }
              }}
            />
          </div>
        </div>

        <Tabs value={activeCat} onValueChange={setActiveCat} className="sticky top-14 z-20 -mx-1 bg-background/85 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent">
            <TabsTrigger
              value="all"
              className="font-display font-extrabold uppercase tracking-wide text-sm px-3 py-1.5 rounded-xl data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-glow"
            >
              Todo
            </TabsTrigger>
            {cats.map((c) => (
              <TabsTrigger
                key={c.id}
                value={c.id}
                className="font-display font-extrabold uppercase tracking-wide text-sm px-3 py-1.5 rounded-xl data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-glow"
              >
                {c.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {filtered.map((p) => {
            const openAdd = () => {
              setNoteText("");
              setNoteQty(1);
              if (p.modifier_group_ids && p.modifier_group_ids.length > 0) {
                setModalProduct(p);
              } else {
                setNoteProduct(p);
              }
            };
            return (
            <div
              key={p.id}
              onClick={openAdd}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openAdd(); }}
              className={`group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left transition hover:border-primary hover:shadow-md active:scale-[0.98] cursor-pointer ${
                p.is_favorite ? "border-yellow-400 ring-2 ring-yellow-300/60 shadow-md" : ""
              }`}
            >

              <button
                type="button"
                aria-label="Agregar con nota"
                onClick={(e) => {
                  e.stopPropagation();
                  setNoteText("");
                  setNoteQty(1);
                  if (p.modifier_group_ids && p.modifier_group_ids.length > 0) {
                    setModalProduct(p);
                  } else {
                    setNoteProduct(p);
                  }
                }}
                className="absolute left-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-primary shadow ring-1 ring-primary/20 hover:bg-primary hover:text-primary-foreground transition"
                title="Agregar con nota"
              >
                <StickyNote className="h-3.5 w-3.5" />
              </button>
              {p.is_favorite && (
                <span
                  aria-label="Producto destacado"
                  className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-white shadow ring-1 ring-white"
                >
                  <Star className="h-3 w-3 fill-white" strokeWidth={2.5} />
                </span>
              )}
              <div className="aspect-square w-full overflow-hidden bg-white p-1.5 flex items-center justify-center">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="max-h-[75%] max-w-[75%] object-contain transition group-hover:scale-105" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl font-display text-primary/40 bg-gradient-to-br from-secondary/30 to-accent/20 rounded-lg">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5">
                <div className="leading-tight line-clamp-2 text-[11px] sm:text-xs font-bold">{p.name}</div>
                <div className="mt-0.5 font-display text-sm sm:text-base text-primary tabular-nums font-bold">{formatMoney(p.price)}</div>
              </div>
            </div>
            );
          })}

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

          {pendingSaleId && canCancelSales && !meseroMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setCancelReason(""); setCancelDialogOpen(true); }}
              className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive font-semibold"
            >
              <XCircle className="h-4 w-4 mr-1.5" /> Cancelar pedido
            </Button>
          )}


          {typeof document !== "undefined" && createPortal(
            <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] backdrop-blur supports-[backdrop-filter]:bg-card/85">
              <div className="mx-auto max-w-7xl">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <ShoppingCart className="h-3.5 w-3.5" />
                    <span className="font-semibold text-foreground">Pedido</span>
                    <span>·</span>
                    {cart.reduce((a, l) => a + l.qty, 0)} items · Sub {formatMoney(subtotal)}
                  </span>
                  <span className="font-display text-lg text-primary tabular-nums leading-none">{formatMoney(total)}</span>
                </div>
                <div className={meseroMode ? "grid grid-cols-1 gap-2" : "grid grid-cols-3 gap-2"}>
                  <Button
                    size="sm"
                    disabled={paying || cart.length === 0}
                    onClick={saveComanda}
                    className="h-11 rounded-xl bg-gradient-to-b from-sky-400 to-sky-600 text-white font-extrabold uppercase tracking-wide text-xs border border-sky-300/50 shadow-[0_4px_0_0_hsl(210_90%_35%),0_8px_20px_-4px_hsl(210_90%_45%/0.5)] hover:from-sky-300 hover:to-sky-500 hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[0_1px_0_0_hsl(210_90%_35%)] transition-all duration-150 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none"
                  >
                    <Save className="h-4 w-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">Guardar</span>
                  </Button>
                  {!meseroMode && (
                    <>
                      <Button
                        size="sm"
                        disabled={cart.length === 0}
                        onClick={handlePrecuenta}
                        className="h-11 rounded-xl bg-gradient-to-b from-violet-400 to-violet-600 text-white font-extrabold uppercase tracking-wide text-xs border border-violet-300/50 shadow-[0_4px_0_0_hsl(270_70%_35%),0_8px_20px_-4px_hsl(270_70%_50%/0.5)] hover:from-violet-300 hover:to-violet-500 hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[0_1px_0_0_hsl(270_70%_35%)] transition-all duration-150 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none"
                      >
                        <Printer className="h-4 w-4 sm:mr-1.5" />
                        <span className="hidden sm:inline">Precuenta</span>
                      </Button>
                      <Button
                        size="sm"
                        disabled={paying || (cart.length === 0 && !pendingSaleId)}
                        onClick={() => setPayDialogOpen(true)}
                        className="h-11 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-600 text-white font-black uppercase tracking-wide text-sm border border-emerald-300/50 shadow-[0_4px_0_0_hsl(150_70%_25%),0_10px_25px_-4px_hsl(150_80%_40%/0.6)] hover:from-emerald-300 hover:to-emerald-500 hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[0_1px_0_0_hsl(150_70%_25%)] transition-all duration-150 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none"
                      >
                        <Banknote className="h-4 w-4 sm:mr-1.5" />
                        <span className="hidden sm:inline">Cobrar</span>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}




          <div className="max-h-[40vh] space-y-2 overflow-auto">
            {cart.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Toca un producto para agregarlo</p>
            )}
            {cart.map((l) => (
              <div key={l.key} className="space-y-1.5 rounded-lg bg-muted/50 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="font-medium text-sm whitespace-pre-line">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{formatMoney(l.unit_price)} c/u</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => dec(l.key)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-6 text-center text-sm">{l.qty}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setCart((p) => p.map((x) => x.key === l.key ? { ...x, qty: x.qty + 1 } : x))}><Plus className="h-3 w-3" /></Button>
                  </div>
                  <div className="w-20 text-right text-sm font-medium">{formatMoney(l.unit_price * l.qty)}</div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(l.key)}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <Input
                  value={l.notes ?? ""}
                  onChange={(e) => setCart((p) => p.map((x) => x.key === l.key ? { ...x, notes: e.target.value } : x))}
                  placeholder="📝 Nota (opcional): ej. sin azúcar, extra topping…"
                  className="h-8 text-xs bg-background/80"
                />
              </div>
            ))}

          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="space-y-1">
              <Input
                placeholder={orderType === "domicilio" ? "Nombre del cliente *" : "Nombre cliente (opcional)"}
                value={customer}
                onChange={(e) => { setCustomer(e.target.value); if (fieldErrors.customer) setFieldErrors({ ...fieldErrors, customer: false }); }}
                className={fieldErrors.customer ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {fieldErrors.customer && <p className="text-xs text-destructive">Este campo es obligatorio para envíos a domicilio</p>}
            </div>
            {orderType === "domicilio" && (
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
                <div className="space-y-1">
                  <Input
                    placeholder="Teléfono de contacto *"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value); if (fieldErrors.phone) setFieldErrors({ ...fieldErrors, phone: false }); }}
                    className={fieldErrors.phone ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                  {fieldErrors.phone && <p className="text-xs text-destructive">Este campo es obligatorio para envíos a domicilio</p>}
                </div>
              </>
            )}
            <div className="space-y-1.5 rounded-xl border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 shadow-sm">
              <label className="block text-sm font-bold text-foreground">
                📝 Notas adicionales del pedido
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas adicionales para el pedido (ej: Salsa aparte, sin cubiertos...)."
                rows={2}
                className="rounded-xl border-amber-300/70 bg-background/90 text-sm focus-visible:ring-amber-400"
              />
            </div>
          </div>

          <div className="space-y-1 border-t pt-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            {deliveryFee > 0 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Tarifa de Domicilio</span>
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
              <Save className="h-4 w-4 mr-1" /> {paying ? "Enviando…" : (meseroMode ? "Guardar y enviar a KDS" : "Guardar / KDS")}
            </Button>
          </div>

          {cart.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              onClick={async () => {
                const ticketNo = pendingSale?.ticket_number ?? kioskSale?.ticket_number ?? 0;
                const items = cart.map((l) => ({
                  name: l.name,
                  qty: l.qty,
                  modifiers: normalizeModifiers(l.modifiers),
                }));
                const snap = {
                  ticket: ticketNo,
                  header,
                  items,
                  customer,
                  notes,
                  address: orderType === "domicilio" ? address : "",
                  phone: orderType === "domicilio" ? phone : "",
                  user_name: profile?.full_name ?? user.email ?? "",
                  created_at: new Date().toISOString(),
                  branding,
                };
                const t = toast.loading("Reimprimiendo comanda…");
                const ok = await printComanda(snap);
                if (ok) toast.success("Comanda reimpresa", { id: t });
                else {
                  toast.warning("No se pudo reimprimir: revisa el servidor local de impresión", { id: t });
                }
              }}
            >
              <ChefHat className="h-4 w-4 mr-1" /> Reimprimir comanda
            </Button>
          )}



          {!meseroMode && (
            <div className="relative mt-3 overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-3 sm:p-4 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.25)]">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-white shadow-md">
                    <Banknote className="h-4 w-4" strokeWidth={2.5} />
                  </span>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-foreground/80">Medios de pago</div>
                    <div className="text-[10px] text-muted-foreground">
                      {!effectiveSessionId ? (
                        <span className="text-destructive font-semibold">Abre caja para cobrar</span>
                      ) : total <= 0 && !pendingSaleId ? (
                        <span>Agrega productos para activar</span>
                      ) : (
                        <span>Selecciona una opción para cerrar la venta</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="hidden sm:flex flex-col items-end">
                  <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Total</div>
                  <div className="font-display text-lg font-black leading-none text-primary tabular-nums">{formatMoney(total)}</div>
                </div>
              </div>

              {kioskSale?.payment_method &&
                !["pendiente", "mixto", ""].includes(String(kioskSale.payment_method).toLowerCase()) && (
                  <div className="mb-2.5 rounded-xl border border-amber-300/70 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs sm:text-sm text-amber-900 dark:text-amber-200 flex items-center gap-2">
                    <Smartphone className="h-4 w-4 shrink-0" />
                    <span>
                      El cliente eligió pagar con{" "}
                      <b className="uppercase">{kioskSale.payment_method}</b>. Confírmalo o
                      elige otro método si desea cambiar.
                    </span>
                  </div>
                )}

              <div className="grid grid-cols-2 gap-2.5">

                {methods.map((m: { id: string; name: string }) => {
                  const lower = m.name.toLowerCase();
                  const isCash = lower.includes("efectivo");
                  const isNequi = lower.includes("nequi");
                  const isBanco = lower.includes("bancolombia");
                  const hasOrder = total > 0 || !!pendingSaleId || cart.length > 0;
                  const isDisabled = paying || !hasOrder;

                  let style: React.CSSProperties = {
                    background: "linear-gradient(180deg, #e5e7eb 0%, #cbd5e1 100%)",
                    color: "#1f2937",
                    boxShadow:
                      "inset 0 2px 0 rgba(255,255,255,0.6), inset 0 -4px 0 rgba(0,0,0,0.15), 0 8px 18px -6px rgba(0,0,0,0.35)",
                    textShadow: "0 1px 0 rgba(255,255,255,0.4)",
                  };
                  let Icon: React.ComponentType<{ className?: string; strokeWidth?: number }> = Banknote;
                  if (isCash) {
                    Icon = Banknote;
                    style = {
                      background: "linear-gradient(180deg, #4ade80 0%, #16a34a 100%)",
                      color: "#ffffff",
                      boxShadow:
                        "inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -5px 0 rgba(0,0,0,0.22), 0 10px 22px -8px rgba(22,163,74,0.6)",
                      textShadow: "0 2px 2px rgba(0,0,0,0.25)",
                    };
                  } else if (isNequi) {
                    Icon = Smartphone;
                    style = {
                      background: "linear-gradient(180deg, #f0abfc 0%, #c026d3 100%)",
                      color: "#ffffff",
                      boxShadow:
                        "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -5px 0 rgba(0,0,0,0.2), 0 10px 22px -8px rgba(192,38,211,0.55)",
                      textShadow: "0 1px 2px rgba(0,0,0,0.25)",
                    };
                  } else if (isBanco) {
                    Icon = Building2;
                    style = {
                      background: "linear-gradient(180deg, #fde047 0%, #eab308 100%)",
                      color: "#1a1a1a",
                      boxShadow:
                        "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -5px 0 rgba(0,0,0,0.2), 0 10px 22px -8px rgba(202,138,4,0.55)",
                      textShadow: "0 1px 0 rgba(255,255,255,0.35)",
                    };
                  }

                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={isDisabled}
                      style={style}
                      onClick={() => {
                        try {
                          if (isDisabled) return;
                          if (isCash) {
                            setCashReceived("");
                            setCashDialogOpen(true);
                          } else {
                            void pay(m.name);
                          }
                        } catch (err) {
                          console.error("[pos] payment click error", err);
                          toast.error("No se pudo iniciar el cobro. Recarga la mesa e intenta de nuevo.");
                        }
                      }}
                      className={`group relative flex h-12 items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-sm font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${
                        kioskSale?.payment_method &&
                        kioskSale.payment_method.toLowerCase() === lower
                          ? "ring-4 ring-amber-400 ring-offset-2 ring-offset-background scale-[1.03] motion-safe:animate-pulse"
                          : ""
                      }`}
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/25">
                        <Icon className="h-3.5 w-3.5" strokeWidth={2.75} />
                      </span>
                      <span className="truncate">{m.name}</span>
                    </button>
                  );
                })}
                {methods.length === 0 && (
                  <div className="col-span-2 text-xs text-muted-foreground text-center py-2">
                    No hay métodos de pago configurados.
                  </div>
                )}
              </div>

              {/* Abonar / A Crédito */}
              <div className="mt-2.5">
                <CreditActionButtons
                  disabledCredit={paying || cart.length === 0}
                  onAbonar={() => setAbonoDialogOpen(true)}
                  onCredito={() => setCreditDialogOpen(true)}
                />
              </div>

              {/* Dividir cuenta */}
              <button
                type="button"
                disabled={paying || (total <= 0 && !pendingSaleId && cart.length === 0)}
                onClick={() => setSplitDialogOpen(true)}
                style={{
                  background: "linear-gradient(180deg, #a3e635 0%, #65a30d 100%)",
                  color: "#1a2e05",
                  boxShadow:
                    "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -5px 0 rgba(0,0,0,0.18), 0 10px 22px -8px rgba(101,163,13,0.55)",
                  textShadow: "0 1px 0 rgba(255,255,255,0.35)",
                }}
                className="group relative mt-2.5 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-sm font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/30">
                  <Users className="h-3.5 w-3.5" strokeWidth={2.75} />
                </span>
                <span>Dividir cuenta</span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/30">
                  <Split className="h-3.5 w-3.5" strokeWidth={2.75} />
                </span>
              </button>
            </div>
          )}

        </CardContent>
      </Card>

      <Dialog open={cashDialogOpen} onOpenChange={(open) => { if (!paying) setCashDialogOpen(open); }}>
        <DialogContent className="max-h-[92vh] sm:max-w-md p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="space-y-1 px-5 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-5 w-5 text-primary" /> Pago en efectivo
            </DialogTitle>
            <DialogDescription className="text-xs">Ingresa el monto recibido del cliente para calcular el cambio.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
            <div className="rounded-xl bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Total a cobrar</span><span className="font-display text-xl text-primary">{formatMoney(total)}</span></div>
            </div>

            {/* RECIBIDO — Premium hero display */}
            <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-primary/5 px-4 py-2.5 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.6)]">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground text-center">Recibido</div>
              <div
                key={cashReceived}
                className="flex items-baseline justify-center gap-1 font-display font-bold tabular-nums tracking-tight text-foreground animate-scale-in"
              >
                <span className="text-xl text-primary/70">$</span>
                <span className="text-3xl sm:text-4xl leading-none">
                  {cashReceived === "" ? "0" : Number(cashReceived).toLocaleString("es-CO")}
                </span>
              </div>
            </div>

            {/* DIGITE EL VALOR — big centered input */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground text-center mb-1">Digite el valor</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-3xl font-semibold text-muted-foreground">$</span>
                <Input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  className="h-20 rounded-xl border-2 text-center font-display text-5xl sm:text-6xl font-black tabular-nums tracking-wide shadow-inner transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/50"
                  value={cashReceived === "" ? "" : Number(cashReceived).toLocaleString("es-CO")}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setCashReceived(digits);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && Number(cashReceived) >= total && !paying) {
                      pay("Efectivo");
                      setCashDialogOpen(false);
                    }
                  }}
                />
              </div>
            </div>

            <CashPayPad
              total={total}
              cashReceived={cashReceived}
              onSetReceived={setCashReceived}
              disabled={paying}
            />

            {cashReceived !== "" && (
              <div className={`rounded-xl p-3 text-sm flex justify-between items-center transition-all duration-200 ${Number(cashReceived) < total ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                <span className="font-medium">Cambio</span>
                <span className="font-display text-2xl font-bold tabular-nums">{formatMoney(Math.max(0, Number(cashReceived) - total))}</span>
              </div>
            )}
            {cashReceived !== "" && Number(cashReceived) < total && (
              <div className="text-xs text-destructive text-center">Faltan {formatMoney(total - Number(cashReceived))}</div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t bg-background/95 backdrop-blur px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)]">
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

      <SplitBillDialog
        open={splitDialogOpen}
        onOpenChange={setSplitDialogOpen}
        total={total}
        paying={paying}
        lines={cart.map((l) => ({ key: l.key, name: l.name, unit_price: l.unit_price, qty: l.qty }))}
        onConfirm={async (splits: SplitPart[]) => {
          // Un solo cobro con payment_method="Mixto" y detalle en payment_details
          const primary = splits.reduce((a, b) => (b.amount > a.amount ? b : a), splits[0]);
          const label = splits.every((s) => s.method === primary.method) ? primary.method : "Mixto";
          await pay(label, {
            split: true,
            splits: splits.map((s) => ({ method: s.method, amount: s.amount, items: s.items ?? [] })),
          });
          setSplitDialogOpen(false);
        }}
      />


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
          <p className="text-center text-base font-medium">
            ¿Desea imprimir el ticket de venta?
          </p>
          <DialogFooter className="sm:justify-center gap-2">
            <Button
              variant="outline"
              className="font-bold"
              onClick={() => {
                const redirect = successDialog?.redirectTo ?? null;
                setSuccessDialog(null);
                if (redirect) navigate({ to: redirect });
              }}
            >
              No, Finalizar
            </Button>
            <Button
              className="font-bold"
              onClick={() => {
                const payload = successDialog?.printPayload;
                const redirect = successDialog?.redirectTo ?? null;
                setSuccessDialog(null);
                if (payload) {
                  // Dispara la impresión solo por servidor local silencioso.
                  // El POS no se queda bloqueado: redirige de inmediato al panel principal.
                  setTimeout(() => printTicketFinal(payload), 0);
                }
                if (redirect) setTimeout(() => navigate({ to: redirect }), 50);
              }}
            >
              <Printer className="h-4 w-4 mr-1" /> Sí, Imprimir
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      <ModifiersModal
        product={
          modalProduct
            ? {
                id: modalProduct.id,
                name: modalProduct.name,
                price: Number(modalProduct.price),
                modifier_group_ids: modalProduct.modifier_group_ids ?? [],
              }
            : null
        }
        onClose={() => setModalProduct(null)}
        onConfirm={(mods, unitExtra, note) => {
          if (modalProduct) addWithModifiers(modalProduct, mods, unitExtra, note);
          setModalProduct(null);
        }}
      />

      <Dialog open={!!noteProduct} onOpenChange={(o) => !o && setNoteProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <StickyNote className="h-5 w-5" /> {noteProduct?.name}
            </DialogTitle>
            <DialogDescription>Agrega una nota para este producto antes de enviarlo al carrito.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nota adicional</label>
              <Textarea
                autoFocus
                placeholder="Ej: sin azúcar, extra cremoso, con topping…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                maxLength={200}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium mr-2">Cantidad</label>
              <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setNoteQty((q) => Math.max(1, q - 1))}>
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center text-lg font-semibold">{noteQty}</span>
              <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setNoteQty((q) => q + 1)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteProduct(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (noteProduct) addWithNote(noteProduct, noteText, noteQty);
                setNoteProduct(null);
              }}
            >
              Agregar al carrito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sticky footer (móvil/tablet) — resumen + acciones siempre visibles */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                {cart.reduce((a, l) => a + l.qty, 0)} items · Sub {formatMoney(subtotal)}
              </span>
            </div>
            <div className="font-display text-2xl leading-tight text-primary tabular-nums">
              {formatMoney(total)}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={paying || cart.length === 0}
            onClick={saveComanda}
            className="h-11 shrink-0 border-primary text-primary"
          >
            <Save className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Guardar</span>
          </Button>
          {!meseroMode && (
            <Button
              size="sm"
              disabled={paying || (cart.length === 0 && !pendingSaleId)}
              onClick={() => setPayDialogOpen(true)}
              className="h-11 shrink-0 bg-gradient-primary px-4 font-bold"
            >
              <Banknote className="h-4 w-4 mr-1" /> Cobrar
            </Button>
          )}
        </div>
      </div>

      {/* Selector rápido de método de pago */}
      <Dialog open={payDialogOpen} onOpenChange={(o) => { if (!paying) setPayDialogOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-primary" /> Cobrar {formatMoney(total)}
            </DialogTitle>
            <DialogDescription>
              {cart.reduce((a, l) => a + l.qty, 0)} productos · Subtotal {formatMoney(subtotal)}
              {deliveryFee > 0 ? ` · Domicilio ${formatMoney(deliveryFee)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {!effectiveSessionId && (
            <div className="rounded-md border border-amber-400 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              Abre caja para poder cobrar.
            </div>
          )}
          <div className="flex flex-col gap-3 py-2">
            <button
              type="button"
              disabled={paying || (total <= 0 && !pendingSaleId && cart.length === 0)}
              onClick={() => {
                setPayDialogOpen(false);
                setSplitDialogOpen(true);
              }}
              style={{
                background: "linear-gradient(180deg, #a855f7 0%, #6d28d9 100%)",
                color: "#ffffff",
                boxShadow:
                  "inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -4px 0 rgba(0,0,0,0.25), 0 6px 14px -5px rgba(109,40,217,0.6)",
                textShadow: "0 1px 2px rgba(0,0,0,0.25)",
              }}
              className="group relative mx-auto flex h-10 w-auto max-w-full items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-sm font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
                <Users className="h-3 w-3" strokeWidth={2.5} />
              </span>
              <span className="min-w-0 truncate">Dividir cuenta</span>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
                <Split className="h-3 w-3" strokeWidth={2.5} />
              </span>
            </button>
            <CreditActionButtons
              disabledCredit={paying || cart.length === 0}
              onAbonar={() => { setPayDialogOpen(false); setAbonoDialogOpen(true); }}
              onCredito={() => { setPayDialogOpen(false); setCreditDialogOpen(true); }}
            />
            {methods.map((m: { id: string; name: string }) => {
              const lower = m.name.toLowerCase();
              const isCash = lower.includes("efectivo");
              const isNequi = lower.includes("nequi");
              const isBanco = lower.includes("bancolombia");
              const hasOrder = total > 0 || !!pendingSaleId || cart.length > 0;
              const isDisabled = paying || !hasOrder;

              // Estilos 3D tipo pill según método
              let style: React.CSSProperties = {
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
                  textShadow: "0 1px 0 rgba(255,255,255,0.55)",
                };
              } else if (isBanco) {
                style = {
                  background: "linear-gradient(180deg, #fde047 0%, #eab308 100%)",
                  color: "#1a1a1a",
                  boxShadow:
                    "inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -5px 0 rgba(0,0,0,0.2), 0 8px 18px -6px rgba(202,138,4,0.55)",
                  textShadow: "0 1px 0 rgba(255,255,255,0.35)",
                };
              }

              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={isDisabled}
                  style={style}
                  className="group relative flex h-20 w-full items-center justify-center gap-3 overflow-hidden rounded-full px-6 text-xl font-extrabold uppercase tracking-wide transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    try {
                      if (isDisabled) return;
                      setPayDialogOpen(false);
                      if (isCash) {
                        setCashReceived("");
                        setCashDialogOpen(true);
                      } else {
                        void pay(m.name);
                      }
                    } catch (err) {
                      console.error("[pos] payment click error", err);
                      toast.error("No se pudo iniciar el cobro.");
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
                  <span className="min-w-0 truncate">{m.name}</span>
                </button>
              );
            })}
            {methods.length === 0 && (
              <div className="py-3 text-center text-xs text-muted-foreground">
                No hay métodos de pago configurados.
              </div>
            )}



          </div>
        </DialogContent>
      </Dialog>

      <CreditSaleDialog
        open={creditDialogOpen}
        onOpenChange={setCreditDialogOpen}
        total={total}
        onConfirm={(c) => {
          setCreditDialogOpen(false);
          void pay("Crédito", { credit: true, customer_id: c.id, customer_name: c.name }, { id: c.id, name: c.name });
        }}
      />
      <CreditPaymentDialog
        open={abonoDialogOpen}
        onOpenChange={setAbonoDialogOpen}
        cashSessionId={effectiveSessionId ?? null}
        onPaid={() => { qc.invalidateQueries({ queryKey: ["credits"] }); }}
      />

      <Dialog open={cancelDialogOpen} onOpenChange={(o) => { if (!cancelling) setCancelDialogOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" /> Cancelar pedido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Esta acción marcará el pedido{pendingSale ? ` #${pendingSale.ticket_number}` : ""} como
              cancelado y liberará la mesa si corresponde. Queda registrada para auditoría.
            </p>
            <div>
              <Label className="text-xs font-semibold">
                Motivo de la cancelación <span className="text-destructive">*</span>
              </Label>
              <Textarea
                autoFocus
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ej.: El cliente cambió de opinión, error en la toma del pedido…"
                className="mt-1 min-h-[90px]"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={cancelling}
            >
              No cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={cancelling || cancelReason.trim().length < 3}
              onClick={async () => {
                if (!pendingSaleId) return;
                setCancelling(true);
                try {
                  // Los tipos generados aún no incluyen la nueva RPC.
                  const rpc = supabase.rpc as unknown as (
                    name: string,
                    args: Record<string, unknown>,
                  ) => Promise<{ data: unknown; error: { message: string } | null }>;
                  const { error } = await rpc("cancel_sale", {
                    _sale_id: pendingSaleId,
                    _reason: cancelReason.trim(),
                  });
                  if (error) throw new Error(error.message);
                  toast.success("Pedido cancelado");
                  setCancelDialogOpen(false);
                  setCancelReason("");
                  setPendingSaleId(null);
                  setCart([]);
                  qc.invalidateQueries({ queryKey: ["pending-sale"] });
                  qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
                  qc.invalidateQueries({ queryKey: ["sales"] });
                  qc.invalidateQueries({ queryKey: ["kds-pending"] });
                  navigate({ to: "/mesas" });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : "No se pudo cancelar";
                  toast.error(msg);
                } finally {
                  setCancelling(false);
                }
              }}
            >
              {cancelling ? "Cancelando…" : "Sí, cancelar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
