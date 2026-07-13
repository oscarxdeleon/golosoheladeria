// Cola de impresión respaldada por Supabase.
//
// Escenario: una tablet de mesero NO puede conectarse al Print Server local
// (localhost del tablet != PC del cajero). En lugar de mostrar "revisa el
// servidor local", encolamos el trabajo en `print_jobs` y la PC del POS
// (cualquier navegador con LOCAL_PRINT_URL configurado y activo en la misma
// sede) lo procesa automáticamente vía realtime.

import { supabase } from "@/integrations/supabase/client";
import type { PrintPayload } from "@/lib/print-client";
import { sendToLocalPrinter, getLocalPrintUrl, bootstrapLocalPrintUrl } from "@/lib/print-client";

export type PrintJobStatus = "pending" | "printing" | "printed" | "error" | "canceled";

export interface PrintJobRow {
  id: string;
  branch_id: string | null;
  sale_id: string | null;
  kind: string;
  payload: PrintPayload;
  status: PrintJobStatus;
  tries: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  printed_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
}

interface EnqueueOpts {
  branchId?: string | null;
  saleId?: string | null;
  kind?: string;
}

export async function enqueuePrintJob(payload: PrintPayload, opts: EnqueueOpts = {}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("print_jobs")
      .insert({
        branch_id: opts.branchId ?? null,
        sale_id: opts.saleId ?? null,
        kind: opts.kind ?? payload.type ?? "comanda",
        payload: payload as unknown as Record<string, unknown>,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[print-queue] no se pudo encolar", error);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.warn("[print-queue] excepcion al encolar", e);
    return null;
  }
}

export async function countPendingPrintJobs(branchId?: string | null): Promise<number> {
  try {
    let q = supabase.from("print_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "error"]);
    if (branchId) q = q.eq("branch_id", branchId);
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function listPendingPrintJobs(branchId?: string | null, limit = 50): Promise<PrintJobRow[]> {
  let q = supabase.from("print_jobs").select("*").in("status", ["pending", "error"]).order("created_at", { ascending: true }).limit(limit);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data } = await q;
  return (data as unknown as PrintJobRow[] | null) ?? [];
}

export async function cancelPrintJob(id: string): Promise<void> {
  await supabase.from("print_jobs").update({ status: "canceled" }).eq("id", id);
}

// ---------- Worker ----------
// Se ejecuta en las pestañas que tienen LOCAL_PRINT_URL configurado.
// Toma trabajos pendientes de una sede, los imprime y actualiza el estado.

const WORKER_ID = (() => {
  try {
    let id = window.localStorage.getItem("PRINT_WORKER_ID");
    if (!id) { id = `w_${Math.random().toString(36).slice(2, 10)}`; window.localStorage.setItem("PRINT_WORKER_ID", id); }
    return id;
  } catch { return `w_${Math.random().toString(36).slice(2, 10)}`; }
})();

const LOCK_TTL_MS = 60_000;
const MAX_TRIES = 5;

async function tryClaimJob(job: PrintJobRow): Promise<boolean> {
  // Optimistic locking: solo reclamamos si nadie más lo tiene o el lock expiró.
  const cutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("print_jobs")
    .update({ status: "printing", locked_by: WORKER_ID, locked_at: new Date().toISOString() })
    .eq("id", job.id)
    .in("status", ["pending", "error"])
    .or(`locked_at.is.null,locked_at.lt.${cutoff}`)
    .select("id");
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function processJob(job: PrintJobRow): Promise<void> {
  const claimed = await tryClaimJob(job);
  if (!claimed) return;
  try {
    const ok = await sendToLocalPrinter(job.payload);
    if (ok) {
      await supabase.from("print_jobs").update({
        status: "printed",
        printed_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", job.id);
    } else {
      const nextTries = (job.tries ?? 0) + 1;
      await supabase.from("print_jobs").update({
        status: nextTries >= MAX_TRIES ? "error" : "pending",
        tries: nextTries,
        last_error: "servidor local no respondio",
        locked_at: null,
        locked_by: null,
      }).eq("id", job.id);
    }
  } catch (e) {
    const nextTries = (job.tries ?? 0) + 1;
    await supabase.from("print_jobs").update({
      status: nextTries >= MAX_TRIES ? "error" : "pending",
      tries: nextTries,
      last_error: String((e as Error)?.message ?? e).slice(0, 500),
      locked_at: null,
      locked_by: null,
    }).eq("id", job.id);
  }
}

let _workerRunning = false;
let _workerTimer: number | null = null;
let _workerChannel: ReturnType<typeof supabase.channel> | null = null;
let _workerBranch: string | null = null;

async function drainOnce(branchId: string | null): Promise<void> {
  if (_workerRunning) return;
  _workerRunning = true;
  try {
    const jobs = await listPendingPrintJobs(branchId, 10);
    for (const job of jobs) {
      // Solo reintentar jobs en 'error' cada minuto (evita loop).
      if (job.status === "error") {
        const age = Date.now() - new Date(job.updated_at).getTime();
        if (age < 60_000) continue;
      }
      await processJob(job);
    }
  } finally {
    _workerRunning = false;
  }
}

/** Arranca el worker de impresión en esta pestaña. Solo procesa si hay LOCAL_PRINT_URL. */
export function startPrintQueueWorker(branchId: string | null): () => void {
  stopPrintQueueWorker();
  _workerBranch = branchId;

  void bootstrapLocalPrintUrl();

  const tick = () => {
    const url = getLocalPrintUrl();
    if (!url) return; // esta pestaña no imprime — otra lo hará
    void drainOnce(_workerBranch);
  };

  // Poll cada 10s como fallback + realtime instantáneo.
  _workerTimer = window.setInterval(tick, 10_000);
  // Primer drain inmediato tras 500ms para permitir bootstrap.
  window.setTimeout(tick, 500);

  const filter = branchId ? `branch_id=eq.${branchId}` : undefined;
  _workerChannel = supabase
    .channel(`print-jobs-${branchId ?? "all"}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "print_jobs", filter },
      () => tick(),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "print_jobs", filter },
      () => tick(),
    )
    .subscribe();

  return stopPrintQueueWorker;
}

export function stopPrintQueueWorker(): void {
  if (_workerTimer != null) { window.clearInterval(_workerTimer); _workerTimer = null; }
  if (_workerChannel) { void supabase.removeChannel(_workerChannel); _workerChannel = null; }
}
