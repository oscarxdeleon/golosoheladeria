// Monta el worker de impresión: procesa `print_jobs` pendientes de la sede
// activa. Solo hace trabajo real si esta pestaña tiene LOCAL_PRINT_URL
// configurado (es decir, es la PC del POS con Print Server activo).

import { useEffect } from "react";
import { useBranch } from "@/contexts/branch-context";
import { startPrintQueueWorker, stopPrintQueueWorker } from "@/lib/print-queue";

export function PrintQueueWorker() {
  const { activeBranchId } = useBranch();
  useEffect(() => {
    if (!activeBranchId) return;
    const stop = startPrintQueueWorker(activeBranchId);
    return () => stop();
  }, [activeBranchId]);
  useEffect(() => () => stopPrintQueueWorker(), []);
  return null;
}
