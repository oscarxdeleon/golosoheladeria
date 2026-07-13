import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBranch } from "@/contexts/branch-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/compras")({
  head: () => ({ meta: [{ title: "Nueva compra · Goloso POS" }] }),
  component: ComprasPage,
});

type ItemType = "product" | "supply";
interface LineItem {
  key: string;
  item_type: ItemType;
  ref_id: string;
  item_name: string;
  quantity: number;
  unit_cost: number;
}

function ComprasPage() {
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();

  const [supplier, setSupplier] = useState("");
  const [invoice, setInvoice] = useState("");
  const [payment, setPayment] = useState("efectivo");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["compras-products"],
    queryFn: async () => (await supabase.from("products").select("id,name").order("name")).data ?? [],
  });
  const { data: supplies = [] } = useQuery({
    queryKey: ["compras-supplies"],
    queryFn: async () => (await supabase.from("supplies").select("id,name,unit").order("name")).data ?? [],
  });

  const { data: history = [] } = useQuery({
    queryKey: ["compras-history", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => (await supabase
      .from("purchases")
      .select("*, purchase_items(id,item_name,quantity,unit_cost,subtotal)")
      .eq("branch_id", activeBranchId!)
      .order("created_at", { ascending: false })
      .limit(20)).data ?? [],
  });

  const total = useMemo(
    () => items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0),
    [items],
  );

  function addItem() {
    setItems((p) => [...p, { key: crypto.randomUUID(), item_type: "product", ref_id: "", item_name: "", quantity: 1, unit_cost: 0 }]);
  }
  function updateItem(key: string, patch: Partial<LineItem>) {
    setItems((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }
  function removeItem(key: string) {
    setItems((p) => p.filter((i) => i.key !== key));
  }

  function pickItem(key: string, type: ItemType, id: string) {
    const list = type === "product" ? products : supplies;
    const found = list.find((x: { id: string; name: string }) => x.id === id);
    updateItem(key, { item_type: type, ref_id: id, item_name: found?.name ?? "" });
  }

  async function save() {
    if (!user) return toast.error("Sin sesión");
    if (!activeBranchId) return toast.error("Selecciona una sede activa");
    if (items.length === 0) return toast.error("Agrega al menos un ítem");
    if (items.some((i) => !i.ref_id || i.quantity <= 0)) return toast.error("Completa producto y cantidad en cada fila");

    setSaving(true);
    try {
      let cashSessionId: string | null = null;
      if (payment === "efectivo") {
        const { data: cs } = await supabase.rpc("sync_active_cash_session", {
          _branch_id: activeBranchId,
          _user_name: profile?.full_name ?? user.email ?? "Usuario",
        });
        cashSessionId = (cs as { id?: string } | null)?.id ?? null;
        if (!cashSessionId) {
          setSaving(false);
          return toast.error("Necesitas tener la caja abierta para pagar en efectivo");
        }
      }

      const { data: purchase, error: pErr } = await supabase
        .from("purchases")
        .insert({
          branch_id: activeBranchId,
          cash_session_id: cashSessionId,
          user_id: user.id,
          user_name: profile?.full_name ?? user.email ?? "Usuario",
          supplier: supplier || null,
          invoice_number: invoice || null,
          payment_method: payment,
          total,
          notes: notes || null,
        })
        .select()
        .single();
      if (pErr) throw pErr;

      const rows = items.map((i) => ({
        purchase_id: purchase.id,
        item_type: i.item_type,
        product_id: i.item_type === "product" ? i.ref_id : null,
        supply_id: i.item_type === "supply" ? i.ref_id : null,
        item_name: i.item_name,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
        subtotal: Number(i.quantity) * Number(i.unit_cost),
      }));
      const { error: iErr } = await supabase.from("purchase_items").insert(rows);
      if (iErr) throw iErr;

      toast.success("Compra registrada y stock actualizado");
      setSupplier(""); setInvoice(""); setNotes(""); setItems([]);
      qc.invalidateQueries({ queryKey: ["compras-history"] });
      qc.invalidateQueries({ queryKey: ["inv-products"] });
      qc.invalidateQueries({ queryKey: ["inv-supplies"] });
      qc.invalidateQueries({ queryKey: ["inv-movements"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2"><ShoppingBag className="h-7 w-7" />Nueva compra</h1>
        <p className="text-sm text-muted-foreground">Registra el ingreso de mercancía de proveedores. El stock se actualiza automáticamente.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del registro</CardTitle>
          <CardDescription>Sede activa: <b>{activeBranch?.name ?? "—"}</b></CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Proveedor</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nombre del proveedor" />
          </div>
          <div>
            <Label>N° Factura / Remisión</Label>
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="F-0001" />
          </div>
          <div>
            <Label>Método de pago</Label>
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="efectivo">Efectivo de caja</SelectItem>
                <SelectItem value="nequi">Nequi</SelectItem>
                <SelectItem value="bancolombia">Cuenta bancaria</SelectItem>
                <SelectItem value="credito">Crédito proveedor</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Notas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Detalle de ítems</CardTitle>
          <Button size="sm" onClick={addItem}><Plus className="h-4 w-4" />Agregar ítem</Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Producto / Insumo</TableHead>
                <TableHead className="w-32 text-right">Cantidad</TableHead>
                <TableHead className="w-40 text-right">Costo unitario</TableHead>
                <TableHead className="w-32 text-right">Subtotal</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => {
                const list = it.item_type === "product" ? products : supplies;
                return (
                  <TableRow key={it.key}>
                    <TableCell>
                      <Select value={it.item_type} onValueChange={(v) => updateItem(it.key, { item_type: v as ItemType, ref_id: "", item_name: "" })}>
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="product">Producto</SelectItem>
                          <SelectItem value="supply">Insumo</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={it.ref_id} onValueChange={(v) => pickItem(it.key, it.item_type, v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                        <SelectContent>
                          {list.map((p: { id: string; name: string }) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" className="h-8 text-right" value={it.quantity}
                        onChange={(e) => updateItem(it.key, { quantity: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" className="h-8 text-right" value={it.unit_cost}
                        onChange={(e) => updateItem(it.key, { unit_cost: Number(e.target.value) })} />
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMoney(Number(it.quantity || 0) * Number(it.unit_cost || 0))}
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => removeItem(it.key)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin ítems. Presiona "Agregar ítem".</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div>
          <div className="text-xs text-muted-foreground">Total de la compra</div>
          <div className="font-display text-3xl">{formatMoney(total)}</div>
        </div>
        <Button size="lg" onClick={save} disabled={saving || items.length === 0}>
          {saving ? "Guardando…" : "Guardar compra"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Últimas compras de esta sede</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead className="text-right">Ítems</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h: { id: string; created_at: string; supplier: string | null; invoice_number: string | null; payment_method: string; total: number; purchase_items: { id: string }[] }) => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">{new Date(h.created_at).toLocaleString()}</TableCell>
                  <TableCell>{h.supplier ?? "—"}</TableCell>
                  <TableCell>{h.invoice_number ?? "—"}</TableCell>
                  <TableCell className="capitalize">{h.payment_method}</TableCell>
                  <TableCell className="text-right">{h.purchase_items?.length ?? 0}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(h.total)}</TableCell>
                </TableRow>
              ))}
              {history.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin compras registradas.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
