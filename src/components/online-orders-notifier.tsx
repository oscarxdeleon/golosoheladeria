import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendToLocalPrinter, normalizeModifiers } from "@/lib/print-client";
import { useBranch } from "@/contexts/branch-context";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, X } from "lucide-react";

const PUBLIC_ORDER_SOURCES = ["online_menu", "kiosk", "table_qr"] as const;
const ACK_STORAGE_KEY = "goloso.pos.publicOrderAlerts.seen.v1";
const BACKSTOP_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ---------- Audio: un solo beep por cada pedido nuevo ----------
 * Se reproduce una única vez cuando llega un pedido nuevo. Requiere que el
 * usuario haya interactuado alguna vez con la página (política de autoplay
 * del navegador); mientras tanto se hace un "unlock" silencioso en el primer
 * gesto para que los beeps posteriores no queden bloqueados.
 */
function buildBeepBlobUrl(): string {
  const sr = 44100;
  const dur = 0.7; // beep corto de una sola pasada
  const N = Math.floor(sr * dur);
  const data = new Float32Array(N);
  const tones: Array<{ f: number; t0: number; t1: number }> = [
    { f: 880, t0: 0.00, t1: 0.16 },
    { f: 1180, t0: 0.18, t1: 0.34 },
    { f: 1480, t0: 0.36, t1: 0.55 },
  ];
  for (const t of tones) {
    const s = Math.floor(t.t0 * sr);
    const e = Math.floor(t.t1 * sr);
    for (let i = s; i < e; i++) {
      const env = Math.min(1, (i - s) / 240) * Math.min(1, (e - i) / 240);
      const sample = Math.sign(Math.sin(2 * Math.PI * t.f * (i / sr))) * 0.38 * env;
      data[i] = Math.max(-1, Math.min(1, data[i] + sample));
    }
  }
  const buf = new ArrayBuffer(44 + N * 2);
  const view = new DataView(buf);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); view.setUint32(4, 36 + N * 2, true);
  wr(8, "WAVE"); wr(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  wr(36, "data"); view.setUint32(40, N * 2, true);
  for (let i = 0; i < N; i++) {
    const s = data[i];
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

function useOrderAlertLoop() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const urlRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);
  const unlockedRef = useRef(false);

  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!urlRef.current) urlRef.current = buildBeepBlobUrl();
    if (!audioRef.current) {
      const a = new Audio(urlRef.current);
      a.loop = false;
      a.preload = "auto";
      a.volume = 1;
      a.setAttribute("playsinline", "true");
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      ctxRef.current = new AudioCtor();
    }
    return ctxRef.current;
  }, []);

  const playOscBeep = useCallback(() => {
    const ctx = ensureAudioContext();
    if (!ctx) return false;
    const fire = () => {
      const startAt = ctx.currentTime;
      [880, 1180, 1480].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startAt + idx * 0.18);
        gain.gain.linearRampToValueAtTime(0.22, startAt + idx * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + idx * 0.18 + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt + idx * 0.18);
        osc.stop(startAt + idx * 0.18 + 0.17);
      });
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(fire).catch(() => { /* bloqueado hasta un gesto */ });
    } else {
      fire();
    }
    return true;
  }, [ensureAudioContext]);

  const playOnce = useCallback(() => {
    const a = ensureAudio();
    if (a) {
      try { a.pause(); a.currentTime = 0; } catch { /* noop */ }
      const p = a.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => { playOscBeep(); });
      }
      return;
    }
    playOscBeep();
  }, [ensureAudio, playOscBeep]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    playOnce();
    intervalRef.current = setInterval(() => { playOnce(); }, 1500);
  }, [playOnce]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const a = audioRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch { /* noop */ } }
  }, []);

  // Desbloqueo silencioso en el primer gesto del usuario para que los beeps
  // posteriores no queden bloqueados por el navegador.
  useEffect(() => {
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      const a = ensureAudio();
      if (a) {
        const prevMuted = a.muted;
        a.muted = true;
        const p = a.play();
        const finish = () => {
          try { a.pause(); a.currentTime = 0; a.muted = prevMuted; } catch { /* noop */ }
        };
        if (p && typeof p.then === "function") p.then(finish).catch(() => { a.muted = prevMuted; });
        else finish();
      }
      const ctx = ensureAudioContext();
      if (ctx?.state === "suspended") void ctx.resume().catch(() => { /* noop */ });
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "click"];
    events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
    return () => { events.forEach((e) => window.removeEventListener(e, unlock)); };
  }, [ensureAudio, ensureAudioContext]);

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const a = audioRef.current;
    if (a) { try { a.pause(); } catch { /* noop */ } }
    const ctx = ctxRef.current;
    if (ctx) { try { void ctx.close(); } catch { /* noop */ } }
    if (urlRef.current) { try { URL.revokeObjectURL(urlRef.current); } catch { /* noop */ } }
    audioRef.current = null;
    ctxRef.current = null;
    urlRef.current = null;
  }, []);

  return { start, stop };
}


