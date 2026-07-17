// Hook para tablets (Mesero) y cualquier estación fija: detecta la sede a
// partir del Print Server local y, si difiere de la sede activa actual,
// la cambia automáticamente y actualiza LOCAL_PRINT_URL (para que las
// comandas se impriman en la impresora de esa sede).
//
// Se ejecuta al montar, ante `online`, cambios de visibilidad y cada 60s.

import { useEffect, useRef, useState } from "react";
import { useBranch } from "@/contexts/branch-context";
import { useAuth } from "@/hooks/use-auth";
import {
  detectBranchByLocalPrintServer,
  logDetection,
  type DetectedBranch,
} from "@/lib/branch-detector";

export interface BranchAutoDetectState {
  status: "idle" | "probing" | "detected" | "not-found";
  detected: DetectedBranch | null;
  lastCheckAt: number | null;
  reprobe: () => void;
}

interface Options {
  /** Si es false, no cambia la sede activa aunque detecte otra (solo informa). */
  autoSwitch?: boolean;
  intervalMs?: number;
}

export function useBranchAutoDetect(opts: Options = {}): BranchAutoDetectState {
  const { autoSwitch = true, intervalMs = 60_000 } = opts;
  const { activeBranchId, branches, setActiveBranchId, lockedToBranch } = useBranch();
  const { user } = useAuth();
  const [state, setState] = useState<BranchAutoDetectState>({
    status: "idle",
    detected: null,
    lastCheckAt: null,
    reprobe: () => {},
  });
  const lastLoggedBranchRef = useRef<string | null>(null);
  const activeBranchIdRef = useRef(activeBranchId);
  const branchesRef = useRef(branches);
  const lockedToBranchRef = useRef(lockedToBranch);

  useEffect(() => {
    activeBranchIdRef.current = activeBranchId;
    branchesRef.current = branches;
    lockedToBranchRef.current = lockedToBranch;
  }, [activeBranchId, branches, lockedToBranch]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function run(force = false) {
      if (cancelled) return;
      setState((s) => ({ ...s, status: "probing" }));
      const detected = await detectBranchByLocalPrintServer({ force });
      if (cancelled) return;
      const now = Date.now();
      if (!detected) {
        setState((s) => ({ ...s, status: "not-found", detected: null, lastCheckAt: now }));
        return;
      }
      // Actualizar LOCAL_PRINT_URL para que print-client apunte a la impresora
      // de la sede detectada. Esto hace que las comandas del Mesero se emitan
      // siempre en la impresora local correcta, sin importar en qué sede se
      // conecte la tablet.
      try {
        if (typeof window !== "undefined") {
          const prev = window.localStorage.getItem("LOCAL_PRINT_URL");
          if (prev !== detected.printUrl) {
            window.localStorage.setItem("LOCAL_PRINT_URL", detected.printUrl);
          }
        }
      } catch {
        /* noop */
      }

      const currentBranchId = activeBranchIdRef.current;
      const exists = branchesRef.current.some((b) => b.id === detected.branchId);
      if (autoSwitch && exists && detected.branchId !== currentBranchId) {
        // Meseros están "lockedToBranch" a su perfil; setActiveBranchId
        // ignora cambios que no coincidan. En ese caso solo informamos.
        if (!lockedToBranchRef.current) {
          setActiveBranchId(detected.branchId);
        }
      }

      if (lastLoggedBranchRef.current !== detected.branchId) {
        lastLoggedBranchRef.current = detected.branchId;
        void logDetection({
          userId: user?.id ?? null,
          branchId: detected.branchId,
          method: detected.method,
          probeUrl: detected.printUrl,
          success: true,
        });
      }

      setState({
        status: "detected",
        detected,
        lastCheckAt: now,
        reprobe: () => void run(true),
      });
    }

    void run(true);

    timer = setInterval(() => void run(false), intervalMs);
    const onOnline = () => void run(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run(true);
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // branches/activeBranchId cambian mucho; usamos referencias vivas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSwitch, intervalMs, user?.id]);

  return {
    ...state,
    reprobe: () => {
      lastLoggedBranchRef.current = null;
      import("@/lib/branch-detector").then(async (m) => {
        m.clearBranchDetectionCache();
        const detected = await m.detectBranchByLocalPrintServer({ force: true });
        const now = Date.now();
        if (detected) {
          const exists = branchesRef.current.some((b) => b.id === detected.branchId);
          if (autoSwitch && exists && !lockedToBranchRef.current) {
            setActiveBranchId(detected.branchId);
          }
          setState({ status: "detected", detected, lastCheckAt: now, reprobe: () => {} });
        } else {
          setState((s) => ({ ...s, status: "not-found", detected: null, lastCheckAt: now }));
        }
      });
      setState((s) => ({ ...s, status: "probing" }));
    },
  };
}
