import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";

interface SaleLine { name: string; qty: number; unit_price: number; }
interface Sale { id: string; ticket_number: number; total: number; payment_method: string; customer: string; user_name: string; created_at: string; lines: SaleLine[]; }

interface BusinessSettings {
  business_name: string;
  nit: string | null;
  address: string | null;
  phone: string | null;
}

export function TicketPreview({ sale }: { sale: { id: string; ticket_number: number; total: number; payment_method: string; customer: string; user_name: string; created_at: string; lines: { name: string; qty: number; unit_price: number }[] } }) {
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

  return (
    <div className="print-area font-mono text-xs leading-relaxed">
      <div className="text-center">
        <div className="font-bold text-sm">{settings?.business_name ?? "Heladería Goloso"}</div>
        {settings?.nit && <div>NIT {settings.nit}</div>}
        {settings?.address && <div>{settings.address}</div>}
        {settings?.phone && <div>Tel. {settings.phone}</div>}
      </div>
      <div className="my-2 border-t border-dashed border-foreground" />
      <div className="flex justify-between">
        <span>Ticket #{sale.ticket_number}</span>
        <span>{formatDate(sale.created_at)}</span>
      </div>
      <div>Cajero: {sale.user_name}</div>
      {sale.customer && <div>Cliente: {sale.customer}</div>}
      <div className="my-2 border-t border-dashed border-foreground" />
      {lines.map((l, i) => (
        <div key={i} className="flex justify-between">
          <span className="truncate pr-2">{l.qty} × {l.name}</span>
          <span>{formatMoney(l.unit_price * l.qty)}</span>
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-foreground" />
      <div className="flex justify-between font-bold text-sm">
        <span>TOTAL</span>
        <span>{formatMoney(sale.total)}</span>
      </div>
      <div className="flex justify-between mt-1">
        <span>Pago</span>
        <span>{sale.payment_method}</span>
      </div>
      <div className="mt-3 text-center">¡Gracias por tu compra!</div>
    </div>
  );
}
