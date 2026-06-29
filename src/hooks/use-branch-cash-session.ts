import { useEffect } from "react";
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
  const queryKey = ["branch-cash-session-open", branchId ?? null];

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
    const channel = supabase
      .channel(`cash-sessions-branch-${branchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${branchId}` },
        () => {
          qc.invalidateQueries({ queryKey });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  return {
    session: query.data ?? null,
    isOpen: !!query.data,
    loading: query.isLoading,
  };
}
