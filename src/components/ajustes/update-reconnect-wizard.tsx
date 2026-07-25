import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QRCodeCanvas } from "qrcode.react";
import { Check, X, Loader2, QrCode, Wifi, AlertTriangle, RotateCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Asistente "Actualizar y Reconectar":
 * orquesta update → reinicio → validación de sesión → QR si aplica → verificación
 * usando el mecanismo ya existente de cola de comandos (whatsapp_bot_request_command)
 * y el heartbeat que el bot v8.20.1+ escribe en whatsapp_bot_config.
 */

type StepId =
  | "snapshot"
  | "dispatch_update"
  | "wait_apply"
  | "wait_restart"
  | "validate_session"
  | "wait_qr"
  | "wait_scan"
  | "verify"
  | "done";

type StepState = "pending" | "running" | "ok" | "error" | "skipped";

interface StepDef { id: StepId; title: string; hint: string; }

const STEPS: StepDef[] = [
  { id: "snapshot",        title: "Verificando estado actual",     hint: "Leyendo versión y estado del bot" },
  { id: "dispatch_update", title: "Enviando orden de actualización", hint: "El servidor recibirá el comando en segundos" },
  { id: "wait_apply",      title: "Actualizando bot",              hint: "Descarga e instalación (hasta 3 min)" },
  { id: "wait_restart",    title: "Reiniciando servicio",          hint: "Esperando primer heartbeat" },
  { id: "validate_session",title: "Validando sesión de WhatsApp",   hint: "Comprobando si sigue vinculada" },
  { id: "wait_qr",         title: "Generando código QR",           hint: "Solo si la sesión no es válida" },
  { id: "wait_scan",       title: "Esperando vinculación",         hint: "Escanea el QR desde el celular de la sede" },
  { id: "verify",          title: "Verificación final",            hint: "Estado Conectado estable + heartbeat fresco" },
  { id: "done",            title: "Bot operativo",                 hint: "Todo listo" },
];

interface Snapshot {
  version: string | null;
  connected: boolean;
  hasQr: boolean;
  qr: string | null;
  lastSeenAt: string | null;
}

async function readConfig(branchId: string): Promise<Snapshot> {
  const { data, error } = await supabase
    .from("whatsapp_bot_config")
    .select("bot_version,connection_status,qr_code,qr_generated_at,last_seen_at")
    .eq("branch_id", branchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    version: (data?.bot_version as string) ?? null,
    connected: (data?.connection_status as string) === "connected",
    hasQr: !!data?.qr_code,
    qr: (data?.qr_code as string) ?? null,
    lastSeenAt: (data?.last_seen_at as string) ?? null,
  };
}

function heartbeatAgeSec(lastSeenAt: string | null): number | null {
  if (!lastSeenAt) return null;
  return Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 1000);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("cancelled")); });
  });
}

async function pollUntil<T>(
  fn: () => Promise<T>,
  test: (v: T) => boolean,
  { timeoutMs, intervalMs, signal }: { timeoutMs: number; intervalMs: number; signal?: AbortSignal }
): Promise<T> {
  const started = Date.now();
  let last: T;
  while (true) {
    last = await fn();
    if (test(last)) return last;
    if (Date.now() - started > timeoutMs) throw new Error("timeout");
    await sleep(intervalMs, signal);
  }
}

