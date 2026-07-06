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
const BACKSTOP_WINDOW_MS = 30 * 60 * 1000;

/* ---------- Audio: un tono por cada pedido recibido ---------- */
function useOrderAlertSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  function ensureCtx() {
    let ctx = ctxRef.current;
    if (!ctx) {
      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      ctx = new AC();
      ctxRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => { /* noop */ });
    }
    return ctx;
  }

  const play = useCallback(() => {
    try {
      const ctx = ensureCtx();
      // Triple tono ascendente para que se escuche con ruido de fondo.
      const freqs = [880, 1180, 1480];
      freqs.forEach((f, i) => {
        const start = ctx.currentTime + i * 0.18;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "square"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.45, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        o.start(start); o.stop(start + 0.18);
      });
    } catch { /* noop */ }
  }, []);

  // Desbloquear AudioContext en el primer gesto del usuario (política del navegador)
  useEffect(() => {
    const unlock = () => {
      try {
        const ctx = ensureCtx();
        // Reproducir un tick silencioso para armar el contexto
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.01);
      } catch { /* noop */ }
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, unlock, { once: false, passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, []);

  useEffect(() => () => {
    try { ctxRef.current?.close(); } catch { /* noop */ }
    ctxRef.current = null;
  }, []);

  return play;
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


type PendingAlert = {
  id: string;
  ticket: number;
  source: string;
  total: number;
  customer: string | null;
  tableLabel: string | null;
  receivedAt: string;
  statusLabel: string;
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
  const latest = Array.from(ids).slice(-300);
  try { localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(latest)); } catch { /* noop */ }
}

function sourceLabel(source: string) {
  if (source === "kiosk") return "Autopedido";
  if (source === "table_qr") return "Mesa QR";
  return "Menú en línea";
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
  const seen = useRef<Set<string>>(new Set());
  const acknowledged = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAlert[]>([]);
  const playAlert = useOrderAlertSound();

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

  function dismissAll() {
    acknowledge(pending.map((p) => p.id));
    setPending([]);
  }

  function confirmAndNavigate(source: string) {
    // Al confirmar pedidos de mesa (QR), imprimir la comanda de cada pendiente
    if (source === "table_qr") {
      pending.filter((p) => p.source === "table_qr").forEach((p) => { void printTableOrderComanda(p.id); });
    }
    acknowledge(pending.map((p) => p.id));
    setPending([]);
    navigate({
      to:
        source === "kiosk"
          ? "/kiosko"
          : source === "table_qr"
            ? "/mesas"
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
    if (seen.current.has(row.id) || acknowledged.current.has(row.id)) return;

    seen.current.add(row.id);
    const tableLabel = await resolveTableLabel(row);
    setPending((arr) => {
      if (arr.some((p) => p.id === row.id)) return arr;
      return [
        ...arr,
        {
          id: row.id,
          ticket: row.ticket_number,
          source: row.source,
          total: Number(row.total ?? 0),
          customer: row.customer_name,
          tableLabel,
          receivedAt: row.created_at,
          statusLabel: "Nuevo Pedido",
        },
      ];
    });
    playAlert();

    if (options.fromRealtime && row.source === "kiosk") void autoPrintKioskOrder(row.id);
    invalidateOrderViews();
  }, [acknowledge, activeBranchId, canReceiveAlerts, invalidateOrderViews, playAlert, resolveTableLabel]);

  const loadRecentPending = useCallback(async () => {
    if (!activeBranchId || !canReceiveAlerts) return;
    const since = new Date(Date.now() - BACKSTOP_WINDOW_MS).toISOString();
    const { data } = await supabase
      .from("sales")
      .select("id,ticket_number,customer_name,user_name,total,subtotal,delivery_fee,notes,source,status,branch_id,table_id,created_at,restaurant_tables(number,label)")
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
      .channel(`sales-public-orders-v2-${activeBranchId}`)
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
  const isKiosk = last.source === "kiosk";
  const isTable = last.source === "table_qr";
  const headline = isKiosk
    ? "¡NUEVO PEDIDO AUTOPEDIDO!"
    : isTable
      ? "¡NUEVO PEDIDO DE MESA!"
      : "¡NUEVO PEDIDO EN LÍNEA!";
  const accent = isKiosk ? "border-primary" : isTable ? "border-emerald-500" : "border-secondary";
  const accentBg = isKiosk ? "bg-primary/15" : isTable ? "bg-emerald-500/15" : "bg-secondary/15";

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-[min(94vw,440px)] animate-in slide-in-from-bottom-6 duration-300" role="status" aria-live="polite">
      <div className={`rounded-2xl border-4 ${accent} bg-background shadow-2xl overflow-hidden`}>
        <div className={`flex items-center gap-3 px-4 py-3 ${accentBg}`}>
          <div className={`relative ${isKiosk ? "text-primary" : isTable ? "text-emerald-600" : "text-secondary-foreground"}`}>
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
              <div className="rounded-xl bg-primary/10 px-2.5 py-1 font-display text-xl text-primary">#{p.ticket}</div>
              <div className="flex-1 leading-tight">
                <div className="text-sm font-semibold truncate">
                  {p.source === "table_qr"
                    ? p.tableLabel ?? "Mesa QR"
                    : p.customer ?? (p.source === "kiosk" ? "Autopedido" : "Cliente")}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{sourceLabel(p.source)}</span>
                  <span>·</span>
                  <span>Recibido {receivedTime(p.receivedAt)}</span>
                  <span>·</span>
                  <span>Pedido #{p.ticket}</span>
                </div>
                <div className="mt-2 inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {p.statusLabel}
                </div>
              </div>
              <div className="font-mono text-sm">${Math.round(p.total).toLocaleString("es-CO")}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40">
          <Button variant="outline" onClick={dismissAll} className="gap-2">
            <BellOff className="h-4 w-4" /> Marcar visto
          </Button>
          <Button onClick={() => confirmAndNavigate(last.source)} className="gap-2">
            {isTable ? "Confirmar e imprimir" : "Confirmar pedido"}
          </Button>
        </div>
      </div>
    </div>
  );
}

