import { WifiOff } from "lucide-react";
import { useConnectionStatus } from "@/hooks/use-connection-status";

/**
 * Banner global que aparece cuando el navegador está sin conexión o el
 * backend no responde. Se ancla arriba y permite que la app siga navegando
 * en modo lectura con los datos cacheados en IndexedDB.
 */
export function OfflineBanner() {
  const status = useConnectionStatus();
  if (status.state !== "offline") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-2 z-[9999] -translate-x-1/2 rounded-full border border-amber-600/60 bg-amber-950/95 px-4 py-1.5 text-xs font-medium text-amber-100 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-3.5 w-3.5" />
        <span>Sin conexión — modo lectura. No puedes cobrar ni enviar comandas.</span>
      </div>
    </div>
  );
}
