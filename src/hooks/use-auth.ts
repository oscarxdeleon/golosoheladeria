import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "cajero" | "mesero" | "domiciliario";

export interface AppProfile {
  id: string;
  full_name: string;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setRoles([]);
      setRolesLoading(false);
      return;
    }
    let alive = true;
    setRolesLoading(true);
    (async () => {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("id,full_name").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      if (!alive) return;
      setProfile(p as AppProfile | null);
      setRoles((r ?? []).map((x: { role: AppRole }) => x.role));
      setRolesLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  const isAdmin = roles.includes("admin");
  const primaryRole: AppRole = roles[0] ?? "cajero";
  return { session, user, profile, roles, isAdmin, primaryRole, loading, rolesLoading };
}

