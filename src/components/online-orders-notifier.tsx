import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendToLocalPrinter } from "@/lib/print-client";
import { useBranch } from "@/contexts/branch-context";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, X } from "lucide-react";

const PUBLIC_ORDER_SOURCES = ["online_menu", "kiosk", "table_qr"] as const;
const ACK_STORAGE_KEY = "goloso.pos.publicOrderAlerts.seen.v1";
const BACKSTOP_WINDOW_MS = 24 * 60 * 60 * 1000;

/* ---------- Audio: loop persistente hasta confirmar ----------
 * Usa un HTMLAudioElement con loop=true para que la alerta continúe
 * reproduciéndose aunque el navegador suspenda el AudioContext, cambie
 * de pestaña o el usuario navegue a otras secciones del POS.
 */
function buildBeepBlobUrl(): string {
  const sr = 44100;
  const dur = 2.4; // beep + silencio, se repite en loop
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
  const urlRef = useRef<string | null>(null);
  const activeRef = useRef(false);
  const unlockedRef = useRef(false);

  const ensureAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!urlRef.current) urlRef.current = buildBeepBlobUrl();
    if (!audioRef.current) {
      const a = new Audio(urlRef.current);
      a.loop = true;
      a.preload = "auto";
      a.volume = 1;
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const attemptPlay = useCallback(() => {
    const a = ensureAudio();
    if (!a) return;
    const p = a.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => { /* bloqueado hasta el próximo gesto; se reintenta en unlock */ });
    }
  }, [ensureAudio]);

  const start = useCallback(() => {
    if (activeRef.current) {
      const a = audioRef.current;
      if (a && a.paused) attemptPlay();
      return;
    }
    activeRef.current = true;
    attemptPlay();
  }, [attemptPlay]);

  const stop = useCallback(() => {
    activeRef.current = false;
    const a = audioRef.current;
    if (a) {
      try { a.pause(); a.currentTime = 0; } catch { /* noop */ }
    }
  }, []);

  // Desbloqueo por gesto del usuario y recuperación al volver a la pestaña.
  useEffect(() => {
    const unlock = () => {
      const a = ensureAudio();
      if (!a) return;
      if (!unlockedRef.current) {
        unlockedRef.current = true;
        const prevMuted = a.muted;
        a.muted = true;
        const p = a.play();
        const finish = () => { try { a.pause(); a.currentTime = 0; a.muted = prevMuted; } catch { /* noop */ } };
        if (p && typeof p.then === "function") p.then(finish).catch(() => { a.muted = prevMuted; });
        else finish();
      }
      if (activeRef.current && a.paused) attemptPlay();
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "click"];
    events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
    const onVisible = () => { if (activeRef.current) attemptPlay(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.forEach((e) => window.removeEventListener(e, unlock));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [attemptPlay, ensureAudio]);

  useEffect(() => () => {
    const a = audioRef.current;
    if (a) { try { a.pause(); } catch { /* noop */ } }
    if (urlRef.current) { try { URL.revokeObjectURL(urlRef.current); } catch { /* noop */ } }
    audioRef.current = null;
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
  restaurant_tables?: { number: number | null; label: string | null } | null;
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
    header: "PEDIDO AUTOPEDIDO",
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

async function printTableOrderComanda(saleId: string) {
  const [{ data: sale }, { data: items }] = await Promise.all([
    supabase.from("sales").select("ticket_number, customer_name, notes, created_at, table_id").eq("id", saleId).maybeSingle(),
    supabase.from("sale_items").select("product_name, qty, unit_price").eq("sale_id", saleId),
  ]);
  if (!sale || !items?.length) return;
  let tableLabel = "";
  if (sale.table_id) {
    const { data: t } = await supabase.from("restaurant_tables").select("number,label").eq("id", sale.table_id).maybeSingle();
    if (t) tableLabel = t.label ?? `Mesa ${t.number}`;
  }
  const printItems = items.map((i) => ({ name: i.product_name, qty: Number(i.qty), unit_price: Number(i.unit_price) }));
  void sendToLocalPrinter({
    type: "comanda",
    ticket: sale.ticket_number,
    header: `PEDIDO MESA${tableLabel ? " · " + tableLabel.toUpperCase() : ""}`,
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
  const { start: startLoop, stop: stopLoop } = useOrderAlertLoop();

  useEffect(() => {
    acknowledged.current = readAcknowledgedIds();
    seen.current = new Set(acknowledged.current);
  }, []);

  // Loop de sonido activo mientras haya pendientes
  useEffect(() => {
    if (pending.length > 0 && canReceiveAlerts) startLoop();
    else stopLoop();
  }, [pending.length, canReceiveAlerts, startLoop, stopLoop]);

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
    stopLoop();
  }, [activeBranchId, stopLoop]);

  function dismissAll() {
    acknowledge(pending.map((p) => p.id));
    setPending([]);
    stopLoop();
  }

  function confirmAndNavigate(kind: OrderKind) {
    if (kind === "mesa") {
      pending.filter((p) => p.kind === "mesa").forEach((p) => { void printTableOrderComanda(p.id); });
    }
    acknowledge(pending.map((p) => p.id));
    setPending([]);
    stopLoop();
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

  const loadRecentPending = useCallback(async () => {
    if (!activeBranchId || !canReceiveAlerts) return;
    const since = new Date(Date.now() - BACKSTOP_WINDOW_MS).toISOString();
    const { data } = await supabase
      .from("sales")
      .select("id,ticket_number,customer_name,user_name,total,subtotal,delivery_fee,notes,source,status,branch_id,table_id,order_type,created_at,restaurant_tables(number,label)")
      .eq("branch_id", activeBranchId)
      .eq("status", "pending")
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
          if (payload.eventType === "DELETE" || (payload.eventType === "UPDATE" && row.status && row.status !== "pending")) {
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
