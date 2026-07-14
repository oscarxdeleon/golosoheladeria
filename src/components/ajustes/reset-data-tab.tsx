import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Download, ShieldAlert, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { previewReset, backupReset, executeReset, type ResetCategory } from "@/lib/reset-data.functions";

const CATEGORIES: { key: ResetCategory; label: string; note: string }[] = [
  { key: "pedidos", label: "Pedidos y ventas", note: "Ventas, ítems, comandas, eventos de mesa, llamadas y créditos" },
  { key: "gastos", label: "Egresos y gastos", note: "Gastos registrados en el periodo" },
  { key: "caja", label: "Movimientos de caja y turnos", note: "Sesiones de caja cerradas del periodo" },
  { key: "stock", label: "Movimientos de stock", note: "Movimientos de inventario (no elimina productos)" },
  { key: "clientes", label: "Clientes", note: "Clientes y direcciones (aplica rango por fecha de creación)" },
  { key: "proveedores", label: "Proveedores y compras", note: "Compras, ítems y créditos de proveedor" },
  { key: "productos", label: "Productos", note: "Catálogo completo (global). Revisa historial antes" },
  { key: "modificadores", label: "Variaciones y modificadores", note: "Grupos y modificadores por sede" },
  { key: "insumos", label: "Insumos", note: "Catálogo de insumos (global)" },
  { key: "categorias", label: "Categorías", note: "Categorías del menú (global)" },
];

