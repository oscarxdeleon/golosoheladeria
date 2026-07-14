// Indicador visual del estado de auto-detección de sede.
// Se muestra en el header de la tablet de Meseros.

import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { useBranchAutoDetect } from "@/hooks/use-branch-auto-detect";

export function BranchAutoDetectBadge() {
  const { status, detected, reprobe } = useBranchAutoDetect({ autoSwitch: true });

  const label =
    status === "probing"
      ? "Detectando sede…"
      : status === "detected" && detected
        ? `Auto: ${detected.printerName}`
        : "Sin detección automática";

  const tone =
    status === "detected"
      ? "border-success/50 bg-success/10 text-success"
      : status === "probing"
        ? "border-muted-foreground/30 bg-muted text-muted-foreground"
        : "border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200";

  const Icon =
    status === "probing" ? Loader2 : status === "detected" ? Wifi : WifiOff;

  return (
    <button
      type="button"
      onClick={reprobe}
      title={
        detected
          ? `Sede detectada por Print Server (${detected.printUrl}). Click para re-detectar.`
          : "No se detectó Print Server local. Click para reintentar."
      }
      className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}
    >
      <Icon className={`h-3.5 w-3.5 ${status === "probing" ? "animate-spin" : ""}`} />
      <span className="max-w-[140px] truncate">{label}</span>
    </button>
  );
}
