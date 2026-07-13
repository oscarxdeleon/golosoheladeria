import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Branch {
  id: string;
  name: string;
  slug: string | null;
  is_main: boolean | null;
  city: string | null;
  address?: string | null;
  phone?: string | null;
  neighborhood?: string | null;
  nit?: string | null;
  ticket_header?: string | null;
  ticket_footer?: string | null;
  logo_url?: string | null;
  email?: string | null;
}

interface BranchContextValue {
  branches: Branch[];
  activeBranchId: string | null;
  activeBranch: Branch | null;
  setActiveBranchId: (id: string) => void;
  loading: boolean;
  lockedToBranch: boolean;
}

const BranchContext = createContext<BranchContextValue | null>(null);
const STORAGE_KEY = "goloso.activeBranchId";

export function BranchProvider({ children }: { children: ReactNode }) {
  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(null);

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches-all"],
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("branches")
        .select("id,name,slug,is_main,city,address,phone,neighborhood,nit,ticket_header,ticket_footer,logo_url,email")
        .order("is_main", { ascending: false })
        .order("name");
      return (data ?? []) as Branch[];
    },
  });

  // Sede asignada al usuario actual + si es admin. Los usuarios no-admin
  // quedan bloqueados a su sede para que el notifier en tiempo real escuche
  // SU branch_id y los pedidos no se filtren a la sede equivocada.
  const { data: userScope } = useQuery({
    queryKey: ["branch-user-scope"],
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return { userId: null as string | null, branchId: null as string | null, isAdmin: false };
      const [{ data: prof }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("branch_id").eq("id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);
      const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
      return { userId: uid, branchId: (prof?.branch_id as string | null) ?? null, isAdmin };
    },
  });

  const userId = userScope?.userId ?? null;
  const profileBranchId = userScope?.branchId ?? null;
  const isAdmin = userScope?.isAdmin ?? false;
  const lockedToBranch = !isAdmin && !!profileBranchId;
  const storageKey = userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;

  useEffect(() => {
    if (branches.length === 0 || !userScope) return;

    // No-admin: forzar la sede asignada e ignorar el localStorage.
    if (lockedToBranch && profileBranchId && branches.some((b) => b.id === profileBranchId)) {
      setActiveBranchIdState(profileBranchId);
      if (typeof window !== "undefined") localStorage.setItem(storageKey, profileBranchId);
      return;
    }

    // La sede activa se guarda por usuario. Usar una sola clave global hacía que
    // el Administrador heredara la sede de un Cajero anterior en el mismo equipo
    // y consultara una caja distinta, mostrando falsamente "Caja cerrada".
    const saved = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    if (saved && branches.some((b) => b.id === saved)) {
      setActiveBranchIdState(saved);
      return;
    }
    // Admin sin selección guardada: preferir su sede asignada antes que la principal.
    if (profileBranchId && branches.some((b) => b.id === profileBranchId)) {
      setActiveBranchIdState(profileBranchId);
      return;
    }
    const main = branches.find((b) => b.is_main) ?? branches[0];
    setActiveBranchIdState(main.id);
  }, [branches, profileBranchId, lockedToBranch, storageKey, userScope]);

  const setActiveBranchId = (id: string) => {
    // Bloquear a no-admin de cambiar de sede.
    if (lockedToBranch && profileBranchId && id !== profileBranchId) return;
    setActiveBranchIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(storageKey, id);
  };

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  // No-admin: ocultar otras sedes del listado expuesto al resto de la app.
  const visibleBranches = lockedToBranch && profileBranchId
    ? branches.filter((b) => b.id === profileBranchId)
    : branches;

  return (
    <BranchContext.Provider
      value={{ branches: visibleBranches, activeBranchId, activeBranch, setActiveBranchId, loading: isLoading, lockedToBranch }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
