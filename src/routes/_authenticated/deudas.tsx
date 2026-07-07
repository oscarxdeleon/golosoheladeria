import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { Search, Eye, Wallet, Printer, HandCoins, CreditCard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBranchCashSession } from "@/hooks/use-branch-cash-session";
import { useBranch } from "@/contexts/branch-context";

export const Route = createFileRoute("/_authenticated/deudas")({
  head: () => ({ meta: [{ title: "Deudas · Goloso POS" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
  },
  component: DeudasPage,
});

type Status = "pendiente" | "parcial" | "pagado" | "todos";

interface CreditRow {
  id: string;
  ticket_number: number | null;
  total: number;
  balance: number;
  status: "pendiente" | "parcial" | "pagado";
  created_at: string;
  customer_id: string;
  created_by_name: string | null;
  customers: { name: string; phone: string | null } | null;
  credit_payments: { amount: number; created_at: string }[];
}

interface SupplierRow {
  id: string;
  supplier: string;
  invoice_number: string | null;
  total: number;
  balance: number;
  status: "pendiente" | "parcial" | "pagado";
  created_at: string;
  created_by_name: string | null;
  supplier_credit_payments: { amount: number; created_at: string }[];
  purchase_id: string | null;
}

function statusBadge(s: string) {
  if (s === "pagado") return <Badge className="bg-emerald-600 text-white">Pagado</Badge>;
  if (s === "parcial") return <Badge className="bg-amber-500 text-white">Parcial</Badge>;
  return <Badge variant="destructive">Pendiente</Badge>;
}

function DeudasPage() {
  const { isAdmin, primaryRole, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin && primaryRole !== "cajero") {
    return <div className="p-8 text-center text-sm text-muted-foreground">No tienes permisos para ver esta sección.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl">Deudas</h1>
        <p className="text-muted-foreground">Cuentas por cobrar a clientes y por pagar a proveedores.</p>
      </div>
      <Tabs defaultValue="cobrar" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="cobrar"><HandCoins className="h-4 w-4 mr-2" /> Por Cobrar</TabsTrigger>
          <TabsTrigger value="pagar"><CreditCard className="h-4 w-4 mr-2" /> Por Pagar</TabsTrigger>
        </TabsList>
        <TabsContent value="cobrar" className="mt-4"><PorCobrar /></TabsContent>
        <TabsContent value="pagar" className="mt-4"><PorPagar /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ================== POR COBRAR ================== */
function PorCobrar() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<CreditRow | null>(null);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["credits-list", status, dateFrom, dateTo],
    refetchInterval: 8000,
    queryFn: async () => {
      let q = supabase.from("credits").select(`
        id, ticket_number, total, balance, status, created_at, customer_id, created_by_name,
        customers ( name, phone ),
        credit_payments ( amount, created_at )
      `).order("created_at", { ascending: false }).limit(500);
      if (status !== "todos") q = q.eq("status", status);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59");
      const { data } = await q;
      return (data ?? []) as unknown as CreditRow[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const name = r.customers?.name?.toLowerCase() ?? "";
      const phone = r.customers?.phone ?? "";
      const ticket = String(r.ticket_number ?? "");
      return name.includes(s) || phone.includes(s) || ticket.includes(s);
    });
  }, [rows, search]);

  const totalPend = filtered.reduce((s, r) => s + Number(r.balance), 0);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por cliente, celular o factura…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="parcial">Parcial</SelectItem>
              <SelectItem value="pagado">Pagado</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{filtered.length} créditos · {isFetching && "actualizando…"}</span>
        <span className="font-semibold">Saldo total pendiente: <span className="text-amber-700">{formatMoney(totalPend)}</span></span>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Celular</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Abonado</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Último abono</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const abonado = Number(r.total) - Number(r.balance);
                const last = r.credit_payments?.length ? r.credit_payments.reduce((a, b) => (a.created_at > b.created_at ? a : b)) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.customers?.name ?? "—"}</TableCell>
                    <TableCell>{r.customers?.phone ?? "—"}</TableCell>
                    <TableCell className="font-mono">#{r.ticket_number ?? "—"}</TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.total)}</TableCell>
                    <TableCell className="text-right text-emerald-700">{formatMoney(abonado)}</TableCell>
                    <TableCell className="text-right font-bold text-amber-700">{formatMoney(r.balance)}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-xs">{last ? formatDate(last.created_at) : "—"}</TableCell>
                    <TableCell className="text-xs">{r.created_by_name ?? "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>
                        <Eye className="h-4 w-4 mr-1" /> Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={11} className="py-10 text-center text-muted-foreground">Sin registros</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && <CreditDetailDialog creditId={selected.id} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CreditDetailDialog({ creditId, onClose }: { creditId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { session } = useBranchCashSession(activeBranchId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Efectivo");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  type CreditDetail = Omit<CreditRow, "customers" | "credit_payments"> & {
    customers: { name: string; phone: string | null; address: string | null; neighborhood: string | null } | null;
    credit_payments: { id: string; amount: number; payment_method: string; user_name: string; notes: string | null; created_at: string }[];
  };

  const { data, refetch } = useQuery({
    queryKey: ["credit-detail", creditId],
    queryFn: async () => {
      const { data: c } = await supabase.from("credits").select(`
        *, customers (name, phone, address, neighborhood),
        credit_payments (id, amount, payment_method, user_name, notes, created_at)
      `).eq("id", creditId).maybeSingle();
      return c as unknown as CreditDetail | null;
    },
  });

  const amt = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const max = Number(data?.balance ?? 0);

  async function submit() {
    if (amt <= 0) return toast.error("Ingresa un valor válido");
    if (amt > max + 0.01) return toast.error("El abono supera el saldo");
    setSaving(true);
    const { error } = await supabase.rpc("register_credit_payment", {
      _credit_id: creditId, _amount: amt, _method: method, _notes: notes || undefined, _cash_session_id: session?.id ?? undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Abono registrado");
    setAmount(""); setNotes("");
    refetch();
    qc.invalidateQueries({ queryKey: ["credits-list"] });
  }

  function printReceipt(pay: { amount: number; payment_method: string; user_name: string; created_at: string }) {
    const w = window.open("", "_blank", "width=380,height=520");
    if (!w) return;
    w.document.write(`<html><head><title>Comprobante de Abono</title>
      <style>body{font-family:monospace;padding:12px;font-size:12px}h2{text-align:center;margin:4px 0}hr{border:none;border-top:1px dashed #999;margin:6px 0}</style>
      </head><body>
      <h2>COMPROBANTE DE ABONO</h2>
      <hr/>
      <div>Cliente: ${data?.customers?.name ?? ""}</div>
      <div>Celular: ${data?.customers?.phone ?? ""}</div>
      <div>Factura: #${data?.ticket_number ?? ""}</div>
      <hr/>
      <div>Fecha: ${new Date(pay.created_at).toLocaleString()}</div>
      <div>Método: ${pay.payment_method}</div>
      <div>Recibido por: ${pay.user_name}</div>
      <h2>${formatMoney(pay.amount)}</h2>
      <hr/>
      <div>Saldo actual: ${formatMoney(data?.balance ?? 0)}</div>
      <script>window.print();</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crédito · Factura #{data?.ticket_number ?? "—"}</DialogTitle>
          <DialogDescription>Detalle y registro de abonos</DialogDescription>
        </DialogHeader>
        {data && (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm md:grid-cols-2">
              <div><strong>Cliente:</strong> {data.customers?.name}</div>
              <div><strong>Celular:</strong> {data.customers?.phone ?? "—"}</div>
              <div><strong>Dirección:</strong> {data.customers?.address ?? "—"}</div>
              <div><strong>Barrio:</strong> {data.customers?.neighborhood ?? "—"}</div>
              <div><strong>Fecha crédito:</strong> {formatDate(data.created_at)}</div>
              <div><strong>Vendedor:</strong> {data.created_by_name ?? "—"}</div>
              <div><strong>Total:</strong> {formatMoney(data.total)}</div>
              <div><strong>Saldo:</strong> <span className="font-bold text-amber-700">{formatMoney(data.balance)}</span></div>
              <div><strong>Estado:</strong> {statusBadge(data.status)}</div>
            </div>

            <div>
              <h3 className="font-medium mb-2">Historial de abonos</h3>
              <div className="max-h-56 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha/Hora</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.credit_payments.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">Sin abonos</TableCell></TableRow>
                    )}
                    {data.credit_payments.slice().sort((a,b) => b.created_at.localeCompare(a.created_at)).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                        <TableCell>{p.payment_method}</TableCell>
                        <TableCell className="text-xs">{p.user_name}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(p.amount)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => printReceipt(p)}><Printer className="h-3 w-3" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {data.status !== "pagado" && (
              <div className="rounded-md border p-3 space-y-2">
                <h3 className="font-medium flex items-center gap-2"><Wallet className="h-4 w-4" /> Registrar abono</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input inputMode="decimal" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Efectivo">Efectivo</SelectItem>
                      <SelectItem value="Nequi">Nequi</SelectItem>
                      <SelectItem value="Bancolombia">Bancolombia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Textarea rows={2} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setAmount(String(max))}>Saldar todo ({formatMoney(max)})</Button>
                  <Button onClick={submit} disabled={saving || amt <= 0}>
                    {saving ? "Registrando…" : `Confirmar ${formatMoney(amt)}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================== POR PAGAR ================== */
function PorPagar() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<SupplierRow | null>(null);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["supplier-credits", status, dateFrom, dateTo],
    refetchInterval: 8000,
    queryFn: async () => {
      let q = supabase.from("supplier_credits").select(`
        id, supplier, invoice_number, total, balance, status, created_at, created_by_name, purchase_id,
        supplier_credit_payments ( amount, created_at )
      `).order("created_at", { ascending: false }).limit(500);
      if (status !== "todos") q = q.eq("status", status);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59");
      const { data } = await q;
      return (data ?? []) as unknown as SupplierRow[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => (r.supplier ?? "").toLowerCase().includes(s) || (r.invoice_number ?? "").toLowerCase().includes(s));
  }, [rows, search]);

  const totalPend = filtered.reduce((s, r) => s + Number(r.balance), 0);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por proveedor o factura…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="parcial">Parcial</SelectItem>
              <SelectItem value="pagado">Pagado</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{filtered.length} deudas · {isFetching && "actualizando…"}</span>
        <span className="font-semibold">Saldo total por pagar: <span className="text-rose-700">{formatMoney(totalPend)}</span></span>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Abonado</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Último pago</TableHead>
                <TableHead>Registrado por</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const abonado = Number(r.total) - Number(r.balance);
                const last = r.supplier_credit_payments?.length ? r.supplier_credit_payments.reduce((a, b) => (a.created_at > b.created_at ? a : b)) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.supplier || "—"}</TableCell>
                    <TableCell className="font-mono">{r.invoice_number ?? "—"}</TableCell>
                    <TableCell>{formatDate(r.created_at)}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.total)}</TableCell>
                    <TableCell className="text-right text-emerald-700">{formatMoney(abonado)}</TableCell>
                    <TableCell className="text-right font-bold text-rose-700">{formatMoney(r.balance)}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-xs">{last ? formatDate(last.created_at) : "—"}</TableCell>
                    <TableCell className="text-xs">{r.created_by_name ?? "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>
                        <Eye className="h-4 w-4 mr-1" /> Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">Sin registros</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && <SupplierDetailDialog creditId={selected.id} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SupplierDetailDialog({ creditId, onClose }: { creditId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { session } = useBranchCashSession();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Efectivo");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ["supplier-credit-detail", creditId],
    queryFn: async () => {
      const { data: c } = await supabase.from("supplier_credits").select(`
        *, supplier_credit_payments (id, amount, payment_method, user_name, notes, created_at)
      `).eq("id", creditId).maybeSingle();
      if (!c) return null;
      let items: { id: string; product_name: string | null; supply_name: string | null; quantity: number; unit_cost: number }[] = [];
      if (c.purchase_id) {
        const { data: pit } = await supabase.from("purchase_items").select("id, product_name, supply_name, quantity, unit_cost").eq("purchase_id", c.purchase_id);
        items = (pit ?? []) as typeof items;
      }
      return { credit: c as SupplierRow & { notes: string | null; supplier_credit_payments: { id: string; amount: number; payment_method: string; user_name: string; notes: string | null; created_at: string }[] }, items };
    },
  });

  const amt = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const max = Number(data?.credit?.balance ?? 0);

  async function submit() {
    if (amt <= 0) return toast.error("Ingresa un valor válido");
    if (amt > max + 0.01) return toast.error("El pago supera el saldo");
    setSaving(true);
    const { error } = await supabase.rpc("register_supplier_payment", {
      _supplier_credit_id: creditId, _amount: amt, _method: method, _notes: notes || undefined, _cash_session_id: session?.id ?? undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Pago registrado");
    setAmount(""); setNotes("");
    refetch();
    qc.invalidateQueries({ queryKey: ["supplier-credits"] });
  }

  function printReceipt(pay: { amount: number; payment_method: string; user_name: string; created_at: string }) {
    const w = window.open("", "_blank", "width=380,height=520");
    if (!w || !data) return;
    w.document.write(`<html><head><title>Comprobante de Pago</title>
      <style>body{font-family:monospace;padding:12px;font-size:12px}h2{text-align:center;margin:4px 0}hr{border:none;border-top:1px dashed #999;margin:6px 0}</style>
      </head><body>
      <h2>COMPROBANTE DE PAGO</h2><hr/>
      <div>Proveedor: ${data.credit.supplier}</div>
      <div>Factura: ${data.credit.invoice_number ?? ""}</div>
      <hr/>
      <div>Fecha: ${new Date(pay.created_at).toLocaleString()}</div>
      <div>Método: ${pay.payment_method}</div>
      <div>Pagado por: ${pay.user_name}</div>
      <h2>${formatMoney(pay.amount)}</h2>
      <hr/>
      <div>Saldo actual: ${formatMoney(data.credit.balance)}</div>
      <script>window.print();</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deuda · {data?.credit.supplier}</DialogTitle>
          <DialogDescription>Factura {data?.credit.invoice_number ?? "—"}</DialogDescription>
        </DialogHeader>
        {data && (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm md:grid-cols-2">
              <div><strong>Proveedor:</strong> {data.credit.supplier}</div>
              <div><strong>Factura:</strong> {data.credit.invoice_number ?? "—"}</div>
              <div><strong>Fecha compra:</strong> {formatDate(data.credit.created_at)}</div>
              <div><strong>Registrado por:</strong> {data.credit.created_by_name ?? "—"}</div>
              <div><strong>Total:</strong> {formatMoney(data.credit.total)}</div>
              <div><strong>Saldo:</strong> <span className="font-bold text-rose-700">{formatMoney(data.credit.balance)}</span></div>
              <div><strong>Estado:</strong> {statusBadge(data.credit.status)}</div>
            </div>

            {data.items.length > 0 && (
              <div>
                <h3 className="font-medium mb-2">Productos comprados</h3>
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Cant.</TableHead><TableHead className="text-right">Costo</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.items.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.product_name ?? i.supply_name ?? "—"}</TableCell>
                          <TableCell className="text-right">{i.quantity}</TableCell>
                          <TableCell className="text-right">{formatMoney(i.unit_cost)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div>
              <h3 className="font-medium mb-2">Historial de pagos</h3>
              <div className="max-h-56 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha/Hora</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.credit.supplier_credit_payments.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">Sin pagos</TableCell></TableRow>
                    )}
                    {data.credit.supplier_credit_payments.slice().sort((a,b) => b.created_at.localeCompare(a.created_at)).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                        <TableCell>{p.payment_method}</TableCell>
                        <TableCell className="text-xs">{p.user_name}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(p.amount)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => printReceipt(p)}><Printer className="h-3 w-3" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {data.credit.status !== "pagado" && (
              <div className="rounded-md border p-3 space-y-2">
                <h3 className="font-medium flex items-center gap-2"><Wallet className="h-4 w-4" /> Registrar pago</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input inputMode="decimal" placeholder="Valor" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Efectivo">Efectivo</SelectItem>
                      <SelectItem value="Nequi">Nequi</SelectItem>
                      <SelectItem value="Bancolombia">Bancolombia</SelectItem>
                      <SelectItem value="Transferencia">Transferencia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Textarea rows={2} placeholder="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setAmount(String(max))}>Saldar todo ({formatMoney(max)})</Button>
                  <Button onClick={submit} disabled={saving || amt <= 0}>
                    {saving ? "Registrando…" : `Confirmar ${formatMoney(amt)}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
