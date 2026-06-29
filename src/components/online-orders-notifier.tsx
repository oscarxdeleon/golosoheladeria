import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sendToLocalPrinter } from "@/lib/print-client";

function beep() {
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.55);
    setTimeout(() => ctx.close(), 800);
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
  // Cargar items + datos de impresora de caja desde la base
  const [{ data: sale }, { data: items }, { data: settings }] = await Promise.all([
    supabase.from("sales").select("ticket_number, subtotal, total, delivery_fee, customer_name, notes, created_at").eq("id", saleId).maybeSingle(),
    supabase.from("sale_items").select("product_name, qty, unit_price").eq("sale_id", saleId),
    supabase.from("settings").select("cashier_printer_ip, cashier_printer_port, business_name").maybeSingle(),
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

  // 2) Comprobante de pago al cliente — segunda impresora de caja por IP
  const s = settings as { cashier_printer_ip?: string | null; cashier_printer_port?: number | null } | null;
  if (s?.cashier_printer_ip) {
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
      printer_ip: s.cashier_printer_ip,
      printer_port: Number(s.cashier_printer_port ?? 9100),
      cashierMessage: "Conserve este comprobante.\nGracias por su compra.",
    });
  }
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
      beep();

      const isKiosk = row.source === "kiosk";
      const title = isKiosk
        ? `¡Nuevo Pedido desde el Kiosko! #${row.ticket_number}`
        : `¡Nuevo pedido recibido! #${row.ticket_number}`;

      toast.success(title, {
        description: `${row.customer_name ?? (isKiosk ? "Kiosko" : "Cliente")} · $${Math.round(Number(row.total ?? 0)).toLocaleString("es-CO")}`,
        duration: Infinity,
        action: {
          label: isKiosk ? "Ver pedidos" : "Ver y confirmar",
          onClick: () => navigate({ to: "/pedidos-online" }),
        },
      });

      // En kiosko: disparo automático y silencioso de las dos impresiones
      if (isKiosk) void autoPrintKioskOrder(row.id);

      qc.invalidateQueries({ queryKey: ["online-orders"] });
      qc.invalidateQueries({ queryKey: ["pending-sales"] });
      qc.invalidateQueries({ queryKey: ["kiosk-orders"] });
    };

    const channel = supabase
      .channel("sales-public-orders")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "sales", filter: "source=eq.online_menu" },
        handler as unknown as Parameters<typeof channel.on>[2])
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "sales", filter: "source=eq.kiosk" },
        handler as unknown as Parameters<typeof channel.on>[2])
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [navigate, qc]);

  return null;
}
