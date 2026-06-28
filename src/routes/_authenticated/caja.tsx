import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Banknote, LockOpen, LockKeyhole, TrendingUp, TrendingDown, History } from "lucide-react";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/caja")({
  head: () => ({ meta: [{ title: "Caja · Goloso POS" }] }),
  component: CajaPage,
});

interface CashSession {
  id: string;
  user_id: string;
  user_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  counted_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  status: "open" | "closed";
  opening_notes: string | null;
  closing_notes: string | null;
}

function CajaPage() {
  const qc = useQueryClient();
  const { user, profile, isAdmin } = useAuth();
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: current } = useQuery({
    queryKey: ["cash-session-open", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("user_id", user!.id)
        .eq("status", "open")
        .maybeSingle();
      return data as CashSession | null;
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["cash-sessions-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cash_sessions")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(20);
      return (data ?? []) as CashSession[];
    },
  });

  // Calcula ventas en efectivo durante la sesión actual
  const { data: cashSales = 0 } = useQuery({
    queryKey: ["session-cash-sales", current?.id],
    enabled: !!current,
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("total")
        .eq("user_id", current!.user_id)
        .eq("payment_method", "Efectivo")
        .gte("created_at", current!.opened_at);
      return (data ?? []).reduce((s: number, r: { total: number }) => s + Number(r.total), 0);
    },
  });

  const expected = useMemo(
    () => (current ? Number(current.opening_amount) + Number(cashSales) : 0),
    [current, cashSales],
  );
  const diff = countedAmount ? Number(countedAmount) - expected : 0;

  async function openSession() {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("cash_sessions").insert({
        user_id: user.id,
        user_name: profile?.full_name ?? user.email ?? "",
        opening_amount: Number(openingAmount) || 0,
        opening_notes: openingNotes || null,
      });
      if (error) throw error;
      toast.success("Caja abierta");
      setOpenDialog(false);
      setOpeningAmount("");
      setOpeningNotes("");
      qc.invalidateQueries({ queryKey: ["cash-session-open"] });
      qc.invalidateQueries({ queryKey: ["cash-sessions-history"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al abrir caja");
    } finally {
      setSaving(false);
    }
  }

  async function closeSession() {
    if (!current) return;
    setSaving(true);
    try {
      const counted = Number(countedAmount) || 0;
      const { error } = await supabase
        .from("cash_sessions")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          counted_amount: counted,
          expected_amount: expected,
          difference: counted - expected,
          closing_notes: closingNotes || null,
        })
        .eq("id", current.id);
      if (error) throw error;
      toast.success("Caja cerrada");
      setCloseDialog(false);
      setCountedAmount("");
      setClosingNotes("");
      qc.invalidateQueries({ queryKey: ["cash-session-open"] });
      qc.invalidateQueries({ queryKey: ["cash-sessions-history"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cerrar caja");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Caja</h1>
          <p className="text-sm text-muted-foreground">Apertura y cierre de turno de caja</p>
        </div>
      </div>

      {current ? (
        <Card className="border-success/40 bg-success/5">
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-success/15 p-3 text-success">
                  <LockOpen className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="font-display text-2xl">Caja abierta</CardTitle>
                  <CardDescription>
                    Desde {formatDate(current.opened_at)} · {current.user_name}
                  </CardDescription>
                </div>
              </div>
              <Button onClick={() => setCloseDialog(true)} variant="destructive">
                <LockKeyhole className="h-4 w-4" />
                Cerrar caja
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Monto inicial" value={formatMoney(current.opening_amount)} icon={<Banknote />} />
              <Stat label="Ventas en efectivo" value={formatMoney(cashSales)} icon={<TrendingUp />} />
              <Stat label="Esperado en caja" value={formatMoney(expected)} icon={<Banknote />} accent />
            </div>
            {current.opening_notes && (
              <p className="mt-4 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Notas de apertura: </span>
                {current.opening_notes}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No tienes caja abierta</CardTitle>
            <CardDescription>
              Abre la caja al iniciar tu turno indicando el monto inicial en efectivo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setOpenDialog(true)}>
              <LockOpen className="h-4 w-4" />
              Abrir caja
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historial {isAdmin ? "(todos los empleados)" : "(mis turnos)"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empleado</TableHead>
                <TableHead>Apertura</TableHead>
                <TableHead>Cierre</TableHead>
                <TableHead className="text-right">Inicial</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Contado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.user_name}</TableCell>
                  <TableCell className="text-xs">{formatDate(s.opened_at)}</TableCell>
                  <TableCell className="text-xs">
                    {s.closed_at ? formatDate(s.closed_at) : "—"}
                  </TableCell>
                  <TableCell className="text-right">{formatMoney(s.opening_amount)}</TableCell>
                  <TableCell className="text-right">
                    {s.expected_amount != null ? formatMoney(s.expected_amount) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.counted_amount != null ? formatMoney(s.counted_amount) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.difference != null ? (
                      <span
                        className={
                          Number(s.difference) === 0
                            ? "text-muted-foreground"
                            : Number(s.difference) > 0
                              ? "text-success font-medium"
                              : "text-destructive font-medium"
                        }
                      >
                        {Number(s.difference) > 0 ? "+" : ""}
                        {formatMoney(s.difference)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.status === "open" ? "default" : "secondary"}>
                      {s.status === "open" ? "Abierta" : "Cerrada"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {history.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Sin turnos registrados todavía
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Abrir caja */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir caja</DialogTitle>
            <DialogDescription>Cuenta el efectivo con que inicias el turno.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Monto inicial en efectivo</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notas (opcional)</label>
              <Textarea
                placeholder="Ej. base de $50.000 entregada por administrador"
                value={openingNotes}
                onChange={(e) => setOpeningNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={openSession} disabled={saving}>
              Abrir caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cerrar caja */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar caja</DialogTitle>
            <DialogDescription>
              Cuenta el efectivo en caja y compara con lo esperado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
              <div>
                <div className="text-muted-foreground">Inicial</div>
                <div className="font-medium">{formatMoney(current?.opening_amount ?? 0)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Ventas en efectivo</div>
                <div className="font-medium">{formatMoney(cashSales)}</div>
              </div>
              <div className="col-span-2 border-t pt-2">
                <div className="text-muted-foreground">Esperado en caja</div>
                <div className="font-display text-xl text-primary">{formatMoney(expected)}</div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Efectivo contado</label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={countedAmount}
                onChange={(e) => setCountedAmount(e.target.value)}
              />
            </div>
            {countedAmount !== "" && (
              <div
                className={`flex items-center gap-2 rounded-md p-2 text-sm ${
                  diff === 0
                    ? "bg-muted text-muted-foreground"
                    : diff > 0
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive"
                }`}
              >
                {diff >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                Diferencia: {diff > 0 ? "+" : ""}
                {formatMoney(diff)}
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Notas de cierre (opcional)</label>
              <Textarea
                placeholder="Justifica diferencias, propinas, retiros, etc."
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={closeSession} disabled={saving || countedAmount === ""}>
              Cerrar caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${accent ? "bg-primary/10 border-primary/30" : "bg-card"}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        {label}
      </div>
      <div
        className={`font-display text-xl ${accent ? "text-primary" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
