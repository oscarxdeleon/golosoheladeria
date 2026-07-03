import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/format";
import { IdCard, MapPin, Phone, Calendar, User, CreditCard, Banknote } from "lucide-react";
import logoUrl from "@/assets/logo-goloso.png";

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
  const logoSrc = settings?.logo_url || logoUrl;

  const lines: SaleLine[] = sale.lines;
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const total = Number(sale.total) || subtotal;
  const received = sale.cash_received ?? total;
  const change = Math.max(0, received - total);
  const ticketNo = `TV-${String(sale.ticket_number).padStart(6, "0")}`;

  return (
    <div
      className="print-area mx-auto bg-white text-black px-5 py-6 print:p-0 print:m-0"
      style={{ maxWidth: 360, fontFamily: '"Helvetica Neue", Arial, sans-serif', lineHeight: 1.35 }}
    >
      {/* Logo centrado */}
      <div className="flex justify-center mb-1">
        <img
          src={logoSrc}
          alt={settings?.business_name ?? "Logo"}
          className="ticket-logo mx-auto block w-48 max-w-[180px] h-auto object-contain"
        />
      </div>

      {/* Nombre */}
      <h1
        className="text-center font-extrabold text-2xl tracking-wide leading-tight mt-1 mb-3 uppercase"
        style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
      >
        {(settings?.business_name ?? "HELADERIA GOLOSO").toUpperCase()}
      </h1>

      {/* Contacto con iconos */}
      <div className="flex flex-col items-start gap-1.5 text-[14px] pl-10">
        <div className="flex items-center gap-2"><IdCard className="h-4 w-4 shrink-0" strokeWidth={2.5} /><span>NIT: {settings?.nit ?? "—"}</span></div>
        <div className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" strokeWidth={2.5} /><span>{settings?.address ?? ""}</span></div>
        <div className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0" strokeWidth={2.5} /><span>{settings?.phone ?? ""}</span></div>
      </div>

      <Dashed />

      <div
        className="text-center font-black text-[16px] uppercase tracking-wide"
        style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
      >
        TICKET DE VENTA <span className="font-black normal-case">No. {ticketNo}</span>
      </div>

      <Dashed />

      {/* Metadatos */}
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
        <div className="flex items-center gap-1.5 font-bold whitespace-nowrap">
          <Calendar className="h-4 w-4" strokeWidth={2.5} /> Fecha:
        </div>
        <div>{formatTicketDate(sale.created_at)}</div>

        <div className="flex items-center gap-1.5 font-bold whitespace-nowrap">
          <User className="h-4 w-4" strokeWidth={2.5} /> Cliente:
        </div>
        <div>{sale.customer || "Mostrador"}</div>

        {sale.delivery_address && (
          <>
            <div className="flex items-center gap-1.5 font-bold whitespace-nowrap">
              <MapPin className="h-4 w-4" strokeWidth={2.5} /> Dirección:
            </div>
            <div>{sale.delivery_address}</div>
          </>
        )}

        {sale.delivery_phone && (
          <>
            <div className="flex items-center gap-1.5 font-bold whitespace-nowrap">
              <Phone className="h-4 w-4" strokeWidth={2.5} /> Teléfono:
            </div>
            <div>{sale.delivery_phone}</div>
          </>
        )}

        <div className="flex items-center gap-1.5 font-bold whitespace-nowrap">
          <CreditCard className="h-4 w-4" strokeWidth={2.5} /> Forma de Pago:
        </div>
        <div>{sale.payment_method}</div>
      </div>

      <Dashed />

      {/* Tabla productos */}
      <table className="w-full border-collapse">
        <thead>
          <tr
            className="text-[11px] uppercase"
            style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
          >
            <th className="text-left py-1.5 w-[22%]">CANTIDAD</th>
            <th className="text-center py-1.5">DETALLE</th>
            <th className="text-right py-1.5 w-[28%]">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="py-1.5 text-left">{l.qty}</td>
              <td className="py-1.5 text-center uppercase whitespace-pre-line">{l.name}</td>
              <td className="py-1.5 text-right whitespace-nowrap">
                {formatMoney(l.unit_price * l.qty)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-dashed border-black my-2" />

      {/* Subtotal */}
      <div className="flex justify-end gap-4 text-[13px] pt-1">
        <span className="uppercase tracking-wide font-bold">SUBTOTAL:</span>
        <span>{formatMoney(subtotal)}</span>
      </div>

      {/* TOTAL gigante sin fondo */}
      <div className="flex justify-between items-baseline mt-1 mb-2">
        <span
          className="font-black text-3xl tracking-tight"
          style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
        >
          TOTAL:
        </span>
        <span
          className="font-black text-4xl"
          style={{ fontFamily: '"Arial Black", system-ui, sans-serif' }}
        >
          {formatMoney(total)}
        </span>
      </div>

      <Dashed />

      {/* Recibido / Cambio */}
      <div className="flex items-center justify-between text-[13px] py-1">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5" strokeWidth={2.5} />
          <span className="font-bold">Recibido:</span>
          <span>{formatMoney(received)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-bold">Cambio:</span>
          <span>{formatMoney(change)}</span>
        </div>
      </div>

      <Dashed />

      {/* Pie estético */}
      <div className="mt-2 flex items-center justify-center gap-3">
        <span className="text-3xl leading-none">🍨</span>
        <div
          className="text-center font-bold italic text-2xl whitespace-pre-line leading-tight"
          style={{ fontFamily: '"Brush Script MT", "Lucida Handwriting", cursive' }}
        >
          {footerText}
        </div>
        <span className="text-3xl leading-none">🍨</span>
      </div>

      <div className="mt-3 text-center tracking-[0.4em] text-xs select-none">
        ♥ · 🍦 · ♥ · 🍧 · ♥ · 🍦 · ♥
      </div>
    </div>
  );
}
