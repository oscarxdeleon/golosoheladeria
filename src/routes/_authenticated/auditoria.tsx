import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { History, ChevronDown, RefreshCw, Ban, AlertTriangle } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({ meta: [{ title: "Auditoría · Goloso POS" }] }),
  component: AuditoriaPage,
});

interface AuditRow {
  id: string;
  entity: string;
  entity_id: string;
  action: string;
  user_id: string | null;
  user_name: string | null;
  branch_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

const ENTITIES = [
  { value: "all", label: "Todas las entidades" },
  { value: "product", label: "Productos" },
  { value: "category", label: "Categorías" },
  { value: "modifier", label: "Modificadores" },
  { value: "modifier_group", label: "Grupos de modificadores" },
  { value: "table", label: "Mesas" },
];

const ACTIONS = [
  { value: "all", label: "Todas las acciones" },
  { value: "created", label: "Creación" },
  { value: "updated", label: "Actualización" },
  { value: "deleted", label: "Eliminación" },
  { value: "fields_synced", label: "Sincronización" },
  { value: "fields_updated", label: "Cambio directo" },
];

function actionBadge(action: string) {
  const map: Record<string, string> = {
    created: "bg-emerald-500/15 text-emerald-700",
    updated: "bg-blue-500/15 text-blue-700",
    deleted: "bg-destructive/15 text-destructive",
    fields_synced: "bg-purple-500/15 text-purple-700",
    fields_updated: "bg-amber-500/15 text-amber-700",
  };
  return map[action] ?? "bg-muted text-muted-foreground";
}

function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: { key: string; from: unknown; to: unknown }[] = [];
  keys.forEach((k) => {
    if (["updated_at", "created_at", "id"].includes(k)) return;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      out.push({ key: k, from: before[k], to: after[k] });
    }
  });
  return out;
}

