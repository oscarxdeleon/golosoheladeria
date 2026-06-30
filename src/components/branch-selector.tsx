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
  const { branches, activeBranchId, activeBranch, setActiveBranchId, loading, lockedToBranch } = useBranch();

  if (loading && branches.length === 0) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-xs text-muted-foreground">
        <Building2 className="h-4 w-4" />
        Cargando sedes…
      </div>
    );
  }

  if (branches.length === 0) return null;

  // Usuarios no-admin (cajero, mesero, domiciliario, etc.) quedan fijados
  // a su sede asignada. No deben ver selector ni listado de otras sedes.
  if (lockedToBranch) {
    return (
      <div
        className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-xs font-semibold uppercase tracking-wide text-foreground"
        title="Sede asignada a tu usuario"
      >
        <Building2 className="h-4 w-4 text-primary" />
        {activeBranch?.name ?? "Sede asignada"}
      </div>
    );
  }

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
