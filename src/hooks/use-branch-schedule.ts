import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getChannelStatus,
  normalizeSchedules,
  type BranchSchedules,
  type ChannelStatus,
  type ScheduleChannel,
} from "@/lib/schedules";

async function fetchBranchSchedules(branchId: string): Promise<BranchSchedules> {
  const { data } = await supabase
    .from("branches")
    .select("schedules")
    .eq("id", branchId)
    .maybeSingle();
  return normalizeSchedules((data as { schedules?: unknown } | null)?.schedules);
}

/** Consulta cacheada de los horarios de una sede. */
export function useBranchSchedules(branchId: string | null | undefined) {
  return useQuery({
    queryKey: ["branch-schedules", branchId],
    enabled: !!branchId,
    staleTime: 60_000,
    queryFn: () => fetchBranchSchedules(branchId!),
  });
}

/** Estado en vivo del canal, se recalcula cada minuto. */
export function useChannelStatus(
  schedules: BranchSchedules | undefined,
  channel: ScheduleChannel,
): ChannelStatus {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const s = schedules ?? normalizeSchedules(undefined);
  return getChannelStatus(s, channel, now);
}

/** Atajo para el canal físico de una sede. */
export function usePhysicalChannelStatus(branchId: string | null | undefined) {
  const { data } = useBranchSchedules(branchId);
  return useChannelStatus(data, "physical");
}

/** Atajo para el canal online de una sede. */
export function useOnlineChannelStatus(branchId: string | null | undefined) {
  const { data } = useBranchSchedules(branchId);
  return useChannelStatus(data, "online");
}
