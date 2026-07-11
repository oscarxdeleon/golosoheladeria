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
import { Button } from "@/components/ui/button";
import { History, ChevronDown, RefreshCw } from "lucide-react";

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

function AuditoriaPage() {
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
    </div>
  );
}