type IncomingSale = {
  id: string;
  ticket_number: number;
  customer_name: string | null;
  user_name: string | null;
  total: number;
  subtotal: number | null;
  delivery_fee: number | null;
  notes: string | null;
  source: string;
  status: string | null;
  branch_id: string | null;
  table_id: string | null;
  order_type: string | null;
  created_at: string;
  notify_ack_at?: string | null;
  restaurant_tables?: { number: number | null; label: string | null } | null;
};

// Marca el pedido como reconocido en la DB para que la alerta desaparezca
// en tiempo real en todas las sesiones abiertas de la misma sede.
async function ackOrdersInDb(ids: string[]) {
  if (ids.length === 0) return;
  try {
    await supabase.from("sales").update({ notify_ack_at: new Date().toISOString() }).in("id", ids).is("notify_ack_at", null);
  } catch { /* noop */ }
}

// Canal broadcast por sede para propagar confirmaciones al instante entre
// dispositivos, sin depender de la latencia de postgres_changes ni de RLS.
const ackBroadcastChannels = new Map<string, ReturnType<typeof supabase.channel>>();
function getAckBroadcastChannel(branchId: string) {
  let ch = ackBroadcastChannels.get(branchId);
  if (!ch) {
    ch = supabase.channel(`orders-ack-broadcast-${branchId}`, { config: { broadcast: { self: false } } });
    ch.subscribe();
    ackBroadcastChannels.set(branchId, ch);
  }
  return ch;
}
function broadcastAck(branchId: string, ids: string[]) {
  if (!branchId || ids.length === 0) return;
  try {
    const ch = getAckBroadcastChannel(branchId);
    void ch.send({ type: "broadcast", event: "orders-ack", payload: { ids } });
  } catch { /* noop */ }
}



async function autoPrintKioskOrder(saleId: string) {
  const [{ data: sale }, { data: items }] = await Promise.all([
    supabase.from("sales").select("ticket_number, subtotal, total, delivery_fee, customer_name, notes, created_at").eq("id", saleId).maybeSingle(),
    supabase.from("sale_items").select("product_name, qty, unit_price, modifiers").eq("sale_id", saleId),
  ]);
  if (!sale || !items?.length) return;
  const printItems = items.map((i) => ({
    name: i.product_name,
    qty: Number(i.qty),
    unit_price: Number(i.unit_price),
    modifiers: normalizeModifiers((i as { modifiers?: unknown }).modifiers),
  }));

  void sendToLocalPrinter({
    type: "comanda",
    ticket: sale.ticket_number,
    header: "PEDIDO AUTOPEDIDO",
    order_type: "kiosko",
    items: printItems,
    customer: sale.customer_name ?? undefined,
    notes: sale.notes ?? undefined,
    created_at: sale.created_at ?? undefined,
  });

  // Nota: el ticket de venta (comprobante) NO se imprime al confirmar el pedido.
  // Solo se imprime cuando el pago es confirmado desde el POS.
}

