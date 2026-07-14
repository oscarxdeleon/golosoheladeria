// Auto-detección de sede para tablets (Meseros).
//
// El navegador no puede leer el SSID del WiFi por seguridad. En su lugar
// usamos el Print Server local como "beacon" de sede: cada impresora en la
// tabla `printers` tiene una `branch_id` y una `local_url` (URL LAN del
// Print Server, ej. http://192.168.1.50:3001/print). La tablet sondea todas
// las URLs en paralelo y la primera que responde `/health` determina la
// sede en la que está físicamente conectada.
//
// Beneficios:
// - Sin permisos del navegador ni instalación nativa.
// - Reacciona a cambios de red (el sondeo se repite en `online` y cada 60s).
// - Determina también qué impresora usar para las comandas.

import { supabase } from "@/integrations/supabase/client";

export interface DetectedBranch {
  branchId: string;
  printerId: string;
  printerName: string;
  printUrl: string;
  method: "print-server";
}

interface PrinterRow {
  id: string;
  name: string;
  branch_id: string | null;
  local_url: string | null;
  active: boolean;
}

function healthUrlFor(printUrl: string): string {
  try {
    const u = new URL(printUrl);
    u.pathname = "/health";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return printUrl.replace(/\/print\/?$/i, "/health");
  }
}

async function probe(url: string, timeoutMs = 2500): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(healthUrlFor(url), {
      method: "GET",
      mode: "cors",
      signal: ctrl.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

let _cache: { at: number; result: DetectedBranch | null } | null = null;
const CACHE_MS = 30_000;

export async function detectBranchByLocalPrintServer(
  opts: { force?: boolean } = {},
): Promise<DetectedBranch | null> {
  if (!opts.force && _cache && Date.now() - _cache.at < CACHE_MS) {
    return _cache.result;
  }
  const { data } = await supabase
    .from("printers")
    .select("id,name,branch_id,local_url,active")
    .eq("active", true);

  const printers = ((data ?? []) as PrinterRow[]).filter(
    (p) => !!p.branch_id && !!p.local_url,
  );
  if (printers.length === 0) {
    _cache = { at: Date.now(), result: null };
    return null;
  }

  // Sondear todas en paralelo; ganador = primera que responde /health.
  const winner = await new Promise<PrinterRow | null>((resolve) => {
    let pending = printers.length;
    let resolved = false;
    printers.forEach((p) => {
      void probe(p.local_url!).then((ok) => {
        if (resolved) return;
        if (ok) {
          resolved = true;
          resolve(p);
          return;
        }
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    });
  });

  const result: DetectedBranch | null = winner
    ? {
        branchId: winner.branch_id!,
        printerId: winner.id,
        printerName: winner.name,
        printUrl: winner.local_url!,
        method: "print-server",
      }
    : null;
  _cache = { at: Date.now(), result };
  return result;
}

export function clearBranchDetectionCache() {
  _cache = null;
}

const FP_KEY = "goloso.deviceFingerprint";
export function getDeviceFingerprint(): string {
  if (typeof window === "undefined") return "server";
  try {
    let fp = window.localStorage.getItem(FP_KEY);
    if (!fp) {
      fp =
        "tab-" +
        Math.random().toString(36).slice(2, 10) +
        "-" +
        Date.now().toString(36);
      window.localStorage.setItem(FP_KEY, fp);
    }
    return fp;
  } catch {
    return "unknown";
  }
}

export async function logDetection(entry: {
  userId: string | null;
  branchId: string | null;
  method: string;
  probeUrl?: string | null;
  success: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  if (!entry.userId) return; // RLS exige auth.uid()
  try {
    await supabase.from("branch_detection_log").insert({
      user_id: entry.userId,
      detected_branch_id: entry.branchId,
      detection_method: entry.method,
      probe_url: entry.probeUrl ?? null,
      device_fingerprint: getDeviceFingerprint(),
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      success: entry.success,
      error_message: entry.errorMessage ?? null,
    });
  } catch {
    // No bloquear la operación si la auditoría falla.
  }
}
