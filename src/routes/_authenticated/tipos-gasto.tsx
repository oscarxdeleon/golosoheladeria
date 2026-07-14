import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, ArrowDown, ArrowUp, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tipos-gasto")({
  head: () => ({ meta: [{ title: "Administrar tipos de gasto · Goloso POS" }] }),
  component: TiposGastoPage,
  beforeLoad: () => {
    // El gate de auth ya está en _authenticated; validación de rol en cliente
    // se hace en el componente porque `has_role` solo se resuelve tras hidratar.
    return {};
  },
});

type Cat = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  branch_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

const NAME_MAX = 60;
const nameValid = (v: string) => {
  const s = v.trim();
  if (s.length < 2) return "El nombre debe tener al menos 2 caracteres.";
  if (s.length > NAME_MAX) return `Máximo ${NAME_MAX} caracteres.`;
  if (!/^[\p{L}\p{N}\s\-.,&/()°]+$/u.test(s)) return "Contiene caracteres no permitidos.";
  return "";
};

function TiposGastoPage() {
  const qc = useQueryClient();
  const { isAdmin, rolesLoading, user } = useAuth();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Cat | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Cat | null>(null);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["expense-categories", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("*")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
    enabled: !!user && isAdmin,
  });

  const filtered = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())),
    [categories, search],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["expense-categories"] });

  const toggleActive = useMutation({
    mutationFn: async (row: Cat) => {
      const { error } = await supabase
        .from("expense_categories")
        .update({ active: !row.active, updated_by: user?.id ?? null })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Estado actualizado"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const move = useMutation({
    mutationFn: async ({ row, dir }: { row: Cat; dir: -1 | 1 }) => {
      const list = [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      const idx = list.findIndex((c) => c.id === row.id);
      const target = list[idx + dir];
      if (!target) return;
      const a = { id: row.id, sort_order: target.sort_order };
      const b = { id: target.id, sort_order: row.sort_order };
      const { error: e1 } = await supabase.from("expense_categories").update({ sort_order: a.sort_order, updated_by: user?.id ?? null }).eq("id", a.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("expense_categories").update({ sort_order: b.sort_order, updated_by: user?.id ?? null }).eq("id", b.id);
      if (e2) throw e2;
    },
    onSuccess: () => invalidate(),
    onError: (e) => toast.error((e as Error).message),
  });

  const softDelete = useMutation({
    mutationFn: async (row: Cat) => {
      // Si tiene gastos históricos → borrado lógico + inactivo.
      const { count, error: cErr } = await supabase
        .from("expenses")
        .select("id", { count: "exact", head: true })
        .eq("category", row.name);
      if (cErr) throw cErr;

      if ((count ?? 0) > 0) {
        const { error } = await supabase
          .from("expense_categories")
          .update({ active: false, deleted_at: new Date().toISOString(), updated_by: user?.id ?? null })
          .eq("id", row.id);
        if (error) throw error;
        return { hard: false };
      }
      // Nunca usada → borrado físico
      const { error } = await supabase.from("expense_categories").delete().eq("id", row.id);
      if (error) throw error;
      return { hard: true };
    },
    onSuccess: (res) => {
      invalidate();
      toast.success(res.hard ? "Tipo de gasto eliminado" : "Tipo de gasto archivado (había registros históricos)");
      setConfirmDelete(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (rolesLoading) {
    return <div className="mx-auto max-w-3xl py-10 text-center text-muted-foreground">Cargando…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Solo el administrador puede gestionar los tipos de gasto.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Tags className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-extrabold leading-tight">Administrar Tipos de Gasto</h1>
            <p className="text-sm text-muted-foreground">
              Crea, edita, activa y ordena las categorías disponibles al registrar gastos.
            </p>
          </div>
        </div>
        <Link to="/gastos">
          <Button variant="ghost" size="icon" className="rounded-full bg-muted/60 hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 rounded-xl"
              placeholder="Buscar tipo de gasto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={() => setCreating(true)} className="rounded-xl gap-2">
            <Plus className="h-4 w-4" /> Nuevo Tipo de Gasto
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Orden</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden sm:table-cell">Descripción</TableHead>
                <TableHead className="w-[110px] text-center">Estado</TableHead>
                <TableHead className="w-[170px] text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin resultados.</TableCell></TableRow>
              )}
              {filtered.map((row, idx) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === 0 || move.isPending} onClick={() => move.mutate({ row, dir: -1 })}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === filtered.length - 1 || move.isPending} onClick={() => move.mutate({ row, dir: 1 })}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground max-w-xs truncate">{row.description || "—"}</TableCell>
                  <TableCell className="text-center">
                    <Switch checked={row.active} onCheckedChange={() => toggleActive.mutate(row)} disabled={toggleActive.isPending} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(row)} className="gap-1">
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(row)} className="gap-1 text-rose-600 hover:text-rose-700">
                      <Trash2 className="h-3.5 w-3.5" /> Eliminar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Crear */}
      <EditorDialog
        open={creating}
        onOpenChange={setCreating}
        title="Nuevo Tipo de Gasto"
        initial={null}
        existing={categories}
        onSaved={invalidate}
        userId={user?.id ?? null}
      />

      {/* Editar */}
      <EditorDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Editar Tipo de Gasto"
        initial={editing}
        existing={categories}
        onSaved={invalidate}
        userId={user?.id ?? null}
      />

      {/* Confirmar eliminación */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Está seguro de eliminar este tipo de gasto?</AlertDialogTitle>
            <AlertDialogDescription>
              Si "{confirmDelete?.name}" ya fue usado en gastos anteriores, se archivará
              como <b>inactivo</b> para no afectar los reportes históricos. Si nunca se usó,
              se eliminará permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && softDelete.mutate(confirmDelete)}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Sí, eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditorDialog({
  open, onOpenChange, title, initial, existing, onSaved, userId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial: Cat | null;
  existing: Cat[];
  onSaved: () => void;
  userId: string | null;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // Sincroniza cuando cambia initial u open
  useMemo(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setActive(initial?.active ?? true);
      setSortOrder(initial?.sort_order ?? (existing.length ? Math.max(...existing.map((c) => c.sort_order)) + 10 : 10));
      setTouched(false);
    }
  }, [open, initial]);

  const nameErr = nameValid(name);
  const duplicated = existing.some(
    (c) => c.id !== initial?.id && c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  const dupErr = duplicated ? "Ya existe un tipo de gasto con ese nombre." : "";
  const invalid = !!nameErr || !!dupErr;

  async function submit() {
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        active,
        sort_order: Number.isFinite(sortOrder) ? Math.max(0, Math.trunc(sortOrder)) : 0,
        updated_by: userId,
      };
      if (initial) {
        const { error } = await supabase.from("expense_categories").update(payload).eq("id", initial.id);
        if (error) throw error;
        toast.success("Tipo de gasto actualizado");
      } else {
        const { error } = await supabase
          .from("expense_categories")
          .insert({ ...payload, created_by: userId, branch_id: null });
        if (error) throw error;
        toast.success("Tipo de gasto creado");
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Los tipos de gasto activos aparecerán al registrar un nuevo gasto en todas las sedes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Nombre <span className="text-rose-600">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={NAME_MAX}
              placeholder="Ej.: Servicios Públicos"
              aria-invalid={touched && (!!nameErr || !!dupErr)}
              className={touched && (nameErr || dupErr) ? "border-rose-500 ring-1 ring-rose-500" : ""}
              autoFocus
            />
            {touched && (nameErr || dupErr) && (
              <p className="mt-1 text-xs text-rose-600">{nameErr || dupErr}</p>
            )}
          </div>

          <div>
            <Label>Descripción (opcional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notas internas para el equipo…"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Orden de visualización</Label>
              <Input
                type="number"
                min={0}
                step={10}
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
              <p className="mt-1 text-xs text-muted-foreground">Menor número aparece primero.</p>
            </div>
            <div>
              <Label>Estado</Label>
              <div className="mt-2 flex items-center gap-2 h-10">
                <Switch checked={active} onCheckedChange={setActive} />
                <span className="text-sm">{active ? "Activo" : "Inactivo"}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || invalid}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
