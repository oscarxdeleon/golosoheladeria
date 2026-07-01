import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { Button } from "@/components/ui/button";
import { BellRing, Check, X } from "lucide-react";
import { toast } from "sonner";

type WaiterCall = {
  id: string;
  branch_id: string | null;
  table_id: string | null;
  table_number: number | null;
  table_label: string | null;
  status: string;
  reason: string | null;
  created_at: string;
};

function useAlertLoop() {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function ensureCtx() {
    let ctx = ctxRef.current;
    if (!ctx) {
      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      ctx = new AC();
      ctxRef.current = ctx;
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  }
  function playOnce() {
    try {
      const ctx = ensureCtx();
      // Tono de "campanilla" distinto al de pedidos
      const freqs = [1320, 1760, 1320, 1760];
      freqs.forEach((f, i) => {
        const start = ctx.currentTime + i * 0.14;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
        o.start(start); o.stop(start + 0.14);
      });
    } catch { /* noop */ }
  }
  const start = useCallback(() => {
    if (intervalRef.current) return;
    playOnce();
    intervalRef.current = setInterval(playOnce, 2200);
  }, []);
  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);
  useEffect(() => {
    const unlock = () => {
      try {
        const ctx = ensureCtx();
        const o = ctx.createOscillator(); const g = ctx.createGain();
        g.gain.value = 0.0001; o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.01);
      } catch { /* noop */ }
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, []);
  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    try { ctxRef.current?.close(); } catch { /* noop */ }
    ctxRef.current = null;
  }, []);
  return { start, stop };
}

export function WaiterCallsNotifier() {
  const { activeBranchId } = useBranch();
  const [calls, setCalls] = useState<WaiterCall[]>([]);
  const { start, stop } = useAlertLoop();

  const load = useCallback(async () => {
    if (!activeBranchId) return;
    const { data } = await supabase
      .from("waiter_calls")
      .select("id, branch_id, table_id, table_number, table_label, status, reason, created_at")
      .eq("branch_id", activeBranchId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    setCalls((data ?? []) as WaiterCall[]);
  }, [activeBranchId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (calls.length === 0) stop(); else start();
  }, [calls.length, start, stop]);

  useEffect(() => {
    if (!activeBranchId) return;
    const channel = supabase.channel(`waiter-calls-${activeBranchId}`);
    channel
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "waiter_calls" } as never,
        () => { void load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeBranchId, load]);

  async function attend(id: string) {
    const { error } = await supabase.rpc("attend_waiter_call", { _call_id: id });
    if (error) { toast.error(error.message); return; }
    setCalls((arr) => arr.filter((c) => c.id !== id));
    toast.success("Mesa atendida");
  }

  function dismissAll() {
    setCalls([]);
    stop();
  }

  if (calls.length === 0) return null;

  return (
    <div className="fixed top-6 right-6 z-[110] w-[min(94vw,420px)] animate-in slide-in-from-top-6 duration-300">
      <div className="rounded-2xl border-4 border-amber-500 bg-background shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/20">
          <div className="relative text-amber-600">
            <BellRing className="h-7 w-7 animate-bounce" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
            </span>
          </div>
          <div className="flex-1 font-display text-lg leading-tight">
            ¡MESA LLAMA AL MESERO!
            {calls.length > 1 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-sm h-6 min-w-6 px-2">
                {calls.length}
              </span>
            )}
          </div>
          <button type="button" aria-label="Cerrar" onClick={dismissAll} className="rounded-full p-1 hover:bg-muted text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto divide-y">
          {calls.map((c) => (
            <div key={c.id} className="px-4 py-3 flex items-center gap-3">
              <div className="font-display text-2xl text-amber-600 min-w-[60px]">
                {c.table_label ?? `Mesa ${c.table_number ?? "?"}`}
              </div>
              <div className="flex-1 leading-tight">
                <div className="text-sm font-semibold">Necesita al mesero</div>
                {c.reason && <div className="text-xs text-muted-foreground truncate">{c.reason}</div>}
                <div className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <Button size="sm" onClick={() => attend(c.id)} className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Check className="h-4 w-4" /> Atendida
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
