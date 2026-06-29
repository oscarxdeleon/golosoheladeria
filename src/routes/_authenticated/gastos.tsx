import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Receipt, Upload } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/gastos")({
  head: () => ({ meta: [{ title: "Nuevo gasto · Goloso POS" }] }),
  component: GastosPage,
});

const CATEGORIES = [
  "Servicios Públicos",
  "Nómina / Salarios",
  "Arriendo",
  "Mantenimiento",
  "Publicidad",
  "Gastos Generales / Otros",
];

function GastosPage() {
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();

  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("efectivo");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: history = [] } = useQuery({
    queryKey: ["gastos-history", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => (await supabase
      .from("expenses")
      .select("*")
      .eq("branch_id", activeBranchId!)
      .order("created_at", { ascending: false })
      .limit(30)).data ?? [],
  });

  async function save() {
    if (!user) return toast.error("Sin sesión");
    if (!activeBranchId) return toast.error("Selecciona una sede activa");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Monto inválido");
    if (!description.trim()) return toast.error("Describe el gasto");

    setSaving(true);
    try {
      let cashSessionId: string | null = null;
      if (payment === "efectivo") {
        const { data: cs } = await supabase.rpc("get_active_cash_session", { _branch_id: activeBranchId });
        cashSessionId = (cs as { id?: string } | null)?.id ?? null;
        if (!cashSessionId) {
          setSaving(false);
          return toast.error("Necesitas tener la caja abierta para pagar en efectivo");
        }
      }

      let receiptUrl: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${activeBranchId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("expense-receipts").upload(path, file);
        if (upErr) throw upErr;
        receiptUrl = path;
      }

      const { error } = await supabase.from("expenses").insert({
        branch_id: activeBranchId,
        cash_session_id: cashSessionId,
        user_id: user.id,
        user_name: profile?.full_name ?? user.email ?? "Usuario",
        category,
        description: description.trim(),
        amount: value,
        payment_method: payment,
        receipt_url: receiptUrl,
      });
      if (error) throw error;

      toast.success("Gasto registrado");
      setDescription(""); setAmount(""); setFile(null);
      qc.invalidateQueries({ queryKey: ["gastos-history"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2"><Receipt className="h-7 w-7" />Nuevo gasto</h1>
        <p className="text-sm text-muted-foreground">Registra egresos operativos (no afectan el stock).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del gasto</CardTitle>
          <CardDescription>Sede activa: <b>{activeBranch?.name ?? "—"}</b></CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Categoría</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Monto</Label>
            <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="md:col-span-2">
            <Label>Descripción / concepto</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalle del egreso" />
          </div>
          <div>
            <Label>Método de pago</Label>
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="efectivo">Efectivo de caja</SelectItem>
                <SelectItem value="nequi">Nequi</SelectItem>
                <SelectItem value="bancolombia">Cuenta bancaria</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="flex items-center gap-1"><Upload className="h-3.5 w-3.5" />Soporte (opcional)</Label>
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <p className="text-xs text-muted-foreground mt-1">{file.name}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end">
        <Button size="lg" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar gasto"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Últimos gastos de esta sede</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h: { id: string; created_at: string; category: string; description: string; payment_method: string; amount: number }) => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">{new Date(h.created_at).toLocaleString()}</TableCell>
                  <TableCell>{h.category}</TableCell>
                  <TableCell className="max-w-md truncate">{h.description}</TableCell>
                  <TableCell className="capitalize">{h.payment_method}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(h.amount)}</TableCell>
                </TableRow>
              ))}
              {history.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin gastos registrados.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
