import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Search, History, FileText, Clock, User, Download, ChevronRight,
  TrendingUp, TrendingDown, CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { formatMoney } from "@/lib/format";
import {
  fetchSales, fetchExpenses, fetchPurchases, fetchSaleItemsForSales,
  type CashSessionRow,
} from "@/lib/reports";
import { useAuth } from "@/hooks/use-auth";
import { downloadShiftPdf } from "@/lib/shift-pdf";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reportes/cajas")({
  head: () => ({ meta: [{ title: "Historial de Cajas · Reportes" }] }),
  component: CajasPage,
});

type SessionListItem = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  user_id: string | null;
  user_name: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number | null;
  counted_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  status: string;
  sales_total: number;
};

function CajasPage() {
  const queryClient = useQueryClient();
  const { branches, activeBranchId, setActiveBranchId } = useBranch();
  const { user, isAdmin, roles, loading: authLoading, rolesLoading } = useAuth();
  const isSupervisor = roles.includes("supervisor");
  const canSeeAll = isAdmin || isSupervisor;
  const [branchId, setBranchId] = useState<string>(activeBranchId ?? "all");
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    if (activeBranchId) setBranchId(activeBranchId);
  }, [activeBranchId]);

  const handleBranchChange = (value: string) => {
    setBranchId(value);
    if (value !== "all") setActiveBranchId(value);
  };

  // Admin/Supervisor pueden ver todas las sedes; cajero se limita a la sede
  // activa aunque el selector inicial diga "all".
  const effectiveBranchId = useMemo(() => {
    if (canSeeAll) return branchId === "all" ? null : branchId;
    return branchId === "all" ? (activeBranchId ?? null) : branchId;
  }, [canSeeAll, branchId, activeBranchId]);

  const rpcParams = useMemo(() => ({
    _branch_id: effectiveBranchId,
    _from: from ? new Date(from).toISOString() : null,
    _to: to ? new Date(new Date(to).getTime() + 86400000 - 1).toISOString() : null,
    _status: status === "all" ? null : status,
  }), [effectiveBranchId, from, to, status]);

  useEffect(() => {
    if (!effectiveBranchId) return;
    const invalidateCajas = () => {
      void queryClient.invalidateQueries({ queryKey: ["reportes.cajas.rpc"] });
      void queryClient.invalidateQueries({ queryKey: ["reportes.session.detail"] });
    };
    const channel = supabase
      .channel(`cash-reports-sync-${effectiveBranchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions", filter: `branch_id=eq.${effectiveBranchId}` }, invalidateCajas)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `branch_id=eq.${effectiveBranchId}` }, invalidateCajas)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, invalidateCajas)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `branch_id=eq.${effectiveBranchId}` }, invalidateCajas)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_deposits", filter: `branch_id=eq.${effectiveBranchId}` }, invalidateCajas)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases", filter: `branch_id=eq.${effectiveBranchId}` }, invalidateCajas)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [effectiveBranchId, queryClient]);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["reportes.cajas.rpc", user?.id ?? "anon", rpcParams],
    // Esperar a que la sesión y los roles estén cargados; de lo contrario
    // la primera petición sale sin bearer o antes de conocer el rol y
    // devuelve 401/vacío, y React Query cachea ese estado.
    enabled: !authLoading && !rolesLoading && !!user?.id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_cash_sessions_list_rpc", rpcParams as never);
      if (error) throw error;
      return (data ?? []) as unknown as SessionListItem[];
    },
  });

  const visibleSessions = useMemo(() => {
    const uid = user?.id ?? null;
    return sessions.filter((s) => {
      if (!canSeeAll && uid && s.user_id !== uid) return false;
      if (search) {
        const hay = `${s.user_name ?? ""} ${s.branch_name ?? ""}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [sessions, search, canSeeAll, user?.id]);

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-10">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-extrabold leading-tight">Historial de Cierres</h1>
            <p className="text-sm text-muted-foreground">Consulta y descarga los reportes de arqueos anteriores.</p>
          </div>
        </div>
      </div>

      {/* Filtros compactos */}
      <Card className="rounded-2xl">
        <CardContent className="p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9 rounded-xl" placeholder="Buscar cajero o sede" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={branchId} onValueChange={handleBranchChange}>
            <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sede" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las sedes</SelectItem>
              {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="open">Abiertos</SelectItem>
              <SelectItem value="closed">Cerrados</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl" />
          </div>
        </CardContent>
      </Card>

      {/* Título registros */}
      <Card className="rounded-2xl bg-muted/30 border-dashed">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <div className="font-bold text-base">Registros de Cierre</div>
            <div className="text-sm text-muted-foreground">Lista de todas las sesiones de caja finalizadas.</div>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <div className="space-y-4">
        {isLoading && <Card><CardContent className="py-8 text-center text-muted-foreground">Cargando…</CardContent></Card>}
        {!isLoading && visibleSessions.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Sin cierres para los filtros.</CardContent></Card>
        )}
        {visibleSessions.map((s) => (
          <SessionCard
            key={s.id}
            session={s}
            branchName={s.branch_name ?? branchName(s.branch_id)}
            canSeeFinancials={canSeeAll}
          />
        ))}
      </div>
    </div>
  );
}

