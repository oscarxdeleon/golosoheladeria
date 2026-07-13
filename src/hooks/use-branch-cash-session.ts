import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BranchCashSession {
  id: string;
  branch_id: string | null;
  user_id: string;
  user_name: string | null;
  opened_at: string;
  status: string;
}

/**
 * Fuente única de verdad para caja ABIERTA de la sede activa.
 *
 * La caja pertenece a la sede/turno, no al usuario. Por eso NO se consulta la
 * tabla directamente desde el cliente: se usa la RPC SECURITY DEFINER que
 * valida la sede, devuelve la caja abierta aunque la haya creado otro cajero y
 * registra la sincronización automática del usuario actual en audit_log.
 */
export function useBranchCashSession(branchId: string | null | undefined) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["branch-cash-session-open", branchId ?? null] as const, [branchId]);
  const subscriptionRun = useRef(0);

  const query = useQuery({
    queryKey,
    enabled: !!branchId,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 10_000,
    retry: 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sync_active_cash_session", {
        _branch_id: branchId!,
      });
      if (error) throw error;
      return (data as BranchCashSession | null) ?? null;
    },
  });

  useEffect(() => {
    if (!branchId) return;

    let mounted = true;
    const runId = ++subscriptionRun.current;
    const topic = `cash-sessions-branch-${branchId}-${runId}-${Math.random().toString(36).slice(2)}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${branchId}` },
          () => {
            if (!mounted) return;
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ["cash-session-open-branch", branchId] });
          },
        )
        .subscribe((status, error) => {
          if (error) console.warn("[cash-session-realtime]", status, error.message);
        });
    } catch (error) {
      console.warn("[cash-session-realtime] realtime desactivado; se usará refetch automático", error);
      qc.invalidateQueries({ queryKey });
    }

    return () => {
      mounted = false;
      if (channel) {
        void supabase.removeChannel(channel).catch((error) => {
          console.warn("[cash-session-realtime] no se pudo remover el canal", error);
        });
      }
    };
  }, [branchId, qc, queryKey]);

  return {
    session: query.data ?? null,
    isOpen: !!query.data,
    loading: query.isLoading,
    verified: query.isSuccess,
    error: query.error,
    refetch: query.refetch,
  };
}
