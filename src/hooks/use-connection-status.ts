import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ConnectionState = "online" | "offline" | "syncing" | "degraded";

interface Status {
  state: ConnectionState;
  lastSyncAt: Date | null;
  lastLatencyMs: number | null;
  browserOnline: boolean;
  dbReachable: boolean;
  pendingCount: number;
}

const PING_INTERVAL = 30_000;
const PING_TIMEOUT = 6_000;

export function useConnectionStatus(): Status & { refresh: () => Promise<void> } {
  const [status, setStatus] = useState<Status>({
    state: typeof navigator !== "undefined" && navigator.onLine ? "syncing" : "offline",
    lastSyncAt: null,
    lastLatencyMs: null,
    browserOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    dbReachable: false,
    pendingCount: 0,
  });
  const pingingRef = useRef(false);

  const ping = useCallback(async () => {
    if (pingingRef.current) return;
    pingingRef.current = true;
    const browserOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

    if (!browserOnline) {
      setStatus((s) => ({ ...s, state: "offline", browserOnline: false, dbReachable: false }));
      pingingRef.current = false;
      return;
    }

    setStatus((s) => ({ ...s, state: s.state === "offline" ? "syncing" : s.state }));
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
      // Lightweight query — heartbeat against RLS-protected table with limit 1
      const { error } = await supabase.from("settings").select("id").limit(1).abortSignal(controller.signal);
      clearTimeout(timer);
      const latency = Math.round(performance.now() - start);
      if (error) throw error;
      setStatus({
        state: latency > 2000 ? "degraded" : "online",
        lastSyncAt: new Date(),
        lastLatencyMs: latency,
        browserOnline: true,
        dbReachable: true,
        pendingCount: 0,
      });
    } catch {
      setStatus((s) => ({
        ...s,
        state: "offline",
        browserOnline,
        dbReachable: false,
        lastLatencyMs: Math.round(performance.now() - start),
      }));
    } finally {
      pingingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void ping();
    const id = setInterval(ping, PING_INTERVAL);
    const onOnline = () => void ping();
    const onOffline = () =>
      setStatus((s) => ({ ...s, state: "offline", browserOnline: false, dbReachable: false }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const onVis = () => {
      if (document.visibilityState === "visible") void ping();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ping]);

  return { ...status, refresh: ping };
}
