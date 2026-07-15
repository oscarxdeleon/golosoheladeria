import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ShieldCheck, ShoppingCart, Utensils, Bike, Eye, EyeOff, Glasses } from "lucide-react";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { createAppUser, updateAppUser, deleteAppUser } from "@/lib/admin-users.functions";


export const Route = createFileRoute("/_authenticated/usuarios")({
  head: () => ({ meta: [{ title: "Usuarios · Goloso POS" }] }),
  component: UsuariosPage,
});

interface Branch { id: string; name: string; is_main: boolean | null }
interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  branch_id: string | null;
  active: boolean;
  created_at: string;
  role: AppRole | null;
  branch_name?: string | null;
}

const ROLES: { value: AppRole; label: string; icon: typeof ShieldCheck; tone: string }[] = [
  { value: "admin", label: "Administrador", icon: ShieldCheck, tone: "bg-primary text-primary-foreground" },
  { value: "supervisor", label: "Supervisor", icon: Glasses, tone: "bg-indigo-600 text-white" },
  { value: "cajero", label: "Cajero", icon: ShoppingCart, tone: "bg-amber-500 text-white" },
  { value: "mesero", label: "Mesero", icon: Utensils, tone: "bg-emerald-600 text-white" },
  { value: "domiciliario", label: "Domiciliario", icon: Bike, tone: "bg-sky-600 text-white" },
];

function UsuariosPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { loading: permsLoading } = usePermissions();
  const qc = useQueryClient();
  const createFn = useServerFn(createAppUser);
  const updateFn = useServerFn(updateAppUser);
  const deleteFn = useServerFn(deleteAppUser);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches-for-users"],
    queryFn: async (): Promise<Branch[]> => {
      const { data } = await supabase.from("branches").select("id,name,is_main").order("is_main", { ascending: false }).order("name");
      return data ?? [];
    },
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users-list"],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email,branch_id,active,created_at"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      const roleMap = new Map<string, AppRole>();
      (roles ?? []).forEach((r) => roleMap.set(r.user_id, r.role as AppRole));
      const branchMap = new Map(branches.map((b) => [b.id, b.name]));
      return (profiles ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email ?? null,
        branch_id: p.branch_id ?? null,
        active: p.active ?? true,
        created_at: p.created_at,
        role: roleMap.get(p.id) ?? null,
        branch_name: p.branch_id ? branchMap.get(p.branch_id) ?? null : null,
      }));
    },
    enabled: branches.length >= 0,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  if (authLoading || permsLoading) return <div className="p-6 text-muted-foreground">Cargando…</div>;
  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Acceso denegado: Solo el administrador puede gestionar los usuarios del sistema.
        </CardContent>
      </Card>
    );
  }

  async function handleDelete(u: UserRow) {
    if (!confirm(`¿Eliminar al usuario "${u.full_name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteFn({ data: { user_id: u.id } });
      toast.success("Usuario eliminado");
      qc.invalidateQueries({ queryKey: ["users-list"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Usuarios</h1>
          <p className="text-muted-foreground">
            Alta y gestión de empleados con acceso al POS. Cada usuario queda vinculado a una sede y a un rol que define qué pantallas puede ver.
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4 mr-1" /> Nuevo usuario
            </Button>
          </DialogTrigger>
          <UserForm
            key={editing?.id ?? "new"}
            branches={branches}
            initial={editing}
            onClose={() => { setOpen(false); setEditing(null); }}
            onSubmit={async (payload) => {
              try {
                if (editing) {
                  await updateFn({
                    data: {
                      user_id: editing.id,
                      full_name: payload.full_name,
                      role: payload.role,
                      branch_id: payload.branch_id,
                      active: payload.active,
                      password: payload.password || undefined,
                    },
                  });
                  toast.success("Usuario actualizado");
                } else {
                  if (!payload.email || !payload.password) {
                    toast.error("Correo y contraseña son obligatorios");
                    return;
                  }
                  await createFn({
                    data: {
                      email: payload.email,
                      password: payload.password,
                      full_name: payload.full_name,
                      role: payload.role,
                      branch_id: payload.branch_id,
                    },
                  });
                  toast.success("Usuario creado");
                }
                qc.invalidateQueries({ queryKey: ["users-list"] });
                setOpen(false);
                setEditing(null);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          />
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{users.length} usuarios registrados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Sede</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Cargando…</TableCell></TableRow>
              )}
              {!isLoading && users.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Aún no hay usuarios. Crea el primero con "Nuevo usuario".</TableCell></TableRow>
              )}
              {users.map((u) => {
                const roleMeta = ROLES.find((r) => r.value === u.role);
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email ?? "—"}</TableCell>
                    <TableCell>
                      {roleMeta ? (
                        <Badge className={roleMeta.tone}><roleMeta.icon className="h-3 w-3 mr-1" />{roleMeta.label}</Badge>
                      ) : <span className="text-xs text-muted-foreground">Sin rol</span>}
                    </TableCell>
                    <TableCell className="text-sm">{u.branch_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {u.active
                        ? <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Activo</Badge>
                        : <Badge variant="secondary" className="bg-muted text-muted-foreground">Inactivo</Badge>}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(u); setOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(u)}>
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

    </div>
  );
}


interface FormPayload {
  full_name: string;
  email: string;
  password: string;
  role: AppRole;
  branch_id: string | null;
  active: boolean;
}

function UserForm({
  branches,
  initial,
  onSubmit,
  onClose,
}: {
  branches: Branch[];
  initial: UserRow | null;
  onSubmit: (p: FormPayload) => Promise<void>;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [full_name, setFullName] = useState(initial?.full_name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>(initial?.role ?? "cajero");
  const [branch_id, setBranchId] = useState<string | null>(initial?.branch_id ?? branches.find((b) => b.is_main)?.id ?? null);
  const [active, setActive] = useState<boolean>(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isSupervisor = role === "supervisor";

  async function handleSave() {
    if (!full_name.trim()) return toast.error("El nombre es obligatorio");
    if (!isEdit) {
      if (!email.trim()) return toast.error("El correo es obligatorio");
      if (password.length < 6) return toast.error("La contraseña debe tener mínimo 6 caracteres");
    }
    if (!isSupervisor && !branch_id) return toast.error("Debes asignar una sede");
    setSaving(true);
    try {
      await onSubmit({ full_name: full_name.trim(), email: email.trim(), password, role, branch_id: isSupervisor ? null : branch_id, active });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Editar usuario" : "Nuevo usuario"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Nombre completo *</Label>
          <Input value={full_name} onChange={(e) => setFullName(e.target.value)} placeholder="Ej: María Gómez" />
        </div>
        <div className="space-y-2">
          <Label>Correo electrónico *</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isEdit}
            placeholder="empleado@goloso.com"
          />
          {isEdit && <p className="text-xs text-muted-foreground">El correo no se puede cambiar después de la creación.</p>}
        </div>
        <div className="space-y-2">
          <Label>{isEdit ? "Nueva contraseña (opcional)" : "Contraseña *"}</Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "Dejar vacío para no cambiar" : "Mínimo 6 caracteres"}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Sede asignada *</Label>
            <Select value={branch_id ?? ""} onValueChange={(v) => setBranchId(v)}>
              <SelectTrigger><SelectValue placeholder="Selecciona una sede" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " (Principal)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Rol *</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {isEdit && (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Usuario activo</Label>
              <p className="text-xs text-muted-foreground">Si está inactivo, no podrá iniciar sesión.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        )}
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          <b>Cajero:</b> POS, Autopedido, Pedidos en línea, Caja. <br />
          <b>Mesero:</b> Plano de mesas, Para llevar, A domicilio, KDS. <br />
          <b>Domiciliario:</b> Despacho de domicilios. <br />
          <b>Supervisor:</b> Dashboard, Resumen Financiero e Historial de Cajas (solo lectura, todas las sedes). <br />
          <b>Administrador:</b> Acceso total al sistema.
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={handleSave} disabled={saving}>{saving ? "Guardando…" : (isEdit ? "Guardar cambios" : "Crear usuario")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
