import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendToLocalPrinter } from "@/lib/print-client";
import { useBranch } from "@/contexts/branch-context";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, X } from "lucide-react";

/* ---------- Audio: bucle continuo hasta que el cajero lo detenga ---------- */
function useAlertLoop() {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function playOnce() {
    try {
      let ctx = ctxRef.current;
      if (!ctx) {
        const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        ctx = new AC();
        ctxRef.current = ctx;
      }
      // Triple tono ascendente para que se escuche con ruido de fondo
      const freqs = [880, 1180, 1480];
      freqs.forEach((f, i) => {
        const start = ctx!.currentTime + i * 0.18;
        const o = ctx!.createOscillator();
        const g = ctx!.createGain();
        o.connect(g); g.connect(ctx!.destination);
        o.type = "square"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.45, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        o.start(start); o.stop(start + 0.18);
      });
    } catch { /* noop */ }
  }

  const start = useCallback(() => {
    if (intervalRef.current) return;
    playOnce();
    intervalRef.current = setInterval(playOnce, 2500);
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    try { ctxRef.current?.close(); } catch { /* noop */ }
    ctxRef.current = null;
  }, []);

  return { start, stop };
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
  branch_id: string | null;
};

async function autoPrintKioskOrder(saleId: string) {
  const [{ data: sale }, { data: items }] = await Promise.all([
    supabase.from("sales").select("ticket_number, subtotal, total, delivery_fee, customer_name, notes, created_at").eq("id", saleId).maybeSingle(),
    supabase.from("sale_items").select("product_name, qty, unit_price").eq("sale_id", saleId),
  ]);
  if (!sale || !items?.length) return;
  const printItems = items.map((i) => ({ name: i.product_name, qty: Number(i.qty), unit_price: Number(i.unit_price) }));

  void sendToLocalPrinter({
    type: "comanda",
    ticket: sale.ticket_number,
    header: "PEDIDO KIOSKO",
    items: printItems,
    customer: sale.customer_name ?? undefined,
    notes: sale.notes ?? undefined,
    created_at: sale.created_at ?? undefined,
  });

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

type PendingAlert = {
  id: string;
  ticket: number;
  source: string;
  total: number;
  customer: string | null;
};

export function OnlineOrdersNotifier() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const seen = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAlert[]>([]);
  const { start, stop } = useAlertLoop();

  // Detener bucle cuando ya no hay alertas pendientes
  useEffect(() => {
    if (pending.length === 0) stop();
  }, [pending.length, stop]);

  function dismissAll() {
    setPending([]);
    stop();
  }

  function confirmAndNavigate(source: string) {
    setPending([]);
    stop();
    navigate({ to: source === "kiosk" ? "/kiosko" : "/pedidos-online" });
  }

  useEffect(() => {
    if (!activeBranchId) return;
    const handler = (payload: { new: IncomingSale }) => {
      const row = payload.new;
      if (seen.current.has(row.id)) return;
      // Filtro estricto por sede activa — pedidos de otra sucursal no alertan acá
      if (row.branch_id !== activeBranchId) return;
      seen.current.add(row.id);

      setPending((arr) => [
        ...arr,
        {
          id: row.id,
          ticket: row.ticket_number,
          source: row.source,
          total: Number(row.total ?? 0),
          customer: row.customer_name,
        },
      ]);
      start();

      if (row.source === "kiosk") void autoPrintKioskOrder(row.id);

      qc.invalidateQueries({ queryKey: ["online-orders", activeBranchId] });
      qc.invalidateQueries({ queryKey: ["pending-sales"] });
      qc.invalidateQueries({ queryKey: ["kiosk-orders"] });
    };

    const channel = supabase.channel(`sales-public-orders-${activeBranchId}`);
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
  }, [navigate, qc, activeBranchId, start]);

  if (pending.length === 0) return null;

  const last = pending[pending.length - 1];
  const isKiosk = last.source === "kiosk";

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-[min(94vw,420px)] animate-in slide-in-from-bottom-6 duration-300">
      <div className={`rounded-2xl border-4 ${isKiosk ? "border-primary" : "border-secondary"} bg-background shadow-2xl overflow-hidden`}>
        <div className={`flex items-center gap-3 px-4 py-3 ${isKiosk ? "bg-primary/15" : "bg-secondary/15"}`}>
          <div className={`relative ${isKiosk ? "text-primary" : "text-secondary-foreground"}`}>
            <Bell className="h-7 w-7 animate-bounce" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
            </span>
          </div>
          <div className="flex-1 font-display text-lg leading-tight">
            {isKiosk ? "¡NUEVO PEDIDO KIOSKO!" : "¡NUEVO PEDIDO EN LÍNEA!"}
            {pending.length > 1 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-sm h-6 min-w-6 px-2">
                {pending.length}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={dismissAll}
            className="rounded-full p-1 hover:bg-muted text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[40vh] overflow-y-auto divide-y">
          {pending.slice().reverse().slice(0, 5).map((p) => (
            <div key={p.id} className="px-4 py-2 flex items-center gap-3">
              <div className="font-display text-xl text-primary">#{p.ticket}</div>
              <div className="flex-1 leading-tight">
                <div className="text-sm font-medium truncate">{p.customer ?? (p.source === "kiosk" ? "Kiosko" : "Cliente")}</div>
                <div className="text-xs text-muted-foreground">{p.source === "kiosk" ? "Auto-pedido" : "Menú en línea"}</div>
              </div>
              <div className="font-mono text-sm">${Math.round(p.total).toLocaleString("es-CO")}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40">
          <Button variant="outline" onClick={dismissAll} className="gap-2">
            <BellOff className="h-4 w-4" /> Detener alerta
          </Button>
          <Button onClick={() => confirmAndNavigate(last.source)} className="gap-2">
            Confirmar pedido
          </Button>
        </div>
      </div>
    </div>
  );
}