export function AuditoriaPage() {
  const { activeBranchId, activeBranch } = useBranch();
  const [entity, setEntity] = useState("all");
  const [action, setAction] = useState("all");
  const [search, setSearch] = useState("");

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-log", activeBranchId, entity, action],
    queryFn: async () => {
      let q = supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (entity !== "all") q = q.eq("entity", entity);
      if (action !== "all") q = q.eq("action", action);
      if (activeBranchId) q = q.or(`branch_id.eq.${activeBranchId},branch_id.is.null`);
      const { data } = await q;
      return (data ?? []) as AuditRow[];
    },
  });

  const rows = useMemo(() => {
    if (!search.trim()) return data;
    const s = search.toLowerCase();
    return data.filter((r) => {
      const hay = `${r.user_name ?? ""} ${r.entity} ${r.action} ${JSON.stringify(r.before ?? {})} ${JSON.stringify(r.after ?? {})}`.toLowerCase();
      return hay.includes(s);
    });
  }, [data, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl flex items-center gap-2">
            <History className="h-7 w-7" />Auditoría
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro completo de cambios en <b>{activeBranch?.name ?? "todas las sedes"}</b> (últimos 500).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Actualizar
        </Button>
      </div>

      <Tabs defaultValue="anulaciones" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="anulaciones" className="gap-2">
            <Ban className="h-4 w-4" /> Anulaciones y cancelaciones
          </TabsTrigger>
          <TabsTrigger value="cambios" className="gap-2">
            <History className="h-4 w-4" /> Cambios generales
          </TabsTrigger>
        </TabsList>

        <TabsContent value="anulaciones">
          <CancelledSalesAuditPanel branchId={activeBranchId} />
        </TabsContent>

        <TabsContent value="cambios" className="space-y-4">


      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Explora quién, qué y cuándo se modificó.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground">Entidad</label>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENTITIES.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Acción</label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Buscar (usuario, campo, valor)</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ej: Oscar, precio, helado…" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{rows.length} registros</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Fecha</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Entidad</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Cambios</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin registros para los filtros seleccionados.</TableCell></TableRow>
              )}
              {rows.map((r) => {
                const diffs = diffFields(r.before, r.after);
                const summary = r.action === "created"
                  ? `Creado: ${(r.after?.name as string) ?? r.entity_id.slice(0, 8)}`
                  : r.action === "deleted"
                  ? `Eliminado: ${(r.before?.name as string) ?? r.entity_id.slice(0, 8)}`
                  : diffs.length > 0
                  ? `${diffs.length} campo(s): ${diffs.map((d) => d.key).slice(0, 4).join(", ")}${diffs.length > 4 ? "…" : ""}`
                  : "Sin cambios visibles";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{r.user_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{ENTITIES.find((e) => e.value === r.entity)?.label ?? r.entity}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={actionBadge(r.action)}>{r.action}</Badge>
                    </TableCell>
                    <TableCell>
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 gap-1">
                            <ChevronDown className="h-3 w-3" />
                            <span className="text-xs text-left">{summary}</span>
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 space-y-1">
                          {diffs.length > 0 ? (
                            <div className="rounded border bg-muted/40 p-2 text-xs space-y-1">
                              {diffs.map((d) => (
                                <div key={d.key} className="flex flex-wrap gap-2">
                                  <span className="font-mono text-muted-foreground">{d.key}:</span>
                                  <span className="line-through text-destructive/80 font-mono">{JSON.stringify(d.from)}</span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className="font-mono text-emerald-700">{JSON.stringify(d.to)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (r.after || r.before) ? (
                            <pre className="text-[10px] bg-muted/40 rounded p-2 overflow-x-auto max-w-full">
                              {JSON.stringify(r.after ?? r.before, null, 2)}
                            </pre>
                          ) : null}
                          {r.meta && Object.keys(r.meta).length > 0 && (
                            <pre className="text-[10px] bg-muted/20 rounded p-2 overflow-x-auto">
                              meta: {JSON.stringify(r.meta, null, 2)}
                            </pre>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface CancelledSaleAudit {
  id: string;
  ticket_number: number;
  order_type: string;
  total: number;
  branch_id: string | null;
  payment_method: string | null;
  customer_name: string | null;
  user_name: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  cancellation_reason: string | null;
  cancellation_previous_status: string | null;
  table_id: string | null;
}

function CancelledSalesAuditPanel({ branchId }: { branchId: string | null }) {
  const [days, setDays] = useState<string>("30");

  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["audit.cancelled-sales", branchId, days],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("id,ticket_number,order_type,total,branch_id,payment_method,customer_name,user_name,created_at,cancelled_at,cancelled_by_name,cancellation_reason,cancellation_previous_status,table_id")
        .eq("status", "cancelled")
        .order("cancelled_at", { ascending: false })
        .limit(500);
      if (branchId) q = q.eq("branch_id", branchId);
      if (days !== "all") {
        const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
        q = q.gte("cancelled_at", since);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CancelledSaleAudit[];
    },
  });

  const paidCount = data.filter((r) => r.cancellation_previous_status === "paid").length;
  const totalValue = data.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const paidValue = data
    .filter((r) => r.cancellation_previous_status === "paid")
    .reduce((s, r) => s + Number(r.total ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-4 grid gap-3 md:grid-cols-4 items-center">
          <div>
            <div className="text-[11px] font-bold uppercase text-amber-800/70">Anulaciones</div>
            <div className="font-display text-2xl font-extrabold text-amber-700">{data.length}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase text-amber-800/70">Valor anulado</div>
            <div className="font-display text-2xl font-extrabold text-amber-700">{formatMoney(totalValue)}</div>
            <div className="text-[11px] text-muted-foreground">Informativo — no afecta ventas</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase text-rose-800/70">Con pago (requiere reversión)</div>
            <div className="font-display text-2xl font-extrabold text-rose-600">{paidCount}</div>
            <div className="text-[11px] text-muted-foreground">{formatMoney(paidValue)}</div>
          </div>
          <div className="flex justify-end gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Hoy / 24h</SelectItem>
                <SelectItem value="7">Últimos 7 días</SelectItem>
                <SelectItem value="30">Últimos 30 días</SelectItem>
                <SelectItem value="90">Últimos 90 días</SelectItem>
                <SelectItem value="all">Todo</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {paidCount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <b>{paidCount} pedido(s) anulado(s) que ya habían sido pagados.</b> Verifica que la reversión del pago haya quedado registrada en caja.
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Ticket</TableHead>
                <TableHead className="w-40">Anulado</TableHead>
                <TableHead>Servicio / Cliente</TableHead>
                <TableHead>Registró</TableHead>
                <TableHead>Anuló</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Estado previo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
              )}
              {!isLoading && data.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Sin anulaciones en este período.</TableCell></TableRow>
              )}
              {data.map((r) => {
                const wasPaid = r.cancellation_previous_status === "paid";
                return (
                  <TableRow key={r.id} className={wasPaid ? "bg-rose-50/40" : undefined}>
                    <TableCell className="font-mono font-bold text-rose-600">#{r.ticket_number}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.cancelled_at ? format(new Date(r.cancelled_at), "dd/MM/yy HH:mm") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="capitalize">{r.order_type}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{r.customer_name ?? "Cliente POS"}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.user_name ?? "—"}</TableCell>
                    <TableCell className="text-sm font-medium">{r.cancelled_by_name ?? "—"}</TableCell>
                    <TableCell className="text-xs italic max-w-xs truncate" title={r.cancellation_reason ?? ""}>
                      “{r.cancellation_reason ?? "—"}”
                    </TableCell>
                    <TableCell>
                      {wasPaid ? (
                        <Badge variant="destructive" className="text-[10px]">Pagado</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">{r.cancellation_previous_status ?? "—"}</Badge>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-display font-bold ${wasPaid ? "text-rose-600" : "text-muted-foreground line-through"}`}>
                      {formatMoney(r.total)}
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