export function UpdateReconnectWizard({
  open, onOpenChange, branchId, branchName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string;
  branchName?: string;
}) {
  const [status, setStatus] = useState<Record<StepId, StepState>>(() =>
    Object.fromEntries(STEPS.map(s => [s.id, "pending"])) as Record<StepId, StepState>
  );
  const [errors, setErrors] = useState<Partial<Record<StepId, string>>>({});
  const [currentQr, setCurrentQr] = useState<string | null>(null);
  const [initialVersion, setInitialVersion] = useState<string | null>(null);
  const [finalVersion, setFinalVersion] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  const mark = (id: StepId, s: StepState, err?: string) => {
    setStatus(prev => ({ ...prev, [id]: s }));
    if (err) setErrors(prev => ({ ...prev, [id]: err }));
  };

  const reset = () => {
    setStatus(Object.fromEntries(STEPS.map(s => [s.id, "pending"])) as Record<StepId, StepState>);
    setErrors({});
    setCurrentQr(null);
    setInitialVersion(null);
    setFinalVersion(null);
  };

  const run = async () => {
    reset();
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const { signal } = ac;

    try {
      // 1. Snapshot
      mark("snapshot", "running");
      const snap = await readConfig(branchId);
      setInitialVersion(snap.version);
      mark("snapshot", "ok");

      // 2. Dispatch update
      mark("dispatch_update", "running");
      const { error: rpcErr } = await supabase.rpc("whatsapp_bot_request_command", {
        _branch_id: branchId, _command: "update",
      });
      if (rpcErr) {
        mark("dispatch_update", "error", /forbidden/i.test(rpcErr.message)
          ? "Solo un Administrador puede actualizar el bot."
          : rpcErr.message);
        throw new Error("dispatch_failed");
      }
      mark("dispatch_update", "ok");

      // 3. Wait for apply: version changes OR heartbeat gap indicates restart
      mark("wait_apply", "running");
      const applied = await pollUntil(
        () => readConfig(branchId),
        (v) => (initialVersion === null ? true : v.version !== initialVersion) ||
               (v.lastSeenAt !== snap.lastSeenAt),
        { timeoutMs: 210_000, intervalMs: 3000, signal }
      ).catch(() => null);
      if (!applied) {
        mark("wait_apply", "error",
          `El bot no reportó cambios en 3 min 30 s. Versión actual v${snap.version ?? "?"}. Verifica que el bot esté en línea en el droplet.`);
        throw new Error("apply_timeout");
      }
      setFinalVersion(applied.version);
      mark("wait_apply", "ok");

      // 4. Wait restart: heartbeat < 15s
      mark("wait_restart", "running");
      const restarted = await pollUntil(
        () => readConfig(branchId),
        (v) => {
          const age = heartbeatAgeSec(v.lastSeenAt);
          return age !== null && age < 15;
        },
        { timeoutMs: 90_000, intervalMs: 2000, signal }
      ).catch(() => null);
      if (!restarted) {
        mark("wait_restart", "error", "Sin heartbeat del bot tras 90 s del reinicio.");
        throw new Error("restart_timeout");
      }
      mark("wait_restart", "ok");

      // 5. Validate session
      mark("validate_session", "running");
      const validated = await pollUntil(
        () => readConfig(branchId),
        (v) => v.connected || v.hasQr,
        { timeoutMs: 45_000, intervalMs: 2000, signal }
      ).catch(() => null);
      if (!validated) {
        mark("validate_session", "error", "El bot no reportó estado de sesión en 45 s.");
        throw new Error("session_timeout");
      }

      if (validated.connected) {
        mark("validate_session", "ok");
        mark("wait_qr", "skipped");
        mark("wait_scan", "skipped");
      } else {
        mark("validate_session", "ok");

        // 6. Wait QR
        mark("wait_qr", "running");
        const qrReady = await pollUntil(
          () => readConfig(branchId),
          (v) => v.hasQr || v.connected,
          { timeoutMs: 60_000, intervalMs: 2000, signal }
        ).catch(() => null);
        if (!qrReady) {
          mark("wait_qr", "error", "El QR no se generó en 60 s.");
          throw new Error("qr_timeout");
        }
        if (qrReady.connected) {
          mark("wait_qr", "skipped");
          mark("wait_scan", "skipped");
        } else {
          setCurrentQr(qrReady.qr);
          mark("wait_qr", "ok");

          // 7. Wait scan (no timeout, cancelable)
          mark("wait_scan", "running");
          const scanned = await pollUntil(
            () => readConfig(branchId),
            (v) => {
              if (v.qr && v.qr !== currentQr && v.qr !== qrReady.qr) setCurrentQr(v.qr);
              return v.connected;
            },
            { timeoutMs: 15 * 60_000, intervalMs: 2000, signal }
          ).catch(() => null);
          if (!scanned) {
            mark("wait_scan", "error", "Se agotó el tiempo esperando el escaneo (15 min).");
            throw new Error("scan_timeout");
          }
          setCurrentQr(null);
          mark("wait_scan", "ok");
        }
      }

      // 8. Verify: connected estable 3 muestras + heartbeat < 15s
      mark("verify", "running");
      let stable = 0;
      const verifyStart = Date.now();
      while (stable < 3) {
        if (Date.now() - verifyStart > 60_000) {
          mark("verify", "error", "El estado no permaneció Conectado estable durante 60 s.");
          throw new Error("verify_timeout");
        }
        const v = await readConfig(branchId);
        const age = heartbeatAgeSec(v.lastSeenAt);
        if (v.connected && age !== null && age < 15) stable += 1;
        else stable = 0;
        await sleep(2000, signal);
      }
      mark("verify", "ok");
      mark("done", "ok");
      toast.success(`✅ Bot ${branchName ?? ""} operativo${finalVersion ? ` (v${finalVersion})` : ""}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "cancelled" && msg !== "dispatch_failed" && msg !== "apply_timeout"
        && msg !== "restart_timeout" && msg !== "session_timeout" && msg !== "qr_timeout"
        && msg !== "scan_timeout" && msg !== "verify_timeout") {
        toast.error(msg);
      }
    } finally {
      setRunning(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const activeStep = useMemo(() => STEPS.find(s => status[s.id] === "running")?.id ?? null, [status]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCw className={`h-5 w-5 text-emerald-600 ${running ? "animate-spin" : ""}`} />
            Actualizar y Reconectar Bot {branchName ? `— ${branchName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Ejecuta todos los pasos automáticamente: actualización, reinicio, validación de sesión, QR si aplica y verificación final. No necesitas acceder al servidor.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-2">
          {STEPS.map((s) => {
            const st = status[s.id];
            const isActive = activeStep === s.id;
            return (
              <li key={s.id} className={`flex items-start gap-3 rounded-lg border p-3 ${isActive ? "border-emerald-500 bg-emerald-50" : "bg-card"}`}>
                <div className="mt-0.5">
                  {st === "ok" && <Check className="h-5 w-5 text-emerald-600" />}
                  {st === "error" && <X className="h-5 w-5 text-destructive" />}
                  {st === "running" && <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />}
                  {st === "pending" && <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />}
                  {st === "skipped" && <Check className="h-5 w-5 text-muted-foreground/50" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{s.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {st === "skipped" ? "Omitido (no fue necesario)" : s.hint}
                  </div>
                  {errors[s.id] && (
                    <div className="mt-1 flex items-start gap-1 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{errors[s.id]}</span>
                    </div>
                  )}
                  {s.id === "wait_scan" && st === "running" && currentQr && (
                    <div className="mt-3 grid place-items-center rounded-xl border bg-white p-3">
                      <QRCodeCanvas value={currentQr} size={220} includeMargin />
                      <p className="mt-2 text-xs text-muted-foreground">
                        WhatsApp → ⋮ → Dispositivos vinculados → Vincular un dispositivo
                      </p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {(initialVersion || finalVersion) && (
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            {initialVersion && <>Versión inicial: v{initialVersion}</>}
            {finalVersion && finalVersion !== initialVersion && <> → <b className="text-foreground">v{finalVersion}</b></>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {running ? (
            <Button variant="outline" onClick={cancel}>Cancelar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
              <Button onClick={run} className="bg-emerald-600 hover:bg-emerald-700">
                {status.done === "ok" ? (
                  <><RotateCw className="mr-2 h-4 w-4" /> Ejecutar de nuevo</>
                ) : (
                  <><QrCode className="mr-2 h-4 w-4" /> Iniciar</>
                )}
              </Button>
            </>
          )}
        </div>

        {status.done === "ok" && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <Wifi className="h-5 w-5" />
            Bot completamente operativo. Puedes cerrar esta ventana.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