async function printTableOrderComanda(saleId: string) {
  const [{ data: sale }, { data: items }] = await Promise.all([
    supabase.from("sales").select("ticket_number, customer_name, notes, created_at, table_id").eq("id", saleId).maybeSingle(),
    supabase.from("sale_items").select("product_name, qty, unit_price, modifiers").eq("sale_id", saleId),
  ]);
  if (!sale || !items?.length) return;
  let tableLabel = "";
  if (sale.table_id) {
    const { data: t } = await supabase.from("restaurant_tables").select("number,label").eq("id", sale.table_id).maybeSingle();
    if (t) tableLabel = t.label ?? `Mesa ${t.number}`;
  }
  const printItems = items.map((i) => ({
    name: i.product_name,
    qty: Number(i.qty),
    unit_price: Number(i.unit_price),
    modifiers: normalizeModifiers((i as { modifiers?: unknown }).modifiers),
  }));
  void sendToLocalPrinter({
    type: "comanda",
    ticket: sale.ticket_number,
    header: tableLabel ? tableLabel.toUpperCase().replace(/^MESA\s*#?\s*/i, "MESA # ") : "MESA",
    order_type: "mesa",
    items: printItems,
    customer: sale.customer_name ?? tableLabel ?? undefined,
    notes: sale.notes ?? undefined,
    created_at: sale.created_at ?? undefined,
  });
}

type OrderKind = "mesa" | "domicilio" | "recoger" | "kiosko";

type PendingAlert = {
  id: string;
  ticket: number;
  source: string;
  kind: OrderKind;
  total: number;
  customer: string | null;
  tableLabel: string | null;
  receivedAt: string;
};

function readAcknowledgedIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(localStorage.getItem(ACK_STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function persistAcknowledgedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  const latest = Array.from(ids).slice(-500);
  try { localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(latest)); } catch { /* noop */ }
}

function classifyKind(row: IncomingSale): OrderKind {
  if (row.source === "table_qr") return "mesa";
  if (row.source === "kiosk") return "kiosko";
  const ot = (row.order_type ?? "").toLowerCase();
  if (ot === "domicilio") return "domicilio";
  if ((row.notes ?? "").toUpperCase().includes("RECOGER")) return "recoger";
  return "domicilio";
}

function kindLabel(k: OrderKind) {
  if (k === "mesa") return "Mesa";
  if (k === "kiosko") return "Autopedido";
  if (k === "recoger") return "Recoger en heladería";
  return "Domicilio";
}

function receivedTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Ahora";
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

function fallbackTableLabel(row: IncomingSale) {
  const fromJoin = row.restaurant_tables?.label?.trim()
    || (row.restaurant_tables?.number ? `Mesa ${row.restaurant_tables.number}` : "");
  if (fromJoin) return fromJoin;
  const cleanedUser = row.user_name?.replace(/^Mesa\s+QR\s*/i, "").trim();
  return cleanedUser || null;
}

export function OnlineOrdersNotifier() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { roles, rolesLoading } = useAuth();
  const canReceiveAlerts = !rolesLoading && (roles.includes("admin") || roles.includes("cajero"));
  // Dedupe SÍNCRONA: se marca antes de cualquier await.
  const seen = useRef<Set<string>>(new Set());
  const acknowledged = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAlert[]>([]);
  const { start: startAlertLoop, stop: stopAlertLoop } = useOrderAlertLoop();

  useEffect(() => {
    acknowledged.current = readAcknowledgedIds();
    seen.current = new Set(acknowledged.current);
  }, []);

  const acknowledge = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    ids.forEach((id) => {
      acknowledged.current.add(id);
      seen.current.add(id);
    });
    persistAcknowledgedIds(acknowledged.current);
  }, []);

  useEffect(() => {
    setPending([]);
  }, [activeBranchId]);

  function dismissAll() {
    const ids = pending.map((p) => p.id);
    acknowledge(ids);
    setPending([]);
    stopAlertLoop();
    void ackOrdersInDb(ids);
    if (activeBranchId) broadcastAck(activeBranchId, ids);
  }

  function confirmAndNavigate(kind: OrderKind) {
    if (kind === "mesa") {
      pending.filter((p) => p.kind === "mesa").forEach((p) => { void printTableOrderComanda(p.id); });
    }
    const ids = pending.map((p) => p.id);
    acknowledge(ids);
    setPending([]);
    stopAlertLoop();
    void ackOrdersInDb(ids);
    if (activeBranchId) broadcastAck(activeBranchId, ids);
    navigate({
      to:
        kind === "kiosko" ? "/kiosko"
          : kind === "mesa" ? "/mesas"
            : "/pedidos-online",
    });
  }



  const invalidateOrderViews = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["online-orders", activeBranchId] });
    qc.invalidateQueries({ queryKey: ["pending-sales"] });
    qc.invalidateQueries({ queryKey: ["pending-sale"] });
    qc.invalidateQueries({ queryKey: ["kiosk-orders"] });
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
    qc.invalidateQueries({ queryKey: ["todos-pedidos"] });
    window.setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
      qc.invalidateQueries({ queryKey: ["pending-sale"] });
    }, 900);
  }, [activeBranchId, qc]);

  const resolveTableLabel = useCallback(async (row: IncomingSale) => {
    if (row.source !== "table_qr") return null;
    const immediate = fallbackTableLabel(row);
    if (immediate) return immediate;
    if (!row.table_id) return "Mesa QR";
    const { data } = await supabase
      .from("restaurant_tables")
      .select("number,label")
      .eq("id", row.table_id)
      .maybeSingle();
    return data?.label?.trim() || (data?.number ? `Mesa ${data.number}` : "Mesa QR");
  }, []);

  const addAlert = useCallback(async (row: IncomingSale, options: { fromRealtime: boolean }) => {
    if (!activeBranchId || !canReceiveAlerts) return;
    if (!row?.id) return;
    if (!PUBLIC_ORDER_SOURCES.includes(row.source as (typeof PUBLIC_ORDER_SOURCES)[number])) return;
    if (row.branch_id !== activeBranchId) return;
    if (row.status && row.status !== "pending") {
      acknowledge([row.id]);
      setPending((arr) => arr.filter((p) => p.id !== row.id));
      return;
    }
    if (row.notify_ack_at) {
      acknowledge([row.id]);
      setPending((arr) => arr.filter((p) => p.id !== row.id));
      return;
    }

    // ---- DEDUPE SÍNCRONA: marcar como visto ANTES de cualquier await ----
    if (seen.current.has(row.id) || acknowledged.current.has(row.id)) return;
    seen.current.add(row.id);

    const kind = classifyKind(row);
    const tableLabel = await resolveTableLabel(row);

    setPending((arr) => {
      if (arr.some((p) => p.id === row.id)) return arr;
      return [
        ...arr,
        {
          id: row.id,
          ticket: row.ticket_number,
          source: row.source,
          kind,
          total: Number(row.total ?? 0),
          customer: row.customer_name,
          tableLabel,
          receivedAt: row.created_at,
        },
      ];
    });

    if (options.fromRealtime && row.source === "kiosk") void autoPrintKioskOrder(row.id);
    invalidateOrderViews();
  }, [acknowledge, activeBranchId, canReceiveAlerts, invalidateOrderViews, resolveTableLabel]);

  // La alerta sonora se reproduce en bucle continuo mientras exista al menos
  // un pedido pendiente de confirmación. Se detiene automáticamente cuando el
  // cajero confirma o silencia todos los pedidos.
  useEffect(() => {
    if (!canReceiveAlerts) { stopAlertLoop(); return; }
    if (pending.length > 0) startAlertLoop();
    else stopAlertLoop();
  }, [pending.length, canReceiveAlerts, startAlertLoop, stopAlertLoop]);


  const loadRecentPending = useCallback(async () => {
    if (!activeBranchId || !canReceiveAlerts) return;
    const since = new Date(Date.now() - BACKSTOP_WINDOW_MS).toISOString();
    const { data } = await supabase
      .from("sales")
      .select("id,ticket_number,customer_name,user_name,total,subtotal,delivery_fee,notes,source,status,branch_id,table_id,order_type,created_at,notify_ack_at,restaurant_tables(number,label)")
      .eq("branch_id", activeBranchId)
      .eq("status", "pending")
      .is("notify_ack_at", null)
      .in("source", [...PUBLIC_ORDER_SOURCES])
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(50);

    (data ?? []).forEach((row) => {
      void addAlert(row as unknown as IncomingSale, { fromRealtime: false });
    });
  }, [activeBranchId, addAlert, canReceiveAlerts]);

  useEffect(() => {
    if (!activeBranchId || !canReceiveAlerts) return;
    void loadRecentPending();

    const channel = supabase
      .channel(`sales-public-orders-v3-${activeBranchId}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "sales" } as never,
        ((payload: { eventType: string; new: IncomingSale; old: Partial<IncomingSale> }) => {
          const row = (payload.new ?? payload.old) as IncomingSale | undefined;
          if (!row?.id) return;
          const acked = payload.eventType === "UPDATE" && Boolean(row.notify_ack_at);
          const closed = payload.eventType === "UPDATE" && row.status != null && row.status !== "pending";
          if (payload.eventType === "DELETE" || acked || closed) {
            acknowledge([row.id]);
            setPending((arr) => arr.filter((p) => p.id !== row.id));
            invalidateOrderViews();
            return;
          }
          void addAlert(row, { fromRealtime: payload.eventType === "INSERT" });

        }) as never,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadRecentPending();
      });
    const fallback = window.setInterval(() => { void loadRecentPending(); }, 5000);
    return () => {
      window.clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [acknowledge, activeBranchId, addAlert, canReceiveAlerts, invalidateOrderViews, loadRecentPending]);

  if (pending.length === 0 || !canReceiveAlerts) return null;

  const last = pending[pending.length - 1];
  const isKiosk = last.kind === "kiosko";
  const isTable = last.kind === "mesa";
  const isPickup = last.kind === "recoger";
  const headline = isKiosk
    ? "¡NUEVO PEDIDO AUTOPEDIDO!"
    : isTable
      ? "¡NUEVO PEDIDO DE MESA!"
      : isPickup
        ? "¡NUEVO PEDIDO PARA RECOGER!"
        : "¡NUEVO PEDIDO A DOMICILIO!";
  const accent = isKiosk ? "border-primary" : isTable ? "border-emerald-500" : isPickup ? "border-cyan-500" : "border-rose-500";
  const accentBg = isKiosk ? "bg-primary/15" : isTable ? "bg-emerald-500/15" : isPickup ? "bg-cyan-500/15" : "bg-rose-500/15";

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-[min(94vw,440px)] animate-in slide-in-from-bottom-6 duration-300" role="status" aria-live="polite">
      <div className={`rounded-2xl border-4 ${accent} bg-background shadow-2xl overflow-hidden`}>
        <div className={`flex items-center gap-3 px-4 py-3 ${accentBg}`}>
          <div className="relative text-foreground">
            <Bell className="h-7 w-7 animate-bounce" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
            </span>
          </div>
          <div className="flex-1 font-display text-lg leading-tight">
            {headline}
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

        <div className="max-h-[48vh] overflow-y-auto divide-y">
          {pending.slice().reverse().slice(0, 5).map((p) => (
            <div key={p.id} className="px-4 py-3 flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 px-2.5 py-1 font-display text-xl text-primary shrink-0">#{p.ticket}</div>
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-sm font-semibold truncate">
                  {p.kind === "mesa"
                    ? (p.tableLabel ?? "Mesa QR")
                    : (p.customer ?? (p.kind === "kiosko" ? "Autopedido" : "Cliente"))}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{kindLabel(p.kind)}</span>
                  <span>·</span>
                  <span>Recibido {receivedTime(p.receivedAt)}</span>
                  <span>·</span>
                  <span>Pedido #{p.ticket}</span>
                </div>
                <div className="mt-2 inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Nuevo Pedido
                </div>
              </div>
              <div className="font-mono text-sm shrink-0">${Math.round(p.total).toLocaleString("es-CO")}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40">
          <Button variant="outline" onClick={dismissAll} className="gap-2">
            <BellOff className="h-4 w-4" /> Silenciar
          </Button>
          <Button onClick={() => confirmAndNavigate(last.kind)} className="gap-2">
            {isTable ? "Confirmar e imprimir" : "Confirmar pedido"}
          </Button>
        </div>
      </div>
    </div>
  );
}
