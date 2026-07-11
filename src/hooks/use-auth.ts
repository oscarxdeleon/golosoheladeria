import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "cajero" | "mesero" | "domiciliario";

export interface AppProfile {
  id: string;
  full_name: string;
}

// Estado de sesión compartido entre todos los consumidores de useAuth para
// evitar que cada componente montado dispare su propia suscripción y
// re-consulta de user_roles/profiles (esa era la mayor fuente de queries
// repetidas al backend — miles de SELECT sobre user_roles por hora).
let cachedSession: Session | null = null;
let sessionInitialized = false;
const sessionListeners = new Set<(s: Session | null) => void>();
let authSub: { unsubscribe: () => void } | null = null;

function notify(s: Session | null) {
  cachedSession = s;
  sessionListeners.forEach((fn) => fn(s));
}

function ensureAuthSubscription() {
  if (authSub) return;
  supabase.auth.getSession().then(({ data }) => {
    sessionInitialized = true;
    notify(data.session);
  });
  const { data } = supabase.auth.onAuthStateChange((_event, s) => {
    sessionInitialized = true;
    notify(s);
  });
  authSub = data.subscription;
}

export function useAuth() {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(cachedSession);
  const [ready, setReady] = useState(sessionInitialized);

  useEffect(() => {
    ensureAuthSubscription();
    const listener = (s: Session | null) => {
      setSession(s);
      setReady(true);
    };
    sessionListeners.add(listener);
    if (sessionInitialized) {
      setSession(cachedSession);
      setReady(true);
    }
    return () => {
      sessionListeners.delete(listener);
    };
  }, []);

  const user = session?.user ?? null;
  const userId = user?.id ?? null;

  // Profile y roles compartidos vía React Query: una sola petición por usuario
  // aunque N componentes llamen useAuth simultáneamente.
  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ["auth-profile", userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,full_name")
        .eq("id", userId!)
        .maybeSingle();
      return (data as AppProfile | null) ?? null;
    },
  });

  const { data: rolesData, isLoading: rolesQueryLoading } = useQuery({
    queryKey: ["auth-roles", userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!);
      const list = (data ?? []).map((x: { role: AppRole }) => x.role);
      return list.includes("admin")
        ? (["admin", ...list.filter((r) => r !== "admin")] as AppRole[])
        : list;
    },
  });

  // Invalidar caches de perfil/roles cuando cambia la identidad.
  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      qc.removeQueries({ queryKey: ["auth-profile"] });
      qc.removeQueries({ queryKey: ["auth-roles"] });
    }
  }, [ready, userId, qc]);

  const roles: AppRole[] = rolesData ?? [];
  const profile = profileData ?? null;
  const loading = !ready;
  const rolesLoading = !!userId && (rolesQueryLoading || profileLoading);
  const isAdmin = roles.includes("admin");
  const primaryRole: AppRole = roles[0] ?? "cajero";

  return { session, user, profile, roles, isAdmin, primaryRole, loading, rolesLoading };
}
