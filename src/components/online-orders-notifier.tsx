import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

export function OnlineOrdersNotifier() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const channel = supabase
      .channel("sales-online-orders")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sales", filter: "source=eq.online_menu" },
        (payload) => {
          const row = payload.new as { id: string; ticket_number: number; customer_name: string | null; total: number };
          if (seen.current.has(row.id)) return;
          seen.current.add(row.id);
          beep();
          toast.success(`Nuevo pedido en línea #${row.ticket_number}`, {
            description: `${row.customer_name ?? "Cliente"} · $${Math.round(Number(row.total ?? 0)).toLocaleString("es-CO")}`,
            duration: 10000,
            action: {
              label: "Ver",
              onClick: () => navigate({ to: "/pedidos-online" }),
            },
          });
          qc.invalidateQueries({ queryKey: ["online-orders"] });
          qc.invalidateQueries({ queryKey: ["pending-sales"] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [navigate, qc]);

  return null;
}
