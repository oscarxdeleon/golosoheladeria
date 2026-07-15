import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
import { Copy, Eye, Link as LinkIcon, Pencil, Plus, RefreshCw, Trash2, ShieldCheck } from "lucide-react";
import {
  listSupervisorAccounts,
  createSupervisorAccount,
  updateSupervisorAccount,
  deleteSupervisorAccount,
} from "@/lib/supervisor.functions";

type Acct = Awaited<ReturnType<typeof listSupervisorAccounts>>[number];

export function SupervisorAccessSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSupervisorAccounts);
  const createFn = useServerFn(createSupervisorAccount);
  const updateFn = useServerFn(updateSupervisorAccount);
  const delFn = useServerFn(deleteSupervisorAccount);

  const { data = [], isLoading } = useQuery({
    queryKey: ["supervisor-accounts"],
    queryFn: () => listFn(),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Acct | null>(null);

  function buildLink(token: string) {
    if (typeof window === "undefined") return `/supervisor?t=${token}`;
    return `${window.location.origin}/supervisor?t=${token}`;
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(buildLink(token));
      toast.success("Enlace copiado");
    } catch { toast.error("No se pudo copiar"); }
  }

  async function toggleActive(a: Acct) {
    await updateFn({ data: { id: a.id, active: !a.active } });
    qc.invalidateQueries({ queryKey: ["supervisor-accounts"] });
  }

  async function regenerate(a: Acct) {
    if (!confirm("Se generará un nuevo enlace y las sesiones activas se cerrarán. ¿Continuar?")) return;
    await updateFn({ data: { id: a.id, regenerate_token: true } });
    toast.success("Enlace regenerado");
    qc.invalidateQueries({ queryKey: ["supervisor-accounts"] });
  }

  async function remove(a: Acct) {
    if (!confirm(`¿Eliminar el acceso supervisor "${a.display_name}"?`)) return;
    await delFn({ data: { id: a.id } });
    toast.success("Acceso eliminado");
    qc.invalidateQueries({ queryKey: ["supervisor-accounts"] });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Acceso Supervisor
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Accesos exclusivos de solo lectura con usuario + PIN de 4 dígitos. Enlace independiente del POS principal.
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
                  await updateFn({ data: { id: editing.id, display_name: p.display_name, pin: p.pin || undefined } });
                  toast.success("Actualizado");
                } else {
                  await createFn({ data: { username: p.username, display_name: p.display_name, pin: p.pin } });
                  toast.success("Acceso creado");
                }
                qc.invalidateQueries({ queryKey: ["supervisor-accounts"] });
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
              <TableHead>Usuario</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Último ingreso</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Cargando…</TableCell></TableRow>}
            {!isLoading && data.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Aún no hay accesos supervisor. Crea el primero.</TableCell></TableRow>
            )}
            {data.map((a: Acct) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.display_name}</TableCell>
                <TableCell className="font-mono text-xs">{a.username}</TableCell>
                <TableCell>
                  {a.active
                    ? <Badge className="bg-emerald-600">Activo</Badge>
                    : <Badge variant="secondary">Inactivo</Badge>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {a.last_login_at ? new Date(a.last_login_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => copyLink(a.access_token)} title="Copiar enlace">
                    <LinkIcon className="h-3.5 w-3.5 mr-1" /> Copiar enlace
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => window.open(buildLink(a.access_token), "_blank")} title="Abrir">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => regenerate(a)} title="Regenerar enlace">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
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
            ))}
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
  onSubmit: (p: { username: string; display_name: string; pin: string }) => Promise<void>;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [username, setUsername] = useState(initial?.username ?? "");
  const [display_name, setDisplayName] = useState(initial?.display_name ?? "");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!display_name.trim()) return toast.error("El nombre es obligatorio");
    if (!isEdit && !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) return toast.error("Usuario inválido");
    if (!isEdit && !/^\d{4}$/.test(pin)) return toast.error("PIN debe ser 4 dígitos");
    if (isEdit && pin && !/^\d{4}$/.test(pin)) return toast.error("PIN debe ser 4 dígitos");
    setSaving(true);
    try { await onSubmit({ username: username.trim(), display_name: display_name.trim(), pin }); }
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
          <Input value={display_name} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ej: Camilo Torres" />
        </div>
        <div className="space-y-2">
          <Label>Nombre de usuario</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={isEdit} placeholder="ej: camilo" />
          {isEdit && <p className="text-xs text-muted-foreground">El nombre de usuario no se puede cambiar.</p>}
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
          <p className="text-xs text-muted-foreground">El PIN se guarda cifrado y no puede recuperarse. Solo puedes reemplazarlo.</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : (isEdit ? "Guardar cambios" : "Crear acceso")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function CopyLinkButton({ token }: { token: string }) {
  return (
    <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/supervisor?t=${token}`)}>
      <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
    </Button>
  );
}
