import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, AlertCircle } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/menu/insumos")({
  head: () => ({ meta: [{ title: "Insumos · Goloso POS" }] }),
  component: InsumosPage,
});

interface Supply { id: string; name: string; unit: string; stock: number; min_stock: number; cost: number; }

function InsumosPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState<Partial<Supply> | null>(null);

  const { data: items = [] } = useQuery<Supply[]>({
    queryKey: ["supplies"],
    queryFn: async () => {
      const { data } = await supabase.from("supplies").select("*").order("name");
      return data ?? [];
    },
  });

  async function save() {
    if (!editing?.name?.trim()) return toast.error("Nombre requerido");
    const payload = {
      name: editing.name.trim(),
      unit: editing.unit ?? "unidad",
      stock: Number(editing.stock ?? 0),
      min_stock: Number(editing.min_stock ?? 0),
      cost: Number(editing.cost ?? 0),
    };
    const { error } = editing.id
      ? await supabase.from("supplies").update(payload).eq("id", editing.id)
      : await supabase.from("supplies").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Guardado");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["supplies"] });
  }
  async function remove(id: string) {
    if (!confirm("¿Eliminar insumo?")) return;
    const { error } = await supabase.from("supplies").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["supplies"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Insumos</h1>
          <p className="text-muted-foreground">Control de inventario: leche, conos, vasos, servilletas…</p>
        </div>
        {isAdmin && (
          <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogTrigger asChild><Button onClick={() => setEditing({})}><Plus className="h-4 w-4 mr-1" /> Nuevo</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nuevo"} insumo</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Nombre</Label><Input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Unidad</Label><Input value={editing?.unit ?? "unidad"} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} /></div>
                  <div><Label>Costo unitario</Label><Input type="number" value={editing?.cost ?? 0} onChange={(e) => setEditing({ ...editing, cost: Number(e.target.value) })} /></div>
                  <div><Label>Stock actual</Label><Input type="number" value={editing?.stock ?? 0} onChange={(e) => setEditing({ ...editing, stock: Number(e.target.value) })} /></div>
                  <div><Label>Stock mínimo</Label><Input type="number" value={editing?.min_stock ?? 0} onChange={(e) => setEditing({ ...editing, min_stock: Number(e.target.value) })} /></div>
                </div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Unidad</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Mínimo</TableHead><TableHead className="text-right">Costo</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    {Number(s.stock) <= Number(s.min_stock) && <AlertCircle className="h-4 w-4 text-destructive" />}
                    {s.name}
                  </TableCell>
                  <TableCell>{s.unit}</TableCell>
                  <TableCell className="text-right">{s.stock}</TableCell>
                  <TableCell className="text-right">{s.min_stock}</TableCell>
                  <TableCell className="text-right">{formatMoney(s.cost)}</TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(s)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin insumos</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
