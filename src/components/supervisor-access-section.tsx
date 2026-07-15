import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, ShieldCheck, Unlock, Link2, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Acct = {
  id: string;
  display_name: string;
  active: boolean;
  last_login_at: string | null;
  locked_until: string | null;
  created_at: string;
};

type Rpc = { rpc: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<{ data: T | null; error: { message: string } | null }> };
const rpc = supabase as unknown as Rpc;

async function listAccounts(): Promise<Acct[]> {
  const { data, error } = await rpc.rpc<Acct[]>("admin_list_supervisors_rpc");
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function createAccount(display_name: string, pin: string) {
  const { error } = await rpc.rpc("admin_create_supervisor_rpc", { _display_name: display_name, _pin: pin });
  if (error) throw new Error(error.message);
}
async function updateAccount(id: string, patch: { display_name?: string; pin?: string; active?: boolean }) {
  const { error } = await rpc.rpc("admin_update_supervisor_rpc", {
    _id: id,
    _display_name: patch.display_name ?? null,
    _pin: patch.pin ?? null,
    _active: patch.active ?? null,
  });
  if (error) throw new Error(error.message);
}
async function deleteAccount(id: string) {
  const { error } = await rpc.rpc("admin_delete_supervisor_rpc", { _id: id });
  if (error) throw new Error(error.message);
}

export function SupervisorAccessSection() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["supervisor-accounts-v2"], queryFn: listAccounts });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Acct | null>(null);
  const [created, setCreated] = useState<{ display_name: string; pin: string; url: string } | null>(null);

  const supervisorUrl = () =>
    (typeof window !== "undefined" ? window.location.origin : "") + "/supervisor";

  async function copy(text: string, label = "Enlace") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("No se pudo copiar");
    }
  }


  const invalidate = () => qc.invalidateQueries({ queryKey: ["supervisor-accounts-v2"] });

  async function toggleActive(a: Acct) {
    try { await updateAccount(a.id, { active: !a.active }); invalidate(); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function unlock(a: Acct) {
    try { await updateAccount(a.id, { active: true }); toast.success("Cuenta desbloqueada"); invalidate(); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function remove(a: Acct) {
    if (!confirm(`¿Eliminar el acceso supervisor "${a.display_name}"?`)) return;
    try { await deleteAccount(a.id); toast.success("Eliminado"); invalidate(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Acceso Supervisor
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Accesos de solo lectura. El supervisor ingresa con su Nombre + PIN de 4 dígitos en <b>/supervisor</b>.
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => setEditing(null)}><Plus className="h-4 w-4 mr-1" /> Nuevo supervisor</Button>
          </DialogTrigger>
          <SupervisorForm
            key={editing?.id ?? "new"}
            initial={editing}
            onClose={() => { setOpen(false); setEditing(null); }}
            onSubmit={async (p) => {
              try {
                if (editing) {
                  await updateAccount(editing.id, { display_name: p.display_name, pin: p.pin || undefined });
                  toast.success("Actualizado");
                } else {
                  await createAccount(p.display_name, p.pin);
                  toast.success("Acceso creado");
                }
                invalidate();
                setOpen(false); setEditing(null);
              } catch (e) { toast.error((e as Error).message); }
            }}
          />
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Último ingreso</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Cargando…</TableCell></TableRow>}
            {!isLoading && data.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Aún no hay accesos supervisor. Crea el primero.</TableCell></TableRow>
            )}
            {data.map((a) => {
              const locked = a.locked_until && new Date(a.locked_until) > new Date();
              return (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.display_name}</TableCell>
                  <TableCell className="space-x-1">
                    {a.active
                      ? <Badge className="bg-emerald-600">Activo</Badge>
                      : <Badge variant="secondary">Inactivo</Badge>}
                    {locked && <Badge variant="destructive">Bloqueado</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.last_login_at ? new Date(a.last_login_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {locked && (
                      <Button size="sm" variant="outline" onClick={() => unlock(a)} title="Desbloquear">
                        <Unlock className="h-3.5 w-3.5 mr-1" /> Desbloquear
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(a); setOpen(true); }} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <span className="inline-flex items-center gap-1 ml-1">
                      <Switch checked={a.active} onCheckedChange={() => toggleActive(a)} />
                    </span>
                    <Button size="icon" variant="ghost" onClick={() => remove(a)} title="Eliminar">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SupervisorForm({
  initial, onSubmit, onClose,
}: {
  initial: Acct | null;
  onSubmit: (p: { display_name: string; pin: string }) => Promise<void>;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [display_name, setDisplayName] = useState(initial?.display_name ?? "");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!display_name.trim()) return toast.error("El nombre es obligatorio");
    if (!isEdit && !/^\d{4}$/.test(pin)) return toast.error("PIN debe ser 4 dígitos");
    if (isEdit && pin && !/^\d{4}$/.test(pin)) return toast.error("PIN debe ser 4 dígitos");
    setSaving(true);
    try { await onSubmit({ display_name: display_name.trim(), pin }); }
    finally { setSaving(false); }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Editar acceso supervisor" : "Nuevo acceso supervisor"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Nombre del supervisor</Label>
          <Input value={display_name} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ej: Camilo Torres" autoFocus />
        </div>
        <div className="space-y-2">
          <Label>{isEdit ? "Nuevo PIN (opcional)" : "PIN de 4 dígitos"}</Label>
          <Input
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder={isEdit ? "Dejar vacío para no cambiar" : "····"}
            className="text-center text-2xl tracking-[0.6em] font-mono"
          />
          <p className="text-xs text-muted-foreground">El PIN se guarda cifrado y no puede recuperarse.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : (isEdit ? "Guardar cambios" : "Crear acceso")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