export function ResetDataTab() {
  const { isAdmin } = useAuth();
  const [selected, setSelected] = useState<Set<ResetCategory>>(new Set());
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [ack, setAck] = useState(false);
  const [backupOk, setBackupOk] = useState(false);
  const [preview, setPreview] = useState<{
    perCategory: Record<string, { total: number; tables: { table: string; count: number }[] }>;
    warnings: string[];
    blockers: string[];
  } | null>(null);

  const previewFn = useServerFn(previewReset);
  const backupFn = useServerFn(backupReset);
  const executeFn = useServerFn(executeReset);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-min"],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("id,name").order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const scope = useMemo(
    () => ({
      categories: Array.from(selected),
      branchIds: branchIds.length ? branchIds : null,
      from: from ? new Date(from + "T00:00:00").toISOString() : null,
      to: to ? new Date(to + "T23:59:59").toISOString() : null,
    }),
    [selected, branchIds, from, to],
  );

  const previewM = useMutation({
    mutationFn: async () => {
      if (!scope.categories.length) throw new Error("Selecciona al menos una categoría");
      return previewFn({ data: scope });
    },
    onSuccess: (d) => {
      setPreview(d);
      setBackupOk(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const backupM = useMutation({
    mutationFn: async () => backupFn({ data: scope }),
    onSuccess: (d) => {
      const blob = new Blob([d.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `goloso-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupOk(true);
      toast.success("Copia de seguridad descargada");
    },
    onError: (e: Error) => toast.error("No se pudo crear el respaldo: " + e.message),
  });

  const executeM = useMutation({
    mutationFn: async () => executeFn({ data: { ...scope, confirmPhrase: phrase, reason } }),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Reinicio completado. ${r.totalDeleted} registros eliminados.`);
      else toast.error(`Reinicio con errores en ${r.errors.length} tabla(s). Revisa auditoría.`);
      setPreview(null);
      setSelected(new Set());
      setPhrase("");
      setAck(false);
      setBackupOk(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Solo Administradores pueden acceder a esta herramienta.
        </CardContent>
      </Card>
    );
  }

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(CATEGORIES.map((c) => c.key)) : new Set());
    setPreview(null);
    setBackupOk(false);
  };
  const toggle = (k: ResetCategory, v: boolean) => {
    const next = new Set(selected);
    if (v) next.add(k); else next.delete(k);
    setSelected(next);
    setPreview(null);
    setBackupOk(false);
  };
  const toggleBranch = (id: string, v: boolean) => {
    setBranchIds((prev) => (v ? [...prev, id] : prev.filter((x) => x !== id)));
    setPreview(null);
    setBackupOk(false);
  };

  const canConfirm =
    !!preview &&
    preview.blockers.length === 0 &&
    backupOk &&
    phrase.trim().toUpperCase() === "REINICIAR DATOS GOLOSO" &&
    ack &&
    reason.trim().length >= 3;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />
          <div>
            <div className="font-semibold text-destructive">Operación crítica e irreversible</div>
            <p className="text-sm text-muted-foreground mt-1">
              Esta herramienta elimina definitivamente registros según las categorías, sede y periodo que selecciones.
              Genera siempre una copia de seguridad antes de continuar. La estructura del sistema, usuarios, roles,
              configuración e integraciones no se ven afectados.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>1. Categorías a reiniciar</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={selected.size === CATEGORIES.length}
              onCheckedChange={(v) => toggleAll(!!v)}
            />
            Seleccionar todo
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {CATEGORIES.map((c) => (
              <label key={c.key} className="flex items-start gap-2 rounded-lg border p-3 hover:bg-muted/40 cursor-pointer">
                <Checkbox
                  checked={selected.has(c.key)}
                  onCheckedChange={(v) => toggle(c.key, !!v)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.label}</span>
                    {preview?.perCategory[c.key] && (
                      <span className="text-xs font-semibold text-primary">
                        {preview.perCategory[c.key].total.toLocaleString()} reg.
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{c.note}</div>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Alcance</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Sedes</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={branchIds.length === 0}
                  onCheckedChange={(v) => v && setBranchIds([])}
                />
                Todas las sedes
              </label>
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                  <Checkbox
                    checked={branchIds.includes(b.id)}
                    onCheckedChange={(v) => toggleBranch(b.id, !!v)}
                  />
                  {b.name}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Los catálogos globales (productos, insumos, categorías, clientes) no filtran por sede.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Desde</Label>
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); setBackupOk(false); }} />
            </div>
            <div>
              <Label>Hasta</Label>
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); setBackupOk(false); }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Sin fechas se considera todo el historial de la categoría en el alcance seleccionado.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3. Vista previa</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => previewM.mutate()}
            disabled={previewM.isPending || selected.size === 0}
            variant="secondary"
          >
            {previewM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Calcular impacto
          </Button>
          {preview && (
            <div className="space-y-2 text-sm">
              {preview.blockers.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                  <div className="font-semibold text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Bloqueos
                  </div>
                  <ul className="list-disc ml-5 text-sm">
                    {preview.blockers.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> Advertencias
                  </div>
                  <ul className="list-disc ml-5 text-sm text-amber-800 dark:text-amber-300">
                    {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}
              <div className="rounded-md border p-3">
                <div className="font-semibold mb-2">Registros a eliminar</div>
                <ul className="space-y-1">
                  {Object.entries(preview.perCategory).map(([cat, v]) => (
                    <li key={cat} className="flex justify-between">
                      <span className="capitalize">{cat}</span>
                      <span className="font-mono text-primary">{v.total.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>4. Copia de seguridad</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Button
            onClick={() => backupM.mutate()}
            disabled={!preview || preview.blockers.length > 0 || backupM.isPending}
          >
            {backupM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Crear copia de seguridad y descargar
          </Button>
          {backupOk && (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Respaldo descargado. Guárdalo en un lugar seguro.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="text-destructive">5. Confirmación reforzada</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Motivo (queda en auditoría)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: Cierre de periodo enero 2026" />
          </div>
          <div>
            <Label>Escribe exactamente: <span className="font-mono">REINICIAR DATOS GOLOSO</span></Label>
            <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="REINICIAR DATOS GOLOSO" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} className="mt-0.5" />
            <span>Comprendo que esta operación elimina información y que ya se ha creado una copia de seguridad.</span>
          </label>
          <Button
            variant="destructive"
            disabled={!canConfirm || executeM.isPending}
            onClick={() => executeM.mutate()}
          >
            {executeM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar reinicio
          </Button>
          {!backupOk && preview && preview.blockers.length === 0 && (
            <p className="text-xs text-muted-foreground">Crea primero la copia de seguridad para habilitar la confirmación.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
