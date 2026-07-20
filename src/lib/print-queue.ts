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
        payload: JSON.parse(JSON.stringify(payload)),
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

const LOCK_TTL_MS = 120_000; // 2 min: da margen para POST + timeout de impresora
const MAX_TRIES = 3;
const STALE_PENDING_MS = 15 * 60 * 1000; // 15 min → jobs viejos se cancelan
const UPDATE_RETRIES = 5;

type PrintJobUpdate = Partial<Omit<PrintJobRow, "payload">>;
async function updateJobWithRetry(id: string, patch: PrintJobUpdate): Promise<boolean> {
  for (let i = 0; i < UPDATE_RETRIES; i += 1) {
    const { error } = await supabase.from("print_jobs").update(patch as never).eq("id", id);
    if (!error) return true;
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  console.warn("[print-queue] no se pudo actualizar job", id, patch);
  return false;
}


async function tryClaimJob(job: PrintJobRow): Promise<boolean> {
  // Optimistic locking: solo reclamamos si nadie más lo tiene o el lock expiró.
  const cutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("print_jobs")
    .update({ status: "printing", locked_by: WORKER_ID, locked_at: new Date().toISOString() })
    .eq("id", job.id)
    .in("status", ["pending"]) // NO reclamar 'printing' expirado: puede haberse impreso ya sin poder actualizar; el server-side dedupe lo bloqueará, pero además no queremos reintentar en silencio
    .or(`locked_at.is.null,locked_at.lt.${cutoff}`)
    .select("id");
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function processJob(job: PrintJobRow): Promise<void> {
  const claimed = await tryClaimJob(job);
  if (!claimed) return;
  try {
    // Inyecta job_id para que el Print Server aplique idempotencia real.
    const payload = { ...job.payload, job_id: job.id } as PrintPayload;
    const ok = await sendToLocalPrinter(payload);
    if (ok) {
      const persisted = await updateJobWithRetry(job.id, {
        status: "printed",
        printed_at: new Date().toISOString(),
        last_error: null,
      });
      if (!persisted) {
        // Como último recurso liberamos el lock, pero el server tiene el job
        // marcado por 10 min y devolverá `deduped:true` si se reintenta.
        await updateJobWithRetry(job.id, { locked_at: null, locked_by: null });
      }
    } else {
      const nextTries = (job.tries ?? 0) + 1;
      await updateJobWithRetry(job.id, {
        status: nextTries >= MAX_TRIES ? "error" : "pending",
        tries: nextTries,
        last_error: "servidor local no respondio",
        locked_at: null,
        locked_by: null,
      });
    }
  } catch (e) {
    const nextTries = (job.tries ?? 0) + 1;
    await updateJobWithRetry(job.id, {
      status: nextTries >= MAX_TRIES ? "error" : "pending",
      tries: nextTries,
      last_error: String((e as Error)?.message ?? e).slice(0, 500),
      locked_at: null,
      locked_by: null,
    });
  }
}

let _workerRunning = false;
let _workerTimer: number | null = null;
let _workerChannel: ReturnType<typeof supabase.channel> | null = null;
let _workerBranch: string | null = null;

async function cancelStalePendingJobs(branchId: string | null): Promise<void> {
  // Cualquier job pendiente >15 min es basura: al reconectar tras horas o
  // días provocaría una avalancha de impresiones duplicadas. Se cancelan.
  const cutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  try {
    let q = supabase
      .from("print_jobs")
      .update({ status: "canceled", last_error: "expirado (>15 min pendiente)" })
      .in("status", ["pending", "printing"])
      .lt("created_at", cutoff);
    if (branchId) q = q.eq("branch_id", branchId);
    await q;
  } catch (e) {
    console.warn("[print-queue] no se pudo purgar jobs viejos", e);
  }
}

async function drainOnce(branchId: string | null): Promise<void> {
  if (_workerRunning) return;
  _workerRunning = true;
  try {
    // Solo procesamos 'pending'. Los 'error' quedan visibles para el operador
    // y se reintentan manualmente desde el panel, evitando loops silenciosos.
    let q = supabase
      .from("print_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);
    if (branchId) q = q.eq("branch_id", branchId);
    const { data } = await q;
    const jobs = ((data as unknown as PrintJobRow[] | null) ?? []);
    for (const job of jobs) {
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
  void cancelStalePendingJobs(branchId);

  const tick = () => {
    const url = getLocalPrintUrl();
    if (!url) return; // esta pestaña no imprime — otra lo hará
    void drainOnce(_workerBranch);
  };

  // Poll cada 15s como fallback + realtime instantáneo.
  _workerTimer = window.setInterval(tick, 15_000);
  // Primer drain inmediato tras 500ms para permitir bootstrap.
  window.setTimeout(tick, 500);

  // Escuchamos INSERTS de TODAS las sedes: el filtro por sede se aplica al
  // consultar (drainOnce), pero la suscripción sin filtro garantiza que el
  // POS reciba el evento realtime aun si el `activeBranchId` cambia o si otro
  // punto de la misma sede insertó desde un contexto distinto. Sin esto, un
  // cambio momentáneo de sede en el selector detenía las impresiones.
  _workerChannel = supabase
    .channel(`print-jobs-worker-${WORKER_ID}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "print_jobs" },
      () => tick(),
    )
    .subscribe();

  return stopPrintQueueWorker;
}

export function stopPrintQueueWorker(): void {
  if (_workerTimer != null) { window.clearInterval(_workerTimer); _workerTimer = null; }
  if (_workerChannel) { void supabase.removeChannel(_workerChannel); _workerChannel = null; }
}

