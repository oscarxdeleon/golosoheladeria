import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Pencil, ImagePlus } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/menu/productos")({
  head: () => ({ meta: [{ title: "Productos · Goloso POS" }] }),
  component: ProductosPage,
});

interface Product { id: string; name: string; price: number; category_id: string | null; sku: string | null; active: boolean; image_url: string | null; }

interface Category { id: string; name: string; }

function ProductosPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState<Partial<Product> | null>(null);

  const { data: cats = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("id,name").order("sort_order");
      return data ?? [];
    },
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["products-all"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*").order("name");
      return data ?? [];
    },
  });

  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) return toast.error("Nombre requerido");
    const payload = {
      name: editing.name.trim(),
      price: Number(editing.price ?? 0),
      category_id: editing.category_id ?? null,
      sku: editing.sku ?? null,
      active: editing.active ?? true,
      image_url: editing.image_url ?? null,
    };
    const { error } = editing.id
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Guardado");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["products-all"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  async function uploadImage(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await supabase.storage.from("products").upload(path, file, {
      upsert: true,
      contentType: file.type || `image/${ext}`,
    });
    if (up.error) {
      toast.error(up.error.message);
      return;
    }
    const { data: signed } = await supabase.storage
      .from("products")
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
    if (signed?.signedUrl) {
      setEditing((prev) => ({ ...(prev ?? {}), image_url: signed.signedUrl }));
      toast.success("Foto subida");
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar producto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["products-all"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Productos</h1>
          <p className="text-muted-foreground">Items que se venden en la caja</p>
        </div>
        {isAdmin && (
          <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogTrigger asChild><Button onClick={() => setEditing({ active: true })}><Plus className="h-4 w-4 mr-1" /> Nuevo</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Nuevo"} producto</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-muted flex items-center justify-center">
                    {editing?.image_url ? (
                      <img src={editing.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImagePlus className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <Label>Foto del producto</Label>
                    <Input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/bmp"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); }}
                    />
                    {editing?.image_url && (
                      <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 text-destructive"
                        onClick={() => setEditing({ ...editing, image_url: null })}>Quitar foto</Button>
                    )}
                  </div>
                </div>
                <div><Label>Nombre</Label><Input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Precio (COP)</Label><Input type="number" value={editing?.price ?? 0} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></div>
                  <div><Label>SKU</Label><Input value={editing?.sku ?? ""} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} /></div>
                </div>
                <div>
                  <Label>Categoría</Label>
                  <Select value={editing?.category_id ?? "none"} onValueChange={(v) => setEditing({ ...editing, category_id: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin categoría</SelectItem>
                      {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2"><Switch checked={editing?.active ?? true} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /><Label>Activo</Label></div>
              </div>

              <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="w-16">Foto</TableHead><TableHead>Nombre</TableHead><TableHead>Categoría</TableHead><TableHead className="text-right">Precio</TableHead><TableHead>Estado</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted">
                      {p.image_url
                        ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                        : <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">{p.name.charAt(0)}</div>}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{cats.find((c) => c.id === p.category_id)?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatMoney(p.price)}</TableCell>
                  <TableCell>{p.active ? "Activo" : "Inactivo"}</TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {products.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin productos</TableCell></TableRow>}

            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