function SessionCard({
  session, branchName, canSeeFinancials,
}: { session: SessionListItem; branchName: string; canSeeFinancials: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const diff = Number(session.difference ?? 0);
  const finalAmount = Number(session.counted_amount ?? 0);
  const salesTotal = Number(session.sales_total ?? 0);

  async function handlePdf() {
    setDownloading(true);
    try {
      // Datos crudos on-demand SOLO para el PDF
      const [sales, expenses, purchases] = await Promise.all([
        fetchSales({ cashSessionId: session.id }),
        fetchExpenses({ cashSessionId: session.id }),
        fetchPurchases({ cashSessionId: session.id }),
      ]);
      const ids = sales.filter((x) => x.status !== "cancelled").map((x) => x.id);
      const items = ids.length ? await fetchSaleItemsForSales(ids) : [];
      // shift-pdf espera CashSessionRow con todos los campos
      const fullSession = {
        ...session,
        nequi_counted: null,
        bancolombia_counted: null,
        opening_notes: null,
        closing_notes: null,
      } as unknown as CashSessionRow;
      await downloadShiftPdf({
        session: fullSession, branchName,
        turnNumber: session.id.slice(0, 3).toUpperCase(),
        sales, items, expenses, purchases,
      });
      toast.success("PDF generado");
    } catch (e) {
      toast.error("No se pudo generar el PDF", { description: (e as Error).message });
    } finally {
      setDownloading(false);
    }
  }

  const diffBadge = diff === 0 ? {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    text: "Cuadró",
    className: "bg-emerald-50 border-emerald-200 text-emerald-700",
  } : diff > 0 ? {
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    text: `+${formatMoney(diff)}`,
    className: "bg-amber-50 border-amber-200 text-amber-700",
  } : {
    icon: <TrendingDown className="h-3.5 w-3.5" />,
    text: formatMoney(diff),
    className: "bg-rose-50 border-rose-200 text-rose-700",
  };

  return (
    <Card className="rounded-2xl shadow-sm overflow-hidden">
      <CardContent className="p-4 space-y-3">
        {/* Fechas */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <Clock className="h-3 w-3" /> Apertura
            </div>
            <div className="mt-1 font-display font-bold text-base leading-tight">
              {format(new Date(session.opened_at), "d MMM yyyy, HH:mm", { locale: es })}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Cierre
            </div>
            <div className="mt-1 font-display font-bold text-base leading-tight">
              {session.closed_at
                ? format(new Date(session.closed_at), "d MMM yyyy, HH:mm", { locale: es })
                : <span className="text-emerald-600">— abierto —</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <User className="h-3.5 w-3.5" /> {session.user_name ?? "—"}
          <span className="mx-1">·</span>
          <span className="truncate">{branchName}</span>
        </div>

        {/* Panel de montos */}
        <div className="rounded-2xl bg-muted/30 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Monto Inicial</div>
              <div className="mt-1 font-display text-lg font-bold">{formatMoney(session.opening_amount)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ventas</div>
              <div className="mt-1 font-display text-lg font-extrabold text-emerald-700">{formatMoney(salesTotal)}</div>
            </div>
          </div>
          <div className="border-t border-dashed" />
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Monto Final</div>
            <div className="font-display text-xl font-extrabold text-primary">{formatMoney(finalAmount)}</div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${diffBadge.className}`}>
            {diffBadge.icon}{diffBadge.text}
          </span>
          <Button
            onClick={handlePdf}
            disabled={downloading}
            variant="outline"
            size="sm"
            className="rounded-xl border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 gap-1.5 font-semibold"
          >
            <Download className="h-4 w-4" />{downloading ? "…" : "PDF"}
          </Button>
          <Link to="/reportes/cajas/$id" params={{ id: session.id }} className="ml-auto">
            <Button size="sm" className="rounded-xl bg-primary/10 text-primary hover:bg-primary/20 gap-1 font-semibold shadow-none">
              Ver Detalles <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
