import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { sendCashReport } from "@/lib/cash-report.functions";
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
import { AlertTriangle, Banknote, LockOpen, LockKeyhole, History, Eye, Smartphone, Building2, Lock } from "lucide-react";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { useBranch } from "@/contexts/branch-context";

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
  branch_id: string | null;
  cash_counted: number | null;
  nequi_counted: number | null;
  bancolombia_counted: number | null;
  cash_expected: number | null;
  nequi_expected: number | null;
  bancolombia_expected: number | null;
  cash_difference: number | null;
  nequi_difference: number | null;
  bancolombia_difference: number | null;
}

function CajaPage() {
  const qc = useQueryClient();
  const { user, profile, isAdmin, loading: authLoading } = useAuth();
  const { activeBranchId } = useBranch();
  const sendReport = useServerFn(sendCashReport);

  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [cashCounted, setCashCounted] = useState("");
  const [nequiCounted, setNequiCounted] = useState("");
  const [bancoCounted, setBancoCounted] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<CashSession | null>(null);

  // Caja abierta para la SEDE activa (compartida entre cajeros de la misma sede)
  const { data: current } = useQuery({
    queryKey: ["cash-session-open-branch", activeBranchId],
    enabled: !!activeBranchId,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("branch_id", activeBranchId!)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CashSession | null) ?? null;
    },
  });

  const isOwner = !!current && !!user && current.user_id === user.id;
  const canCloseSession = isOwner || isAdmin;

  const { data: history = [] } = useQuery({
    queryKey: ["cash-sessions-history", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("cash_sessions")
        .select("*")
        .eq("branch_id", activeBranchId!)
        .order("opened_at", { ascending: false })
        .limit(30);
      return (data ?? []) as unknown as CashSession[];
    },
  });

  const { data: occupiedTables = [] } = useQuery({
    queryKey: ["occupied-tables", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("restaurant_tables")
        .select("id,number,label")
        .eq("active", true)
        .eq("status", "occupied")
        .eq("branch_id", activeBranchId!);
      return data ?? [];
    },
    refetchInterval: 10000,
  });

  const totalCounted = useMemo(
    () => Number(cashCounted || 0) + Number(nequiCounted || 0) + Number(bancoCounted || 0),
    [cashCounted, nequiCounted, bancoCounted],
  );

  async function openSession() {
    if (!user) return toast.error("Esperando sesión de usuario…");
    if (!activeBranchId) return toast.error("Selecciona una sede antes de abrir caja");
    const amount = Number(openingAmount);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Monto inicial inválido");
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("open_cash_session", {
        _opening_amount: amount,
        _opening_notes: openingNotes || undefined,
        _user_name: profile?.full_name ?? user.email ?? "Cajero",
        _branch_id: activeBranchId,
      });
      if (error) throw error;
      const session = data as CashSession;
      qc.setQueryData(["cash-session-open-branch", activeBranchId], session);
      if (session.user_id === user.id) {
        toast.success(`Caja abierta con ${formatMoney(session.opening_amount)}`);
      } else {
        toast.info(`La caja ya estaba abierta por ${session.user_name}. Ingresa directamente a la operación.`);
      }
      setOpenDialog(false);
      setOpeningAmount("");
      setOpeningNotes("");
      await qc.invalidateQueries({ queryKey: ["cash-sessions-history"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al abrir caja");
    } finally {
      setSaving(false);
    }
  }

  async function closeSession() {
    setCloseError(null);
    if (!user || !current) return;
    if (occupiedTables.length > 0) {
      return toast.error(`Hay ${occupiedTables.length} mesa(s) ocupada(s) sin cobrar.`);
    }
    const cc = Number(cashCounted), nc = Number(nequiCounted), bc = Number(bancoCounted);
    if (![cc, nc, bc].every((v) => Number.isFinite(v) && v >= 0)) {
      return toast.error("Completa los tres valores (Efectivo, Nequi, Bancolombia)");
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("close_cash_session_blind", {
        _cash_counted: cc,
        _nequi_counted: nc,
        _bancolombia_counted: bc,
        _closing_notes: closingNotes || undefined,
      });
      if (error) throw error;
      const closed = data as CashSession;
      qc.setQueryData(["cash-session-open-branch", activeBranchId], null);
      toast.success("Caja cerrada correctamente");

      // Enviar reporte por correo en segundo plano
      sendReport({ data: { sessionId: closed.id } })
        .then((r: { sent?: boolean; skipped?: boolean; reason?: string }) => {
          if (r?.sent) toast.success("Reporte enviado por correo");
          else if (r?.skipped) toast.info(`Reporte no enviado: ${r.reason}`);
        })
        .catch((e: Error) => toast.error(`No se envió correo: ${e.message}`));

      setCloseDialog(false);
      setCashCounted(""); setNequiCounted(""); setBancoCounted(""); setClosingNotes("");
      await qc.refetchQueries({ queryKey: ["cash-sessions-history"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al cerrar caja";
      setCloseError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Caja</h1>
        <p className="text-sm text-muted-foreground">Apertura y cierre de turno (auditoría a ciegas)</p>
      </div>

      {current ? (
        <Card className={isOwner ? "border-success/40 bg-success/5" : "border-amber-300 bg-amber-50/40"}>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className={`rounded-xl p-3 ${isOwner ? "bg-success/15 text-success" : "bg-amber-100 text-amber-700"}`}>
                  {isOwner ? <LockOpen className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
                </div>
                <div>
                  <CardTitle className="font-display text-2xl">
                    {isOwner ? "Caja abierta" : "Caja abierta por otro cajero"}
                  </CardTitle>
                  <CardDescription>
                    Desde {formatDate(current.opened_at)} · {current.user_name}
                  </CardDescription>
                </div>
              </div>
              {canCloseSession && (
                <Button onClick={() => setCloseDialog(true)} variant="destructive">
                  <LockKeyhole className="h-4 w-4" />Cerrar caja
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-card p-4">
              <div className="text-xs text-muted-foreground">Monto inicial</div>
              <div className="font-display text-xl">{formatMoney(current.opening_amount)}</div>
              {current.opening_notes && (
                <p className="mt-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Notas: </span>{current.opening_notes}
                </p>
              )}
            </div>
            {!isOwner && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>La caja para esta sede ya fue abierta por otro terminal.</strong>{" "}
                Ingrese directamente a la operación. Sólo {current.user_name}
                {isAdmin ? " o un administrador" : ""} puede realizar el cierre.
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No hay caja abierta en esta sede</CardTitle>
            <CardDescription>Abre la caja al iniciar tu turno indicando el monto inicial en efectivo.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setOpenDialog(true)} disabled={authLoading || !user || !activeBranchId}>
              <LockOpen className="h-4 w-4" />{authLoading ? "Cargando…" : "Abrir caja"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />Historial de cierres
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empleado</TableHead>
                <TableHead>Apertura</TableHead>
                <TableHead>Cierre</TableHead>
                <TableHead className="text-right">Total reportado</TableHead>
                <TableHead className="text-right">Descuadre total</TableHead>
                <TableHead>Estado</TableHead>
                {isAdmin && <TableHead className="text-right">Detalle</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((s) => {
                const repTotal = Number(s.cash_counted ?? 0) + Number(s.nequi_counted ?? 0) + Number(s.bancolombia_counted ?? 0);
                const diffTotal = Number(s.cash_difference ?? 0) + Number(s.nequi_difference ?? 0) + Number(s.bancolombia_difference ?? 0);
                return (
                  <TableRow key={s.id}>
                    <TableCell>{s.user_name}</TableCell>
                    <TableCell className="text-xs">{formatDate(s.opened_at)}</TableCell>
                    <TableCell className="text-xs">{s.closed_at ? formatDate(s.closed_at) : "—"}</TableCell>
                    <TableCell className="text-right">{s.status === "closed" ? formatMoney(repTotal) : "—"}</TableCell>
                    <TableCell className="text-right">
                      {s.status === "closed" ? (
                        <span className={diffTotal === 0 ? "text-muted-foreground" : diffTotal < 0 ? "text-destructive font-medium" : "text-success font-medium"}>
                          {diffTotal > 0 ? "+" : ""}{formatMoney(diffTotal)}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === "open" ? "default" : "secondary"}>{s.status === "open" ? "Abierta" : "Cerrada"}</Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {s.status === "closed" && (
                          <Button size="sm" variant="ghost" onClick={() => setDetail(s)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {history.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-muted-foreground py-8">
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
              <Input type="number" inputMode="decimal" placeholder="0" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Notas (opcional)</label>
              <Textarea value={openingNotes} onChange={(e) => setOpeningNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)}>Cancelar</Button>
            <Button onClick={openSession} disabled={saving || authLoading || !user}>{saving ? "Abriendo…" : "Abrir caja"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cerrar caja a ciegas */}
      <Dialog open={closeDialog} onOpenChange={(o) => { setCloseDialog(o); if (o) setCloseError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cierre de caja (Auditoría a ciegas)</DialogTitle>
            <DialogDescription>
              Cuenta físicamente cada método de pago y reporta los valores. El sistema NO te mostrará los totales esperados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {closeError && (
              <div className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div>{closeError}</div>
              </div>
            )}
            {occupiedTables.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <strong>No puedes cerrar:</strong> hay {occupiedTables.length} mesa(s) ocupada(s) sin cobrar.
              </div>
            )}
            <div>
              <label className="text-sm font-medium flex items-center gap-2"><Banknote className="h-4 w-4" />Efectivo disponible</label>
              <Input type="number" inputMode="decimal" placeholder="Cuenta el efectivo físico en caja" value={cashCounted} onChange={(e) => setCashCounted(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium flex items-center gap-2"><Smartphone className="h-4 w-4" />Total Nequi</label>
              <Input type="number" inputMode="decimal" placeholder="Valor según comprobantes Nequi" value={nequiCounted} onChange={(e) => setNequiCounted(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium flex items-center gap-2"><Building2 className="h-4 w-4" />Total Bancolombia</label>
              <Input type="number" inputMode="decimal" placeholder="Valor según comprobantes Bancolombia" value={bancoCounted} onChange={(e) => setBancoCounted(e.target.value)} />
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total reportado</span><b>{formatMoney(totalCounted)}</b></div>
            </div>
            <div>
              <label className="text-sm font-medium">Notas de cierre (opcional)</label>
              <Textarea value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)}>Cancelar</Button>
            <Button
              onClick={closeSession}
              disabled={saving || occupiedTables.length > 0 || cashCounted === "" || nequiCounted === "" || bancoCounted === ""}
            >
              {saving ? "Cerrando…" : "Guardar y Cerrar Caja"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle admin */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle del cierre · {detail?.user_name}</DialogTitle>
            <DialogDescription>
              {detail ? `${formatDate(detail.opened_at)} → ${detail.closed_at ? formatDate(detail.closed_at) : "—"}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <b>Monto inicial:</b> {formatMoney(detail.opening_amount)}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Reportado</TableHead>
                    <TableHead className="text-right">Descuadre</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(["Efectivo", "Nequi", "Bancolombia"] as const).map((m) => {
                    const e = m === "Efectivo" ? detail.cash_expected : m === "Nequi" ? detail.nequi_expected : detail.bancolombia_expected;
                    const c = m === "Efectivo" ? detail.cash_counted : m === "Nequi" ? detail.nequi_counted : detail.bancolombia_counted;
                    const d = m === "Efectivo" ? detail.cash_difference : m === "Nequi" ? detail.nequi_difference : detail.bancolombia_difference;
                    const dn = Number(d ?? 0);
                    return (
                      <TableRow key={m}>
                        <TableCell className="font-medium">{m}</TableCell>
                        <TableCell className="text-right">{formatMoney(Number(e ?? 0))}</TableCell>
                        <TableCell className="text-right">{formatMoney(Number(c ?? 0))}</TableCell>
                        <TableCell className={`text-right font-semibold ${dn === 0 ? "" : dn < 0 ? "text-destructive" : "text-success"}`}>
                          {dn > 0 ? "+" : ""}{formatMoney(dn)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {detail.closing_notes && (
                <div className="rounded-md border p-3 text-sm">
                  <b>Notas:</b> {detail.closing_notes}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
