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
 * Devuelve la sesión de caja ABIERTA de la sede indicada (compartida por todos
 * los empleados de esa sede) y se suscribe a Realtime para reaccionar a
 * aperturas y cierres en tiempo real.
 */
export function useBranchCashSession(branchId: string | null | undefined) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["branch-cash-session-open", branchId ?? null] as const, [branchId]);
  const subscriptionRun = useRef(0);

  const query = useQuery({
    queryKey,
    enabled: !!branchId,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("cash_sessions")
        .select("id,branch_id,user_id,user_name,opened_at,status")
        .eq("branch_id", branchId!)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
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
  };
}
