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
import { Plus, Trash2, Pencil, Copy, ImageIcon } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { ImageDropzone } from "@/components/image-dropzone";
import { useBranch } from "@/contexts/branch-context";

export const Route = createFileRoute("/_authenticated/menu/modificadores")({
  head: () => ({ meta: [{ title: "Modificadores · Goloso POS" }] }),
  component: ModPage,
});

interface Group { id: string; name: string; min_select: number; max_select: number; required: boolean; }
interface Mod { id: string; group_id: string; name: string; price: number; active: boolean; image_url?: string | null; disabled_branch_ids?: string[] | null; }

function ModPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { branches, activeBranchId } = useBranch();
  const [selBranchId, setSelBranchId] = useState<string | null>(null);
  const branchId = selBranchId ?? activeBranchId;
  const [groupEdit, setGroupEdit] = useState<Partial<Group> | null>(null);
  const [modEdit, setModEdit] = useState<Partial<Mod> | null>(null);
  const [dupSource, setDupSource] = useState<Group | null>(null);
  const [dupName, setDupName] = useState("");
  const [dupItems, setDupItems] = useState<{ name: string; price: number; image_url?: string | null }[]>([]);
  const [dupSaving, setDupSaving] = useState(false);

  function openDuplicate(g: Group) {
    setDupSource(g);
    setDupName(`${g.name} - Copia`);
    setDupItems(mods.filter((m) => m.group_id === g.id).map((m) => ({ name: m.name, price: m.price, image_url: m.image_url ?? null })));
  }

  async function confirmDuplicate() {
    if (!dupSource) return;
    if (!dupName.trim()) return toast.error("Nombre requerido");
    setDupSaving(true);
    try {
      const { data: newGroup, error } = await supabase
        .from("modifier_groups")
        .insert({
          name: dupName.trim(),
          min_select: dupSource.min_select,
          max_select: dupSource.max_select,
          required: dupSource.required,
        })
        .select("id")
        .single();
      if (error || !newGroup) throw new Error(error?.message || "No se pudo crear el grupo");
      const items = dupItems
        .filter((i) => i.name.trim())
        .map((i) => ({ group_id: newGroup.id, name: i.name.trim(), price: Number(i.price) || 0, active: true, image_url: i.image_url ?? null }));
      if (items.length > 0) {
        const { error: e2 } = await supabase.from("modifiers").insert(items);
        if (e2) throw new Error(e2.message);
      }
      toast.success("Grupo de modificadores duplicado y guardado correctamente");
      setDupSource(null);
      setDupName("");
      setDupItems([]);
      qc.invalidateQueries({ queryKey: ["mod-groups"] });
      qc.invalidateQueries({ queryKey: ["mods"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al duplicar");
    } finally {
      setDupSaving(false);
    }
  }


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
    const payload = {
      group_id: modEdit.group_id,
      name: modEdit.name.trim(),
      price: Number(modEdit.price ?? 0),
      active: modEdit.active ?? true,
      image_url: modEdit.image_url ?? null,
    };
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
  async function toggleAvailability(m: Mod, available: boolean) {
    if (!branchId) return toast.error("Selecciona una sede");
    const current = m.disabled_branch_ids ?? [];
    const next = available
      ? current.filter((id) => id !== branchId)
      : Array.from(new Set([...current, branchId]));
    // Optimistic
    qc.setQueryData<Mod[]>(["mods"], (old) =>
      (old ?? []).map((x) => (x.id === m.id ? { ...x, disabled_branch_ids: next } : x)),
    );
    const { error } = await supabase.from("modifiers").update({ disabled_branch_ids: next }).eq("id", m.id);
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["mods"] });
    } else {
      toast.success(available ? "Disponible en esta sede" : "Ocultado en esta sede");
    }
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

      {isAdmin && branches.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-3">
            <Label className="text-sm">Disponibilidad por sede:</Label>
            <Select value={branchId ?? ""} onValueChange={(v) => setSelBranchId(v)}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Seleccionar sede…" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " · Principal" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Usa el interruptor de cada modificador para activarlo o desactivarlo en la sede seleccionada.</p>
          </CardContent>
        </Card>
      )}

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
                      <Button size="icon" variant="ghost" title="Duplicar" onClick={() => openDuplicate(g)}><Copy className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setGroupEdit(g)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeGroup(g.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {myMods.map((m) => {
                      const availableHere = !branchId || !(m.disabled_branch_ids ?? []).includes(branchId);
                      return (
                        <li key={m.id} className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${availableHere ? "bg-muted/50" : "bg-muted/30 opacity-60"}`}>
                          <span className="flex items-center gap-2 min-w-0">
                            {m.image_url ? (
                              <img src={m.image_url} alt={m.name} className={`h-8 w-8 rounded object-cover bg-white border ${availableHere ? "" : "grayscale"}`} loading="lazy" />
                            ) : (
                              <span className="h-8 w-8 rounded bg-muted flex items-center justify-center text-muted-foreground">
                                <ImageIcon className="h-3.5 w-3.5" />
                              </span>
                            )}
                            <span className={`truncate ${availableHere ? "" : "line-through text-muted-foreground"}`}>{m.name}</span>
                            {!availableHere && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">Inactivo</span>}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">{formatMoney(m.price)}</span>
                            {isAdmin && (
                              <>
                                <Switch
                                  checked={availableHere}
                                  onCheckedChange={(v) => toggleAvailability(m, v)}
                                  title={availableHere ? "Disponible en esta sede" : "Inactivo en esta sede"}
                                />
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setModEdit(m)}><Pencil className="h-3 w-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeMod(m.id)}><Trash2 className="h-3 w-3" /></Button>
                              </>
                            )}
                          </span>
                        </li>
                      );
                    })}
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
              <div>
                <Label>Foto (opcional)</Label>
                <ImageDropzone
                  value={modEdit?.image_url ?? null}
                  onChange={(url) => setModEdit({ ...modEdit, image_url: url })}
                  bucket="products"
                  pathPrefix="mod"
                  maxDim={400}
                  quality={0.75}
                />
                <p className="text-xs text-muted-foreground mt-1">Se optimiza a máx. 400px para carga rápida.</p>
              </div>
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
                <div>
                  <Label>Foto (opcional)</Label>
                  <ImageDropzone
                    value={modEdit?.image_url ?? null}
                    onChange={(url) => setModEdit({ ...modEdit, image_url: url })}
                    bucket="products"
                    pathPrefix="mod"
                    maxDim={400}
                    quality={0.75}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Se optimiza a máx. 400px para carga rápida.</p>
                </div>
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

      <Dialog open={!!dupSource} onOpenChange={(o) => { if (!o) { setDupSource(null); setDupItems([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Duplicar Grupo de Modificadores: {dupSource?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nuevo nombre del grupo</Label>
              <Input value={dupName} onChange={(e) => setDupName(e.target.value)} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Opciones a clonar ({dupItems.length})</Label>
                <Button size="sm" variant="outline" onClick={() => setDupItems([...dupItems, { name: "", price: 0 }])}>
                  <Plus className="h-3 w-3 mr-1" /> Opción
                </Button>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {dupItems.length === 0 && <p className="text-xs text-muted-foreground">El grupo original no tiene opciones.</p>}
                {dupItems.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {it.image_url ? (
                      <img src={it.image_url} alt={it.name} className="h-10 w-10 rounded object-cover border shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center shrink-0">
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <Input
                      className="flex-1"
                      placeholder="Nombre"
                      value={it.name}
                      onChange={(e) => setDupItems(dupItems.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                    />
                    <Input
                      className="w-28"
                      type="number"
                      placeholder="Precio"
                      value={it.price}
                      onChange={(e) => setDupItems(dupItems.map((x, i) => i === idx ? { ...x, price: Number(e.target.value) } : x))}
                    />
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDupItems(dupItems.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDupSource(null); setDupItems([]); }} disabled={dupSaving}>Cancelar</Button>
            <Button onClick={confirmDuplicate} disabled={dupSaving}>{dupSaving ? "Duplicando…" : "Confirmar duplicado"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
