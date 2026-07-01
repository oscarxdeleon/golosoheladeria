import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Bike, Plus, Pencil, Trash2, Phone } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/repartidores")({
  head: () => ({ meta: [{ title: "Repartidores · Goloso POS" }] }),
  component: RepartidoresPage,
});

interface Courier {
  id: string;
  name: string;
  phone: string;
  branch_id: string | null;
  active: boolean;
  notes: string | null;
}

function RepartidoresPage() {
  const qc = useQueryClient();
  const { branches, activeBranchId } = useBranch();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Courier | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", branch_id: activeBranchId ?? "", active: true, notes: "" });

  const { data = [] } = useQuery({
    queryKey: ["couriers"],
    queryFn: async () => {
      const { data } = await supabase.from("couriers").select("*").order("name");
      return (data ?? []) as Courier[];
    },
  });

  function openNew() {
    setEditing(null);
    setForm({ name: "", phone: "", branch_id: activeBranchId ?? "", active: true, notes: "" });
    setOpen(true);
  }
  function openEdit(c: Courier) {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone, branch_id: c.branch_id ?? "", active: c.active, notes: c.notes ?? "" });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Nombre y teléfono son obligatorios");
      return;
    }
    const phone = form.phone.replace(/\D/g, "");
    const payload = {
      name: form.name.trim(),
      phone,
      branch_id: form.branch_id || null,
      active: form.active,
      notes: form.notes.trim() || null,
    };
    const { error } = editing
      ? await supabase.from("couriers").update(payload).eq("id", editing.id)
      : await supabase.from("couriers").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Repartidor actualizado" : "Repartidor agregado");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["couriers"] });
  }

  async function remove(c: Courier) {
    if (!confirm(`¿Eliminar a ${c.name}?`)) return;
    const { error } = await supabase.from("couriers").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("Repartidor eliminado");
    qc.invalidateQueries({ queryKey: ["couriers"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bike className="h-7 w-7 text-primary" />
          <div>
            <h1 className="font-display text-3xl leading-tight">Repartidores</h1>
            <p className="text-sm text-muted-foreground">Domiciliarios propios que reciben la orden por WhatsApp.</p>
          </div>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Nuevo repartidor</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Listado</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {data.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full py-8 text-center">
              Aún no hay repartidores. Agrega el primero.
            </p>
          )}
          {data.map((c) => {
            const branch = branches.find((b) => b.id === c.branch_id);
            return (
              <div key={c.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.name}</span>
                    {!c.active && <Badge variant="outline">Inactivo</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {c.phone}
                    {branch && <span> · {branch.name}</span>}
                  </div>
                  {c.notes && <p className="text-xs text-muted-foreground mt-1">{c.notes}</p>}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar repartidor" : "Nuevo repartidor"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>WhatsApp * (con indicativo, ej: 573001234567)</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="573001234567" />
              <p className="text-xs text-muted-foreground mt-1">Colombia: 57 + número de 10 dígitos.</p>
            </div>
            <div>
              <Label>Sede asignada</Label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
              >
                <option value="">Todas las sedes</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Activo</Label>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
