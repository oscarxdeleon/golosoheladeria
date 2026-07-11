import { useConnectionStatus, type ConnectionState } from "@/hooks/use-connection-status";
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";

const LABEL: Record<ConnectionState, string> = {
  online: "En línea",
  offline: "Sin conexión",
  syncing: "Sincronizando…",
  degraded: "Conexión lenta",
};

const DOT: Record<ConnectionState, string> = {
  online: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]",
  offline: "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.25)] animate-pulse",
  syncing: "bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.25)] animate-pulse",
  degraded: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.25)]",
};

function fmtTime(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ConnectionStatus() {
  const { state, lastSyncAt, lastLatencyMs, browserOnline, refresh } = useConnectionStatus();
  const { state: sidebarState } = useSidebar();
  const collapsed = sidebarState === "collapsed";

  const Icon =
    state === "offline" ? WifiOff : state === "syncing" ? RefreshCw : state === "degraded" ? AlertTriangle : Wifi;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label={`Estado de conexión: ${LABEL[state]}`}
            className={`group flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted ${
              collapsed ? "w-full justify-center" : "w-full justify-start"
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${DOT[state]}`} />
            {!collapsed && (
              <>
                <Icon className={`h-3.5 w-3.5 ${state === "syncing" ? "animate-spin" : ""}`} />
                <span className="truncate">{LABEL[state]}</span>
              </>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          <div className="space-y-1">
            <div className="font-semibold">{LABEL[state]}</div>
            <div>Navegador: {browserOnline ? "en línea" : "sin red"}</div>
            <div>Última sincronización: {fmtTime(lastSyncAt)}</div>
            {lastLatencyMs != null && <div>Latencia: {lastLatencyMs} ms</div>}
            <div className="text-muted-foreground mt-1">Clic para verificar ahora</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
