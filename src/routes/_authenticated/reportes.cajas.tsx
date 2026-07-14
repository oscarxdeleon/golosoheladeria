import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Search, CheckCircle2, AlertTriangle, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranch } from "@/contexts/branch-context";
import { formatMoney } from "@/lib/format";
import { fetchCashSessions, fetchSales } from "@/lib/reports";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/reportes/cajas")({
  head: () => ({ meta: [{ title: "Historial de Cajas · Reportes" }] }),
  component: CajasPage,
});

function CajasPage() {
  const { branches, activeBranchId } = useBranch();
  const { user, isAdmin } = useAuth();
  const [branchId, setBranchId] = useState<string>(activeBranchId ?? "all");
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const filters = useMemo(() => ({
    branchId: branchId === "all" ? null : branchId,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(new Date(to).getTime() + 86400000 - 1).toISOString() : undefined,
    userId: isAdmin ? null : (user?.id ?? null),
  }), [branchId, from, to, isAdmin, user?.id]);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["reportes.cajas", filters],
    queryFn: () => fetchCashSessions(filters),
  });

  // Ventas por sesión para mostrar totales
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const { data: allSales = [] } = useQuery({
    queryKey: ["reportes.cajas.sales", sessionIds.length, sessionIds[0]],
    queryFn: () => fetchSales({ branchId: filters.branchId, from: filters.from, to: filters.to }),
    enabled: sessionIds.length > 0,
  });
  const salesBySession = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of allSales) {
      if (s.status === "cancelled" || !s.cash_session_id) continue;
      map.set(s.cash_session_id, (map.get(s.cash_session_id) ?? 0) + Number(s.total ?? 0));
    }
    return map;
  }, [allSales]);

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (search) {
        const hay = `${s.user_name ?? ""} ${branchName(s.branch_id)}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [sessions, status, search, branches]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div>
            <label className="text-xs text-muted-foreground">Buscar</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Usuario o sede" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Sede</label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Estado</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">Abiertos</SelectItem>
                <SelectItem value="closed">Cerrados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Desde</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Hasta</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{filtered.length} cierres</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sede</TableHead>
                <TableHead>Turno</TableHead>
                <TableHead>Apertura</TableHead>
                <TableHead>Cierre</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Inicial</TableHead>
                <TableHead className="text-right">Ventas</TableHead>
                <TableHead className="text-right">Declarado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Cargando…</TableCell></TableRow>}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Sin cierres para los filtros.</TableCell></TableRow>
              )}
              {filtered.map((s, i) => {
                const salesTotal = salesBySession.get(s.id) ?? 0;
                const diff = Number(s.difference ?? 0);
                const diffIcon = diff === 0 ? CheckCircle2 : Circle;
                const diffColor = diff === 0 ? "text-emerald-600" : diff > 0 ? "text-amber-600" : "text-rose-600";
                const turnNumber = filtered.length - i;
                return (
                  <TableRow key={s.id} className="hover:bg-muted/40">
                    <TableCell>{branchName(s.branch_id)}</TableCell>
                    <TableCell>
                      <Link to="/reportes/cajas/$id" params={{ id: s.id }} className="font-semibold text-primary hover:underline">
                        #{turnNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{s.user_name ?? "—"}</div>
                      <div className="text-muted-foreground">{format(new Date(s.opened_at), "dd/MM/yyyy HH:mm")}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.closed_at ? (
                        <>
                          <div className="font-medium">{s.user_name ?? "—"}</div>
                          <div className="text-muted-foreground">{format(new Date(s.closed_at), "dd/MM/yyyy HH:mm")}</div>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === "open" ? "outline" : "secondary"}>
                        {s.status === "open" ? "Abierto" : "Cerrado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(s.opening_amount)}</TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(salesTotal)}</TableCell>
                    <TableCell className="text-right">{formatMoney(s.counted_amount ?? 0)}</TableCell>
                    <TableCell className={`text-right font-semibold flex items-center justify-end gap-1 ${diffColor}`}>
                      {diff !== 0 && <AlertTriangle className="h-3 w-3" />}
                      {diff === 0 && <diffIcon className="h-3 w-3" />}
                      {formatMoney(diff)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
