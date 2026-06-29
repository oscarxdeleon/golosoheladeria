import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Pencil, Store, Globe } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/menu/categorias")({
  head: () => ({ meta: [{ title: "Categorías · Goloso POS" }] }),
  component: CategoriasPage,
});

interface Category {
  id: string;
  name: string;
  sort_order: number;
  color: string | null;
  active: boolean;
  show_in_pos: boolean;
  show_in_online_menu: boolean;
}

function CategoriasPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState<Partial<Category> | null>(null);

  const { data: cats = [] } = useQuery({
    queryKey: ["categories-all"],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("*").order("sort_order");
      return (data ?? []) as Category[];
    },
  });

  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) return toast.error("Nombre requerido");
    const payload = {
      name: editing.name.trim(),
      sort_order: editing.sort_order ?? 0,
      color: editing.color ?? null,
      active: editing.active ?? true,
      show_in_pos: editing.show_in_pos ?? true,
      show_in_online_menu: editing.show_in_online_menu ?? true,
    };
    const { error } = editing.id
      ? await supabase.from("categories").update(payload).eq("id", editing.id)
      : await supabase.from("categories").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Guardado");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["categories-all"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["public-cats"] });
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar categoría?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["categories-all"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["public-cats"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Categorías</h1>
          <p className="text-muted-foreground">Organiza el menú y controla en qué canales aparece cada categoría.</p>
        </div>
        {isAdmin && (
          <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing({ show_in_pos: true, show_in_online_menu: true, active: true })}>
                <Plus className="h-4 w-4 mr-1" /> Nueva
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nueva"} categoría</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Nombre</Label><Input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Orden</Label><Input type="number" value={editing?.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></div>
                  <div><Label>Color</Label><Input type="color" value={editing?.color ?? "#FF8FAB"} onChange={(e) => setEditing({ ...editing, color: e.target.value })} /></div>
                </div>

                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Visibilidad por canal</div>

                  <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4 text-blue-600" />
                      <div>
                        <div className="text-sm font-medium">Mostrar en POS Local</div>
                        <div className="text-xs text-muted-foreground">Caja, Mesas, Para Llevar y Tablet</div>
                      </div>
                    </div>
                    <Switch
                      checked={editing?.show_in_pos ?? true}
                      onCheckedChange={(v) => setEditing({ ...editing, show_in_pos: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-emerald-600" />
                      <div>
                        <div className="text-sm font-medium">Mostrar en Menú en Línea</div>
                        <div className="text-xs text-muted-foreground">Catálogo web de pedidos de clientes</div>
                      </div>
                    </div>
                    <Switch
                      checked={editing?.show_in_online_menu ?? true}
                      onCheckedChange={(v) => setEditing({ ...editing, show_in_online_menu: v })}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={editing?.active ?? true} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                  <Label>Categoría activa</Label>
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
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Orden</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Canales activos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cats.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.sort_order}</TableCell>
                  <TableCell><span className="inline-block h-5 w-10 rounded" style={{ background: c.color ?? "#ddd" }} /></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {c.show_in_pos ? (
                        <Badge className="bg-blue-100 text-blue-800 border border-blue-300 hover:bg-blue-100">
                          <Store className="h-3 w-3 mr-1" /> POS
                        </Badge>
                      ) : null}
                      {c.show_in_online_menu ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-100">
                          <Globe className="h-3 w-3 mr-1" /> Línea
                        </Badge>
                      ) : null}
                      {!c.show_in_pos && !c.show_in_online_menu && (
                        <Badge variant="outline" className="text-muted-foreground">Oculta</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{c.active ? "Activa" : "Inactiva"}</TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {cats.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin categorías</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
