import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sendToLocalPrinter } from "@/lib/print-client";

function beep(times = 1) {
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new AC();
    for (let i = 0; i < times; i++) {
      const start = ctx.currentTime + i * 0.35;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "square"; o.frequency.value = 1040;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      o.start(start); o.stop(start + 0.3);
    }
    setTimeout(() => ctx.close(), 1500 + times * 350);
  } catch { /* noop */ }
}

type IncomingSale = {
  id: string;
  ticket_number: number;
  customer_name: string | null;
  total: number;
  subtotal: number | null;
  delivery_fee: number | null;
  notes: string | null;
  source: string;
};

async function autoPrintKioskOrder(saleId: string) {
  // Cargar venta + items. El comprobante y la comanda se envían a la MISMA
  // impresora por defecto del POS (sin override de IP).
  const [{ data: sale }, { data: items }] = await Promise.all([
    supabase.from("sales").select("ticket_number, subtotal, total, delivery_fee, customer_name, notes, created_at").eq("id", saleId).maybeSingle(),
    supabase.from("sale_items").select("product_name, qty, unit_price").eq("sale_id", saleId),
  ]);
  if (!sale || !items?.length) return;

  const printItems = items.map((i) => ({ name: i.product_name, qty: Number(i.qty), unit_price: Number(i.unit_price) }));

  // 1) Comanda silenciosa a la cocina (impresora por defecto del servidor)
  void sendToLocalPrinter({
    type: "comanda",
    ticket: sale.ticket_number,
    header: "PEDIDO KIOSKO",
    items: printItems,
    customer: sale.customer_name ?? undefined,
    notes: sale.notes ?? undefined,
    created_at: sale.created_at ?? undefined,
  });

  // 2) Comprobante de pago — MISMA impresora del POS (sin printer_ip)
  void sendToLocalPrinter({
    type: "comprobante",
    ticket: sale.ticket_number,
    header: "COMPROBANTE DE PEDIDO",
    items: printItems,
    subtotal: Number(sale.subtotal ?? 0),
    deliveryFee: Number(sale.delivery_fee ?? 0),
    total: Number(sale.total ?? 0),
    customer: sale.customer_name ?? undefined,
    created_at: sale.created_at ?? undefined,
    cashierMessage: "Conserve este comprobante.\nGracias por su compra.",
  });
}

export function OnlineOrdersNotifier() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const handler = (payload: { new: IncomingSale }) => {
      const row = payload.new;
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);

      const isKiosk = row.source === "kiosk";
      // Kiosko: triple beep para que el cajero lo escuche con claridad
      beep(isKiosk ? 3 : 1);

      const title = isKiosk
        ? `🛎️ ¡NUEVO PEDIDO DESDE EL KIOSKO! #${row.ticket_number}`
        : `¡Nuevo pedido recibido! #${row.ticket_number}`;

      toast.success(title, {
        description: `${row.customer_name ?? (isKiosk ? "Kiosko" : "Cliente")} · $${Math.round(Number(row.total ?? 0)).toLocaleString("es-CO")}`,
        duration: Infinity,
        className: isKiosk ? "border-2 border-primary shadow-2xl" : undefined,
        action: {
          label: isKiosk ? "Ver Kiosko" : "Ver y confirmar",
          onClick: () => navigate({ to: isKiosk ? "/kiosko" : "/pedidos-online" }),
        },
      });

      // En kiosko: disparo automático y silencioso de las dos impresiones
      if (isKiosk) void autoPrintKioskOrder(row.id);

      qc.invalidateQueries({ queryKey: ["online-orders"] });
      qc.invalidateQueries({ queryKey: ["pending-sales"] });
      qc.invalidateQueries({ queryKey: ["kiosk-orders"] });
    };

    const channel = supabase.channel("sales-public-orders");
    channel
      .on(
        "postgres_changes" as never,
        { event: "INSERT", schema: "public", table: "sales", filter: "source=eq.online_menu" } as never,
        handler as never,
      )
      .on(
        "postgres_changes" as never,
        { event: "INSERT", schema: "public", table: "sales", filter: "source=eq.kiosk" } as never,
        handler as never,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [navigate, qc]);

  return null;
}
