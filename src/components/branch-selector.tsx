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
      <div className="flex h-11 items-center gap-2 rounded-xl border-2 border-primary/40 bg-background px-3 text-sm font-semibold text-muted-foreground">
        <Building2 className="h-5 w-5" />
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
        className="flex h-11 items-center gap-2 rounded-xl border-2 border-primary/50 bg-primary/10 px-3.5 text-[15px] font-extrabold uppercase tracking-wide text-primary shadow-sm"
        title="Sede asignada a tu usuario"
      >
        <Building2 className="h-5 w-5" />
        <span className="max-w-[180px] truncate">{activeBranch?.name ?? "Sede asignada"}</span>
      </div>
    );
  }

  return (
    <Select value={activeBranchId ?? undefined} onValueChange={setActiveBranchId}>
      <SelectTrigger className="h-11 min-w-[220px] gap-2 rounded-xl border-2 border-primary/50 bg-primary/10 px-3.5 text-[15px] font-extrabold uppercase tracking-wide text-primary shadow-sm hover:bg-primary/15 focus:ring-2 focus:ring-primary/40 [&>span]:truncate">
        <Building2 className="h-5 w-5 shrink-0" />
        <SelectValue placeholder="Selecciona sede" />
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id} className="text-sm font-semibold">
            {b.name}
            {b.is_main ? " · Principal" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
