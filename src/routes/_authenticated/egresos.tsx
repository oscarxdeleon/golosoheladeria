import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingDown, ShoppingBag, Receipt } from "lucide-react";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/egresos")({
  head: () => ({ meta: [{ title: "Egresos · Goloso POS" }] }),
  component: EgresosPage,
});

function isoDay(d: Date) { return d.toISOString().slice(0, 10); }

function EgresosPage() {
  const { branches, activeBranchId } = useBranch();
  const today = new Date();
  const past = new Date(); past.setDate(today.getDate() - 30);

  const [from, setFrom] = useState(isoDay(past));
  const [to, setTo] = useState(isoDay(today));
  const [branchFilter, setBranchFilter] = useState<string>(activeBranchId ?? "all");

  const branchClause = branchFilter === "all" ? null : branchFilter;

  const { data: purchases = [] } = useQuery({
    queryKey: ["egresos-purchases", from, to, branchFilter],
    queryFn: async () => {
      let q = supabase.from("purchases").select("*")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false });
      if (branchClause) q = q.eq("branch_id", branchClause);
      return (await q).data ?? [];
    },
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["egresos-expenses", from, to, branchFilter],
    queryFn: async () => {
      let q = supabase.from("expenses").select("*")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`)
        .order("created_at", { ascending: false });
      if (branchClause) q = q.eq("branch_id", branchClause);
      return (await q).data ?? [];
    },
  });

  const totalCompras = useMemo(() => purchases.reduce((s, p: { total: number }) => s + Number(p.total || 0), 0), [purchases]);
  const totalGastos = useMemo(() => expenses.reduce((s, e: { amount: number }) => s + Number(e.amount || 0), 0), [expenses]);
  const totalGeneral = totalCompras + totalGastos;

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2"><TrendingDown className="h-7 w-7" />Egresos</h1>
        <p className="text-sm text-muted-foreground">Historial y totales de compras y gastos.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Desde</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>Hasta</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label>Sede</Label>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sedes</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><ShoppingBag className="h-4 w-4" />Compras</CardTitle></CardHeader>
          <CardContent><div className="font-display text-3xl">{formatMoney(totalCompras)}</div><div className="text-xs text-muted-foreground">{purchases.length} registros</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Receipt className="h-4 w-4" />Gastos</CardTitle></CardHeader>
          <CardContent><div className="font-display text-3xl">{formatMoney(totalGastos)}</div><div className="text-xs text-muted-foreground">{expenses.length} registros</div></CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total egresos</CardTitle></CardHeader>
          <CardContent><div className="font-display text-3xl text-primary">{formatMoney(totalGeneral)}</div></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="compras">
        <TabsList>
          <TabsTrigger value="compras">Compras ({purchases.length})</TabsTrigger>
          <TabsTrigger value="gastos">Gastos ({expenses.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="compras">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Sede</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Factura</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((p: { id: string; created_at: string; branch_id: string | null; supplier: string | null; invoice_number: string | null; payment_method: string; user_name: string | null; total: number }) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                      <TableCell>{branchName(p.branch_id)}</TableCell>
                      <TableCell>{p.supplier ?? "—"}</TableCell>
                      <TableCell>{p.invoice_number ?? "—"}</TableCell>
                      <TableCell className="capitalize">{p.payment_method}</TableCell>
                      <TableCell>{p.user_name ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(p.total)}</TableCell>
                    </TableRow>
                  ))}
                  {purchases.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Sin compras en el rango.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="gastos">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Sede</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e: { id: string; created_at: string; branch_id: string | null; category: string; description: string; payment_method: string; user_name: string | null; amount: number }) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{new Date(e.created_at).toLocaleString()}</TableCell>
                      <TableCell>{branchName(e.branch_id)}</TableCell>
                      <TableCell>{e.category}</TableCell>
                      <TableCell className="max-w-md truncate">{e.description}</TableCell>
                      <TableCell className="capitalize">{e.payment_method}</TableCell>
                      <TableCell>{e.user_name ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(e.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {expenses.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Sin gastos en el rango.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
