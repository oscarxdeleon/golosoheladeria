import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/format";
import { IdCard, MapPin, Phone, Calendar, User, CreditCard, Banknote, IceCream } from "lucide-react";
import logoAsset from "@/assets/logo-goloso.png.asset.json";

interface SaleLine { name: string; qty: number; unit_price: number; }

interface BusinessSettings {
  business_name: string;
  nit: string | null;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  ticket_header: string | null;
  ticket_footer: string | null;
}

function Dashed({ className = "" }: { className?: string }) {
  return <div className={`my-3 border-t border-dashed border-black ${className}`} />;
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

export function TicketPreview({
  sale,
}: {
  sale: {
    id: string;
    ticket_number: number;
    total: number;
    payment_method: string;
    customer: string;
    user_name: string;
    created_at: string;
    lines: { name: string; qty: number; unit_price: number }[];
    cash_received?: number;
    delivery_address?: string | null;
    delivery_phone?: string | null;
  };
}) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);

  useEffect(() => {
    supabase
      .from("settings")
      .select("business_name,nit,address,phone,logo_url,ticket_header,ticket_footer")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setSettings(data as unknown as BusinessSettings | null));
  }, []);

  const footerText = (settings?.ticket_footer ?? "¡Gracias por Preferirnos!").trim();
  const logoSrc = settings?.logo_url || logoAsset.url;

  const lines: SaleLine[] = sale.lines;
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const total = Number(sale.total) || subtotal;
  const received = sale.cash_received ?? total;
  const change = Math.max(0, received - total);
  const ticketNo = `TV-${String(sale.ticket_number).padStart(6, "0")}`;

  return (
    <div
      className="print-area mx-auto bg-white text-black px-5 py-6"
      style={{ maxWidth: 360, fontFamily: '"Helvetica Neue", Arial, sans-serif', lineHeight: 1.4 }}
    >
      {/* Logo a color */}
      <div className="flex justify-center mb-1">
        <img
          src={logoSrc}
          alt={settings?.business_name ?? "Logo"}
          className="ticket-logo w-44 h-auto object-contain"
        />
      </div>

      {/* Nombre */}
      <h1
        className="text-center font-black text-2xl tracking-tight leading-tight mt-2 mb-3 uppercase"
        style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
      >
        {(settings?.business_name ?? "HELADERIA GOLOSO").toUpperCase()}
      </h1>

      {/* Contacto centrado con iconos */}
      <div className="flex flex-col items-center gap-1.5 text-[13px]">
        <div className="flex items-center gap-2"><IdCard className="h-4 w-4 shrink-0" strokeWidth={2.5} /><span>NIT: {settings?.nit ?? "—"}</span></div>
        <div className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" strokeWidth={2.5} /><span>{settings?.address ?? ""}</span></div>
        <div className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0" strokeWidth={2.5} /><span>{settings?.phone ?? ""}</span></div>
      </div>

      <Dashed />

      {/* Título del documento */}
      <div
        className="text-center font-black text-[15px] uppercase tracking-wide"
        style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
      >
        TICKET DE VENTA <span className="font-black">No. {ticketNo}</span>
      </div>

      <Dashed />

      {/* Datos del pedido */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <div className="flex items-center gap-1.5 font-black whitespace-nowrap">
          <Calendar className="h-4 w-4" strokeWidth={2.5} /> Fecha:
        </div>
        <div>{formatTicketDate(sale.created_at)}</div>

        <div className="flex items-center gap-1.5 font-black whitespace-nowrap">
          <User className="h-4 w-4" strokeWidth={2.5} /> Cliente:
        </div>
        <div>{sale.customer || "Mostrador"}</div>

        {sale.delivery_address && (
          <>
            <div className="flex items-center gap-1.5 font-black whitespace-nowrap">
              <MapPin className="h-4 w-4" strokeWidth={2.5} /> Dirección:
            </div>
            <div>{sale.delivery_address}</div>
          </>
        )}

        {sale.delivery_phone && (
          <>
            <div className="flex items-center gap-1.5 font-black whitespace-nowrap">
              <Phone className="h-4 w-4" strokeWidth={2.5} /> Teléfono:
            </div>
            <div>{sale.delivery_phone}</div>
          </>
        )}

        <div className="flex items-center gap-1.5 font-black whitespace-nowrap">
          <CreditCard className="h-4 w-4" strokeWidth={2.5} /> Forma de Pago:
        </div>
        <div>{sale.payment_method}</div>
      </div>

      {/* Tabla con bordes sólidos */}
      <table className="w-full mt-4 border-collapse">
        <thead>
          <tr
            className="border-y-2 border-black text-[11px] uppercase"
            style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
          >
            <th className="text-left py-1.5 w-[20%]">CANTIDAD</th>
            <th className="text-left py-1.5 pl-1">DETALLE</th>
            <th className="text-right py-1.5 w-[28%]">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="py-1.5 text-left">{l.qty}</td>
              <td className="py-1.5 pl-1 uppercase whitespace-pre-line">{l.name}</td>
              <td className="py-1.5 text-right whitespace-nowrap">
                {formatMoney(l.unit_price * l.qty)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Subtotal */}
      <div className="flex justify-end gap-3 text-[13px] pt-2 border-t border-dashed border-black mt-1">
        <span className="uppercase tracking-wide font-bold">Subtotal:</span>
        <span>{formatMoney(subtotal)}</span>
      </div>

      {/* TOTAL grande */}
      <div className="flex justify-between items-baseline mt-2">
        <span
          className="font-black text-2xl tracking-tight"
          style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
        >
          TOTAL:
        </span>
        <span
          className="font-black text-3xl"
          style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
        >
          {formatMoney(total)}
        </span>
      </div>

      {/* Recibido / Cambio */}
      <div className="flex items-center justify-between text-[13px] mt-3 py-2 border-y border-dashed border-black">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5" strokeWidth={2.5} />
          <span className="font-black">Recibido:</span>
          <span>{formatMoney(received)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-black">Cambio:</span>
          <span>{formatMoney(change)}</span>
        </div>
      </div>

      {/* Pie de página decorativo */}
      <div className="mt-4 flex items-center justify-center gap-3">
        <IceCream className="h-9 w-9 text-pink-500" />
        <div
          className="text-center font-bold italic text-xl whitespace-pre-line leading-tight"
          style={{ fontFamily: '"Brush Script MT", "Lucida Handwriting", cursive' }}
        >
          {footerText}
        </div>
        <IceCream className="h-9 w-9 text-pink-500" />
      </div>

      <div className="mt-3 text-center tracking-[0.5em] text-xs select-none">
        ♥ · 🍦 · ♥ · 🍧 · ♥ · 🍦 · ♥
      </div>
    </div>
  );
}
