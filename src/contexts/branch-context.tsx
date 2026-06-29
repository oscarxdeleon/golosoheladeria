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
}

interface BranchContextValue {
  branches: Branch[];
  activeBranchId: string | null;
  activeBranch: Branch | null;
  setActiveBranchId: (id: string) => void;
  loading: boolean;
}

const BranchContext = createContext<BranchContextValue | null>(null);
const STORAGE_KEY = "goloso.activeBranchId";

export function BranchProvider({ children }: { children: ReactNode }) {
  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(null);

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ["branches-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("branches")
        .select("id,name,slug,is_main,city,address,phone,neighborhood,nit,ticket_header,ticket_footer")
        .order("is_main", { ascending: false })
        .order("name");
      return (data ?? []) as Branch[];
    },
  });


  useEffect(() => {
    if (branches.length === 0) return;
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved && branches.some((b) => b.id === saved)) {
      setActiveBranchIdState(saved);
    } else {
      const main = branches.find((b) => b.is_main) ?? branches[0];
      setActiveBranchIdState(main.id);
    }
  }, [branches]);

  const setActiveBranchId = (id: string) => {
    setActiveBranchIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  };

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  return (
    <BranchContext.Provider
      value={{ branches, activeBranchId, activeBranch, setActiveBranchId, loading: isLoading }}
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
