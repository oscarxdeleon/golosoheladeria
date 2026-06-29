import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/format";
import { IdCard, MapPin, Phone, Calendar, User, CreditCard, Banknote, Heart, IceCream, IceCream2 } from "lucide-react";
import logoAsset from "@/assets/logo-goloso.png.asset.json";

interface SaleLine { name: string; qty: number; unit_price: number; }

interface BusinessSettings {
  business_name: string;
  nit: string | null;
  address: string | null;
  phone: string | null;
}

function Dashed() {
  return <div className="my-3 border-t-2 border-dashed border-black" />;
}

function formatTicketDate(iso: string) {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${date}   ${h.toString().padStart(2, "0")}:${m}:${s} ${ampm}`;
}

export function TicketPreview({ sale }: { sale: { id: string; ticket_number: number; total: number; payment_method: string; customer: string; user_name: string; created_at: string; lines: { name: string; qty: number; unit_price: number }[]; cash_received?: number } }) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);

  useEffect(() => {
    supabase
      .from("settings")
      .select("business_name,nit,address,phone")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setSettings(data as BusinessSettings | null));
  }, []);

  const lines: SaleLine[] = sale.lines;
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const total = Number(sale.total) || subtotal;
  const received = sale.cash_received ?? total;
  const change = Math.max(0, received - total);
  const ticketNo = `TV-${String(sale.ticket_number).padStart(6, "0")}`;

  return (
    <div
      className="print-area mx-auto bg-white text-black px-5 py-6"
      style={{ maxWidth: 360, fontFamily: '"Courier New", ui-monospace, monospace' }}
    >
      {/* Logo */}
      <div className="flex justify-center mb-2">
        <img src={logoAsset.url} alt="Heladería Goloso" className="w-48 h-auto" />
      </div>

      {/* Business name */}
      <h1 className="text-center font-black text-2xl tracking-tight leading-tight mb-3" style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}>
        {(settings?.business_name ?? "HELADERIA GOLOSO").toUpperCase()}
      </h1>

      {/* Contact */}
      <div className="space-y-1.5 text-[15px] flex flex-col items-center">
        <div className="flex items-center gap-2"><IdCard className="h-4 w-4 shrink-0" /><span>NIT: {settings?.nit ?? "123456789-0"}</span></div>
        <div className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" /><span>{settings?.address ?? "Calle 6 # 10-46"}</span></div>
        <div className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0" /><span>{settings?.phone ?? "311 448 6300"}</span></div>
      </div>

      <Dashed />

      {/* Ticket title */}
      <div className="text-center font-black text-lg tracking-tight" style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}>
        TICKET DE VENTA <span className="font-bold">No. {ticketNo}</span>
      </div>

      <Dashed />

      {/* Details */}
      <div className="space-y-2 text-[14px]">
        <div className="flex items-start gap-2"><Calendar className="h-4 w-4 mt-0.5 shrink-0" /><span className="font-bold w-24">Fecha:</span><span>{formatTicketDate(sale.created_at)}</span></div>
        <div className="flex items-start gap-2"><User className="h-4 w-4 mt-0.5 shrink-0" /><span className="font-bold w-24">Cliente:</span><span>{sale.customer || "Mostrador"}</span></div>
        <div className="flex items-start gap-2"><MapPin className="h-4 w-4 mt-0.5 shrink-0" /><span className="font-bold w-24">Dirección:</span><span>{settings?.address ?? "Calle 6 # 10-46"}</span></div>
        <div className="flex items-start gap-2"><Phone className="h-4 w-4 mt-0.5 shrink-0" /><span className="font-bold w-24">Teléfono:</span><span>{settings?.phone ?? "311 448 6300"}</span></div>
        <div className="flex items-start gap-2"><CreditCard className="h-4 w-4 mt-0.5 shrink-0" /><span className="font-bold w-24">Forma de Pago:</span><span>{sale.payment_method}</span></div>
      </div>

      <Dashed />

      {/* Items table */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 text-[13px] font-black" style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}>
        <div>CANTIDAD</div>
        <div className="text-center">DETALLE</div>
        <div className="text-right">TOTAL</div>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-[13px] mt-2">
        {lines.map((l, i) => (
          <div key={i} className="contents">
            <div className="text-center">{l.qty}</div>
            <div className="uppercase">{l.name}</div>
            <div className="text-right">{formatMoney(l.unit_price * l.qty)}</div>
          </div>
        ))}
      </div>

      <Dashed />

      {/* Totals */}
      <div className="flex justify-between text-[14px]">
        <span></span>
        <div className="flex gap-6"><span className="font-bold">SUBTOTAL:</span><span>{formatMoney(subtotal)}</span></div>
      </div>
      <div className="flex justify-between items-baseline mt-2">
        <span className="font-black text-2xl" style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}>TOTAL:</span>
        <span className="font-black text-3xl" style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}>{formatMoney(total)}</span>
      </div>

      <Dashed />

      {/* Payment */}
      <div className="flex items-center justify-between text-[13px]">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5" />
          <span className="font-bold">Recibido:</span>
          <span>{formatMoney(received)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold">Cambio:</span>
          <span>{formatMoney(change)}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between gap-2">
        <IceCream className="h-10 w-10 text-pink-500" />
        <div className="text-center font-bold italic text-lg" style={{ fontFamily: '"Brush Script MT", "Lucida Handwriting", cursive' }}>
          ¡Gracias por Preferirnos!
        </div>
        <IceCream className="h-10 w-10 text-pink-500" />
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 text-black">
        <Heart className="h-3 w-3 fill-current" />
        <span>·</span>
        <IceCream2 className="h-4 w-4" />
        <span>·</span>
        <Heart className="h-3 w-3 fill-current" />
        <span>·</span>
        <IceCream className="h-4 w-4" />
        <span>·</span>
        <Heart className="h-3 w-3 fill-current" />
        <span>·</span>
        <IceCream2 className="h-4 w-4" />
        <span>·</span>
        <Heart className="h-3 w-3 fill-current" />
      </div>
    </div>
  );
}
