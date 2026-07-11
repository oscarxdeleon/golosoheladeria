import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, AlertTriangle, ArrowDownCircle, ArrowUpCircle, Pencil, PackageX, PackageMinus } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/branch-context";

export const Route = createFileRoute("/_authenticated/inventario")({
  head: () => ({ meta: [{ title: "Inventario · Goloso POS" }] }),
  component: InventarioPage,
});

type ItemType = "product" | "supply";
type MovementType = "entrada" | "salida" | "ajuste";

interface ProductRow { id: string; name: string; stock: number; min_stock: number; track_stock: boolean; sku: string | null; }
interface SupplyRow { id: string; name: string; unit: string | null; stock: number; min_stock: number; cost: number | null; }
interface Movement {
  id: string; item_type: ItemType; product_id: string | null; supply_id: string | null;
  movement_type: MovementType; quantity: number; reason: string | null; user_id: string | null; created_at: string;
  products?: { name: string } | null; supplies?: { name: string } | null;
}

function InventarioPage() {
  const { isAdmin } = useAuth();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl">Inventario</h1>
        {!isAdmin && <Badge variant="outline">Solo lectura</Badge>}
      </div>
      <Tabs defaultValue="prod">
        <TabsList>
          <TabsTrigger value="prod">Productos</TabsTrigger>
          <TabsTrigger value="sup">Insumos</TabsTrigger>
          <TabsTrigger value="mov">Movimientos</TabsTrigger>
        </TabsList>
        <TabsContent value="prod"><ProductsStock isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="sup"><SuppliesStock isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="mov"><Movements /></TabsContent>
      </Tabs>
    </div>
  );
}

function MovementDialog({
  itemType, itemId, itemName, currentStock, onDone,
}: { itemType: ItemType; itemId: string; itemName: string; currentStock: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MovementType>("entrada");
  const [qty, setQty] = useState<number>(0);
  const [reason, setReason] = useState("");

  async function submit() {
    if (!qty || isNaN(qty)) return toast.error("Cantidad inválida");
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      item_type: itemType,
      product_id: itemType === "product" ? itemId : null,
      supply_id: itemType === "supply" ? itemId : null,
      movement_type: type, quantity: qty, reason: reason || null,
      user_id: user?.id ?? null,
    };
    const { error } = await supabase.from("inventory_movements").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Movimiento registrado");
    setOpen(false); setQty(0); setReason(""); setType("entrada");
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Pencil className="h-3.5 w-3.5 mr-1" />Movimiento</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{itemName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">Stock actual: <span className="font-semibold text-foreground">{currentStock}</span></div>
          <div>
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as MovementType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="entrada">Entrada (sumar)</SelectItem>
                <SelectItem value="salida">Salida (restar)</SelectItem>
                <SelectItem value="ajuste">Ajuste (fijar valor)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{type === "ajuste" ? "Nuevo stock" : "Cantidad"}</Label>
            <Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
          <div>
            <Label>Motivo (opcional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Compra, merma, inventario físico…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductsStock({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery<ProductRow[]>({
    queryKey: ["inv-products"],
    queryFn: async () => (await supabase.from("products").select("id,name,stock,min_stock,track_stock,sku").order("name")).data as ProductRow[] ?? [],
  });
  async function toggleTrack(p: ProductRow, v: boolean) {
    await supabase.from("products").update({ track_stock: v }).eq("id", p.id);
    qc.invalidateQueries({ queryKey: ["inv-products"] });
  }
  async function setMin(p: ProductRow, v: number) {
    await supabase.from("products").update({ min_stock: v }).eq("id", p.id);
    qc.invalidateQueries({ queryKey: ["inv-products"] });
  }
  const refresh = () => { qc.invalidateQueries({ queryKey: ["inv-products"] }); qc.invalidateQueries({ queryKey: ["inv-movements"] }); };
  return (
    <Card>
      <CardHeader><CardTitle>Stock de productos</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead>Seguimiento</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((p) => {
              const low = p.track_stock && Number(p.stock) <= Number(p.min_stock);
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    {p.name}
                    {low && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Bajo</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.sku ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(p.stock)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number" className="h-8 w-20 ml-auto text-right"
                      defaultValue={Number(p.min_stock)}
                      disabled={!isAdmin}
                      onBlur={(e) => setMin(p, Number(e.target.value))}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={p.track_stock} disabled={!isAdmin} onCheckedChange={(v) => toggleTrack(p, v)} />
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && <MovementDialog itemType="product" itemId={p.id} itemName={p.name} currentStock={Number(p.stock)} onDone={refresh} />}
                  </TableCell>
                </TableRow>
              );
            })}
            {data.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin productos</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SuppliesStock({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery<SupplyRow[]>({
    queryKey: ["inv-supplies"],
    queryFn: async () => (await supabase.from("supplies").select("id,name,unit,stock,min_stock,cost").order("name")).data as SupplyRow[] ?? [],
  });
  async function setMin(s: SupplyRow, v: number) {
    await supabase.from("supplies").update({ min_stock: v }).eq("id", s.id);
    qc.invalidateQueries({ queryKey: ["inv-supplies"] });
  }
  const refresh = () => { qc.invalidateQueries({ queryKey: ["inv-supplies"] }); qc.invalidateQueries({ queryKey: ["inv-movements"] }); };
  return (
    <Card>
      <CardHeader><CardTitle>Stock de insumos</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((s) => {
              const low = Number(s.stock) <= Number(s.min_stock);
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    {s.name}
                    {low && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Bajo</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.unit ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{Number(s.stock)}</TableCell>
                  <TableCell className="text-right">
                    <Input type="number" className="h-8 w-20 ml-auto text-right"
                      defaultValue={Number(s.min_stock)} disabled={!isAdmin}
                      onBlur={(e) => setMin(s, Number(e.target.value))} />
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && <MovementDialog itemType="supply" itemId={s.id} itemName={s.name} currentStock={Number(s.stock)} onDone={refresh} />}
                  </TableCell>
                </TableRow>
              );
            })}
            {data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin insumos</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Movements() {
  const { data = [] } = useQuery<Movement[]>({
    queryKey: ["inv-movements"],
    queryFn: async () => (await supabase
      .from("inventory_movements")
      .select("*, products(name), supplies(name)")
      .order("created_at", { ascending: false })
      .limit(200)).data as unknown as Movement[] ?? [],
  });
  return (
    <Card>
      <CardHeader><CardTitle>Movimientos recientes</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead>Motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</TableCell>
                <TableCell>
                  {m.movement_type === "entrada" && <Badge className="gap-1"><ArrowUpCircle className="h-3 w-3" />Entrada</Badge>}
                  {m.movement_type === "salida" && <Badge variant="destructive" className="gap-1"><ArrowDownCircle className="h-3 w-3" />Salida</Badge>}
                  {m.movement_type === "ajuste" && <Badge variant="secondary">Ajuste</Badge>}
                </TableCell>
                <TableCell>{m.products?.name ?? m.supplies?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{Number(m.quantity)}</TableCell>
                <TableCell className="text-muted-foreground">{m.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin movimientos</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
