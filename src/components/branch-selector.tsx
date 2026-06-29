import { Building2 } from "lucide-react";
import { useBranch } from "@/contexts/branch-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BranchSelector() {
  const { branches, activeBranchId, setActiveBranchId, loading } = useBranch();

  if (loading && branches.length === 0) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs text-muted-foreground">
        <Building2 className="h-4 w-4" />
        Cargando sedes…
      </div>
    );
  }

  if (branches.length === 0) return null;

  return (
    <Select value={activeBranchId ?? undefined} onValueChange={setActiveBranchId}>
      <SelectTrigger className="h-9 w-[180px] gap-2 bg-background">
        <Building2 className="h-4 w-4 text-primary" />
        <SelectValue placeholder="Selecciona sede" />
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
            {b.is_main ? " · Principal" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
