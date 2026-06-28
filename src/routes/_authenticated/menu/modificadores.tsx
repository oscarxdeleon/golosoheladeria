import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, Pencil } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/menu/modificadores")({
  head: () => ({ meta: [{ title: "Modificadores · Goloso POS" }] }),
  component: ModPage,
});

interface Group { id: string; name: string; min_select: number; max_select: number; required: boolean; }
interface Mod { id: string; group_id: string; name: string; price: number; active: boolean; }

function ModPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [groupEdit, setGroupEdit] = useState<Partial<Group> | null>(null);
  const [modEdit, setModEdit] = useState<Partial<Mod> | null>(null);

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["mod-groups"],
    queryFn: async () => (await supabase.from("modifier_groups").select("*").order("name")).data ?? [],
  });
  const { data: mods = [] } = useQuery<Mod[]>({
    queryKey: ["mods"],
    queryFn: async () => (await supabase.from("modifiers").select("*").order("name")).data ?? [],
  });

  async function saveGroup() {
    if (!groupEdit?.name?.trim()) return toast.error("Nombre requerido");
    const payload = {
      name: groupEdit.name.trim(),
      min_select: Number(groupEdit.min_select ?? 0),
      max_select: Number(groupEdit.max_select ?? 1),
      required: groupEdit.required ?? false,
    };
    const { error } = groupEdit.id
      ? await supabase.from("modifier_groups").update(payload).eq("id", groupEdit.id)
      : await supabase.from("modifier_groups").insert(payload);
    if (error) return toast.error(error.message);
    setGroupEdit(null);
    qc.invalidateQueries({ queryKey: ["mod-groups"] });
  }
  async function removeGroup(id: string) {
    if (!confirm("¿Eliminar grupo y sus modificadores?")) return;
    await supabase.from("modifier_groups").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["mod-groups"] });
    qc.invalidateQueries({ queryKey: ["mods"] });
  }
  async function saveMod() {
    if (!modEdit?.name?.trim() || !modEdit.group_id) return toast.error("Datos incompletos");
    const payload = { group_id: modEdit.group_id, name: modEdit.name.trim(), price: Number(modEdit.price ?? 0), active: modEdit.active ?? true };
    const { error } = modEdit.id
      ? await supabase.from("modifiers").update(payload).eq("id", modEdit.id)
      : await supabase.from("modifiers").insert(payload);
    if (error) return toast.error(error.message);
    setModEdit(null);
    qc.invalidateQueries({ queryKey: ["mods"] });
  }
  async function removeMod(id: string) {
    await supabase.from("modifiers").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["mods"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Grupos de modificadores</h1>
          <p className="text-muted-foreground">Ej. "Sabores", "Toppings extra", "Tamaño"</p>
        </div>
        {isAdmin && (
          <Dialog open={!!groupEdit} onOpenChange={(o) => !o && setGroupEdit(null)}>
            <DialogTrigger asChild><Button onClick={() => setGroupEdit({ min_select: 0, max_select: 1 })}><Plus className="h-4 w-4 mr-1" /> Grupo</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{groupEdit?.id ? "Editar" : "Nuevo"} grupo</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Nombre</Label><Input value={groupEdit?.name ?? ""} onChange={(e) => setGroupEdit({ ...groupEdit, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Mín. selección</Label><Input type="number" value={groupEdit?.min_select ?? 0} onChange={(e) => setGroupEdit({ ...groupEdit, min_select: Number(e.target.value) })} /></div>
                  <div><Label>Máx. selección</Label><Input type="number" value={groupEdit?.max_select ?? 1} onChange={(e) => setGroupEdit({ ...groupEdit, max_select: Number(e.target.value) })} /></div>
                </div>
                <div className="flex items-center gap-2"><Switch checked={groupEdit?.required ?? false} onCheckedChange={(v) => setGroupEdit({ ...groupEdit, required: v })} /><Label>Obligatorio</Label></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setGroupEdit(null)}>Cancelar</Button><Button onClick={saveGroup}>Guardar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {groups.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Aún no hay grupos.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => {
            const myMods = mods.filter((m) => m.group_id === g.id);
            return (
              <Card key={g.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{g.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">Min {g.min_select} · Máx {g.max_select} · {g.required ? "Obligatorio" : "Opcional"}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setModEdit({ group_id: g.id, active: true })}><Plus className="h-3 w-3 mr-1" /> Mod</Button>
                      <Button size="icon" variant="ghost" onClick={() => setGroupEdit(g)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeGroup(g.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {myMods.map((m) => (
                      <li key={m.id} className="flex items-center justify-between rounded bg-muted/50 px-2 py-1.5 text-sm">
                        <span>{m.name}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">{formatMoney(m.price)}</span>
                          {isAdmin && (
                            <>
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setModEdit(m)}><Pencil className="h-3 w-3" /></Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeMod(m.id)}><Trash2 className="h-3 w-3" /></Button>
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                    {myMods.length === 0 && <li className="text-xs text-muted-foreground">Sin modificadores</li>}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!modEdit} onOpenChange={(o) => !o && setModEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{modEdit?.id ? "Editar" : "Agregar"} modificador</DialogTitle></DialogHeader>
          {modEdit?.id ? (
            <div className="space-y-3">
              <div><Label>Nombre</Label><Input value={modEdit?.name ?? ""} onChange={(e) => setModEdit({ ...modEdit, name: e.target.value })} /></div>
              <div><Label>Precio extra</Label><Input type="number" value={modEdit?.price ?? 0} onChange={(e) => setModEdit({ ...modEdit, price: Number(e.target.value) })} /></div>
            </div>
          ) : (
            <Tabs defaultValue="custom">
              <TabsList className="w-full">
                <TabsTrigger value="custom" className="flex-1">Personalizado</TabsTrigger>
                <TabsTrigger value="reuse" className="flex-1">Reutilizar existente</TabsTrigger>
              </TabsList>
              <TabsContent value="custom" className="space-y-3 pt-3">
                <div><Label>Nombre</Label><Input value={modEdit?.name ?? ""} onChange={(e) => setModEdit({ ...modEdit, name: e.target.value })} /></div>
                <div><Label>Precio extra</Label><Input type="number" value={modEdit?.price ?? 0} onChange={(e) => setModEdit({ ...modEdit, price: Number(e.target.value) })} /></div>
              </TabsContent>
              <TabsContent value="reuse" className="space-y-3 pt-3">
                <p className="text-xs text-muted-foreground">Copia un modificador existente a este grupo (mantiene nombre y precio).</p>
                <Label>Modificador existente</Label>
                <Select onValueChange={(v) => { const src = mods.find((m) => m.id === v); if (src) setModEdit({ ...modEdit, name: src.name, price: src.price }); }}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                  <SelectContent>
                    {Array.from(new Map(mods.map((m) => [`${m.name}|${m.price}`, m])).values()).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name} · {formatMoney(m.price)}</SelectItem>
                    ))}
                    {mods.length === 0 && <SelectItem value="none" disabled>Aún no hay modificadores</SelectItem>}
                  </SelectContent>
                </Select>
                {modEdit?.name && (
                  <div className="rounded-md bg-muted/50 p-2 text-sm">Se agregará: <strong>{modEdit.name}</strong> · {formatMoney(modEdit.price ?? 0)}</div>
                )}
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setModEdit(null)}>Cancelar</Button><Button onClick={saveMod}>Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
