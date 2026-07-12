import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { sendCashReport } from "@/lib/cash-report.functions";
import { kickCashDrawer } from "@/lib/print-client";
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
import { AlertTriangle, Banknote, LockOpen, LockKeyhole, History, Eye, Smartphone, Building2, Lock, Clock, Wallet, Coins, Calculator, NotebookPen } from "lucide-react";
import heroImage from "@/assets/cierre-caja-hero-v2.png";
import { formatMoney, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { useBranch } from "@/contexts/branch-context";
import {
  validateOperationBeforeClose,
  logValidationAudit,
  type ValidationResult,
  type PendingCategory,
} from "@/lib/close-cash-validation";

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
  const [pendingBlock, setPendingBlock] = useState<ValidationResult | null>(null);
  const navigate = useNavigate();
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [cashCounted, setCashCounted] = useState("");
  const [nequiCounted, setNequiCounted] = useState("");
  const [bancoCounted, setBancoCounted] = useState("");

  const COIN_DENOMS = [50, 100, 200, 500, 1000] as const;
  const BILL_DENOMS = [2000, 5000, 10000, 20000, 50000, 100000] as const;
  const [coinQty, setCoinQty] = useState<Record<number, string>>({});
  const [billQty, setBillQty] = useState<Record<number, string>>({});
  const [nowLabel, setNowLabel] = useState<string>(() => new Date().toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }));

  const formatThousands = (v: string) => {
    const digits = v.replace(/\D/g, "");
    if (!digits) return "";
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };
  const parseAmount = (v: string) => Number((v ?? "").toString().replace(/\D/g, "") || 0);
  const handleAmount = (setter: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setter(formatThousands(e.target.value));
  const onlyDigits = (v: string) => v.replace(/\D/g, "");
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

  const cashFromDenoms = useMemo(() => {
    const coins = COIN_DENOMS.reduce((acc, d) => acc + d * (parseInt(onlyDigits(coinQty[d] ?? "0"), 10) || 0), 0);
    const bills = BILL_DENOMS.reduce((acc, d) => acc + d * (parseInt(onlyDigits(billQty[d] ?? "0"), 10) || 0), 0);
    return coins + bills;
  }, [coinQty, billQty]);

  // Keep cashCounted synced with denomination totals (drives existing logic)
  useEffect(() => {
    setCashCounted(cashFromDenoms > 0 ? formatThousands(String(cashFromDenoms)) : "");
  }, [cashFromDenoms]);

  // Live clock while the close dialog is open
  useEffect(() => {
    if (!closeDialog) return;
    const t = setInterval(() => {
      setNowLabel(new Date().toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }));
    }, 30_000);
    setNowLabel(new Date().toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }));
    return () => clearInterval(t);
  }, [closeDialog]);

  const totalCounted = useMemo(
    () => cashFromDenoms + parseAmount(nequiCounted) + parseAmount(bancoCounted),
    [cashFromDenoms, nequiCounted, bancoCounted],
  );

  async function openSession() {
    if (!user) return toast.error("Esperando sesión de usuario…");
    if (!activeBranchId) return toast.error("Selecciona una sede antes de abrir caja");
    const amount = parseAmount(openingAmount);
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
      qc.setQueryData(["branch-cash-session-open", activeBranchId], session);
      if (session.user_id === user.id) {
        toast.success(`Caja abierta con ${formatMoney(session.opening_amount)}`);
      } else {
        toast.info(`La caja ya estaba abierta por ${session.user_name}. Ingresa directamente a la operación.`);
      }
      setOpenDialog(false);
      setOpeningAmount("");
      setOpeningNotes("");
      await qc.invalidateQueries({ queryKey: ["cash-sessions-history"] });
      await qc.invalidateQueries({ queryKey: ["branch-cash-session-open", activeBranchId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al abrir caja");
    } finally {
      setSaving(false);
    }
  }

  async function closeSession() {
    setCloseError(null);
    if (!user || !current) return;
    if (!activeBranchId) return toast.error("Selecciona una sede antes de cerrar caja");

    // Validación Integral de Operación: bloquea el cierre si hay pendientes.
    const validation = await validateOperationBeforeClose(activeBranchId);
    if (!validation.ok) {
      await logValidationAudit(activeBranchId, validation, "blocked");
      setPendingBlock(validation);
      return;
    }

    const cc = parseAmount(cashCounted), nc = parseAmount(nequiCounted), bc = parseAmount(bancoCounted);
    if (![cc, nc, bc].every((v) => Number.isFinite(v) && v >= 0)) {
      return toast.error("Completa los tres valores (Efectivo, Nequi, Bancolombia)");
    }
    await logValidationAudit(activeBranchId, validation, "allowed");
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("close_cash_session_blind", {
        _cash_counted: cc,
        _nequi_counted: nc,
        _bancolombia_counted: bc,
        _closing_notes: closingNotes || undefined,
        _branch_id: activeBranchId,
      });
      if (error) throw error;
      const closed = data as CashSession;
      qc.setQueryData(["cash-session-open-branch", activeBranchId], null);
      qc.setQueryData(["branch-cash-session-open", activeBranchId], null);
      toast.success("Caja cerrada correctamente");

      // Enviar reporte por correo en segundo plano (silencioso si no está configurado)
      sendReport({ data: { sessionId: closed.id } })
        .then((r: { sent?: boolean; skipped?: boolean; reason?: string }) => {
          if (r?.sent) toast.success("Reporte enviado por correo");
          // Los "skipped" son configuración opcional del entorno (Vercel sin
          // RESEND_API_KEY, sede sin correo). No alarmamos al cajero.
          else if (r?.skipped) console.info("[cash-report] skipped:", r.reason);
        })
        .catch((e: Error) => console.warn("[cash-report] error:", e.message));

      setCloseDialog(false);
      setCashCounted(""); setNequiCounted(""); setBancoCounted(""); setClosingNotes("");
      setCoinQty({}); setBillQty({});
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
                <Button
                  onClick={() => {
                    // Abre el cajón monedero automáticamente al iniciar el cierre.
                    // Si el Print Server local no responde, no bloquea el arqueo.
                    kickCashDrawer().catch((e) =>
                      console.warn("[caja] no se pudo abrir el cajón:", e),
                    );
                    setCloseDialog(true);
                  }}
                  variant="destructive"
                >
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
              <Input type="text" inputMode="numeric" placeholder="0" value={openingAmount} onChange={handleAmount(setOpeningAmount)} />
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

      {/* Cerrar caja a ciegas — diseño Goloso */}
      <Dialog open={closeDialog} onOpenChange={(o) => { setCloseDialog(o); if (o) setCloseError(null); }}>
        <DialogContent
          className="p-0 overflow-hidden max-w-[720px] lg:max-w-[1180px] w-[calc(100%-1.5rem)] max-h-[92vh] overflow-y-auto border-0 bg-transparent shadow-none"
        >
          <div
            className="relative rounded-2xl overflow-hidden text-white"
            style={{
              background: "radial-gradient(circle at 50% 0%, #4EC5F1 0%, #1FA8E8 40%, #0A7BC4 100%)",
            }}
          >
            {/* HEADER con personaje + título integrado */}
            <div className="relative px-4 pt-4 pb-2">
              <DialogHeader className="sr-only">
                <DialogTitle>Cierre de caja</DialogTitle>
                <DialogDescription>
                  Cuenta físicamente cada denominación. El sistema no muestra los totales esperados.
                </DialogDescription>
              </DialogHeader>
              <img
                src={heroImage}
                alt="Cierre de caja"
                className="w-full h-auto max-h-[180px] lg:max-h-[220px] object-contain select-none pointer-events-none drop-shadow-[0_6px_10px_rgba(0,0,0,0.15)]"
              />
            </div>

            <div className="px-4 pb-5 space-y-3">
              {closeError && (
                <div className="flex gap-2 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div>{closeError}</div>
                </div>
              )}
              {occupiedTables.length > 0 && (
                <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm text-red-700">
                  <strong>No puedes cerrar:</strong> hay {occupiedTables.length} mesa(s) ocupada(s) sin cobrar.
                </div>
              )}

              {/* Fila superior: HORA + EFECTIVO */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <section className="rounded-2xl bg-white p-3 shadow-[0_4px_0_rgba(0,0,0,0.08)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-b from-lime-300 to-lime-500 text-white shadow-inner">
                        <Clock className="h-5 w-5" />
                      </div>
                      <span className="font-extrabold text-[#0A4E7A] uppercase text-sm">Hora actual</span>
                    </div>
                    <span className="text-[#E11D74] font-bold text-sm">{nowLabel}</span>
                  </div>
                </section>

                <section className="rounded-2xl bg-white p-3 shadow-[0_4px_0_rgba(0,0,0,0.08)]">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-b from-teal-400 to-teal-600 text-white">
                      <Wallet className="h-5 w-5" />
                    </div>
                    <span className="font-extrabold text-[#0A4E7A] uppercase text-sm whitespace-nowrap">Efectivo contado</span>
                    <div className="ml-auto rounded-xl border-2 border-[#B8E4F5] px-3 py-1.5 flex items-center gap-1 min-w-[140px] justify-end">
                      <span className="text-[#0A7BC4] font-black text-xl">$</span>
                      <span className="text-[#0A4E7A] font-black text-xl tabular-nums">
                        {formatThousands(String(cashFromDenoms))}
                      </span>
                    </div>
                  </div>
                </section>
              </div>

              {/* Dos columnas en desktop: Monedas + Medios | Billetes + Notas */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
                <div className="space-y-3">
                  {/* MONEDAS */}
                  <section className="rounded-2xl bg-white p-3 shadow-[0_4px_0_rgba(0,0,0,0.08)]">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-b from-yellow-300 to-amber-500 text-white shadow-inner">
                        <Coins className="h-5 w-5" />
                      </div>
                      <span className="font-extrabold text-[#2C7A2C] uppercase text-sm">Monedas</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 justify-items-stretch">
                      {COIN_DENOMS.map((d) => (
                        <DenomField
                          key={d}
                          label={`$${d.toLocaleString("es-CO")}`}
                          variant="coin"
                          value={coinQty[d] ?? ""}
                          onChange={(v) => setCoinQty((p) => ({ ...p, [d]: onlyDigits(v) }))}
                        />
                      ))}
                    </div>
                  </section>

                  {/* MEDIOS DE PAGO */}
                  <section className="rounded-2xl bg-white p-3 shadow-[0_4px_0_rgba(0,0,0,0.08)]">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-b from-pink-400 to-pink-600 text-white">
                        <Calculator className="h-5 w-5" />
                      </div>
                      <span className="font-extrabold text-[#C41A6B] uppercase text-sm">Detalle por medio de pago (opcional)</span>
                    </div>
                    <div className="space-y-2">
                      <PaymentRow icon={<Smartphone className="h-4 w-4 text-[#C41A6B]" />} label="NEQUI" value={nequiCounted} onChange={handleAmount(setNequiCounted)} />
                      <div className="border-t border-dashed border-pink-200" />
                      <PaymentRow icon={<Building2 className="h-4 w-4 text-[#C41A6B]" />} label="BCOLOMBIA" value={bancoCounted} onChange={handleAmount(setBancoCounted)} />
                    </div>
                  </section>
                </div>

                <div className="space-y-3">
                  {/* BILLETES */}
                  <section className="rounded-2xl bg-white p-3 shadow-[0_4px_0_rgba(0,0,0,0.08)]">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-inner">
                        <Banknote className="h-5 w-5" />
                      </div>
                      <span className="font-extrabold text-[#0A4E7A] uppercase text-sm">Billetes</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 justify-items-stretch">
                      {BILL_DENOMS.map((d) => (
                        <DenomField
                          key={d}
                          label={`$${d.toLocaleString("es-CO")}`}
                          variant="bill"
                          value={billQty[d] ?? ""}
                          onChange={(v) => setBillQty((p) => ({ ...p, [d]: onlyDigits(v) }))}
                        />
                      ))}
                    </div>
                  </section>

                  {/* NOTAS */}
                  <section className="rounded-2xl bg-white p-3 shadow-[0_4px_0_rgba(0,0,0,0.08)]">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-b from-lime-300 to-lime-500 text-white">
                        <NotebookPen className="h-5 w-5" />
                      </div>
                      <span className="font-extrabold text-[#0A4E7A] uppercase text-sm">Notas (opcional)</span>
                    </div>
                    <Textarea
                      value={closingNotes}
                      onChange={(e) => setClosingNotes(e.target.value)}
                      placeholder="Notas del cierre…"
                      className="border-2 border-[#E5F1F8] rounded-xl text-[#0A4E7A] placeholder:text-slate-400"
                    />
                  </section>
                </div>
              </div>

              {/* TOTAL + ACCIONES */}
              <section className="rounded-2xl bg-white/95 p-3 shadow-[0_4px_0_rgba(0,0,0,0.08)]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-[#0A4E7A] font-medium">Total reportado</span>
                  <b className="text-xl text-[#0A4E7A] tabular-nums">{formatMoney(totalCounted)}</b>
                </div>
                <div className="flex gap-2 justify-end flex-wrap">
                  <Button variant="outline" onClick={() => setCloseDialog(false)}>Cancelar</Button>
                  <Button
                    onClick={closeSession}
                    disabled={saving || occupiedTables.length > 0}
                    className="bg-gradient-to-b from-red-500 to-red-700 hover:from-red-600 hover:to-red-800 text-white font-bold shadow-lg"
                  >
                    <LockKeyhole className="h-4 w-4" />
                    {saving ? "Cerrando…" : "Guardar y Cerrar Caja"}
                  </Button>
                </div>
              </section>
            </div>
          </div>

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
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <b>Monto inicial:</b> {formatMoney(detail.opening_amount)}
                </div>
                <SessionTipsCard sessionId={detail.id} openedAt={detail.opened_at} closedAt={detail.closed_at} branchId={detail.branch_id} />
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

function SessionTipsCard({ sessionId, openedAt, closedAt, branchId }: { sessionId: string; openedAt: string; closedAt: string | null; branchId: string | null }) {
  const { data } = useQuery({
    queryKey: ["cash-session-tips", sessionId],
    queryFn: async () => {
      // Preferimos filtrar por cash_session_id; si no hay, caemos a rango + sede
      const bySession = await supabase
        .from("sales")
        .select("tip_amount")
        .neq("status", "cancelled")
        .gt("tip_amount", 0)
        .eq("cash_session_id", sessionId);
      let rows = bySession.data ?? [];
      if (rows.length === 0 && branchId) {
        const fromDate = openedAt;
        const toDate = closedAt ?? new Date().toISOString();
        const fallback = await supabase
          .from("sales")
          .select("tip_amount")
          .neq("status", "cancelled")
          .gt("tip_amount", 0)
          .eq("branch_id", branchId)
          .gte("created_at", fromDate)
          .lte("created_at", toDate);
        rows = fallback.data ?? [];
      }
      const total = rows.reduce((acc, r) => acc + Number(r.tip_amount ?? 0), 0);
      return { total, count: rows.length };
    },
    enabled: !!sessionId,
  });
  return (
    <div className="rounded-md border-2 border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-extrabold text-amber-800 dark:text-amber-200">✨ Propinas</span>
        <span className="text-xs text-muted-foreground">{data?.count ?? 0} venta(s)</span>
      </div>
      <div className="text-xl font-black tabular-nums text-amber-700 dark:text-amber-300">
        {formatMoney(data?.total ?? 0)}
      </div>
    </div>
  );
}

function DenomField({
  label,
  value,
  onChange,
  variant,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  variant: "coin" | "bill";
}) {
  const pill =
    variant === "coin"
      ? "bg-gradient-to-b from-emerald-500 to-emerald-700 text-white ring-2 ring-lime-300"
      : "bg-gradient-to-b from-sky-700 to-sky-900 text-white ring-2 ring-sky-300";
  const badge =
    variant === "coin"
      ? "bg-gradient-to-b from-yellow-300 to-amber-500 text-white shadow-inner ring-2 ring-amber-600/50"
      : "bg-gradient-to-b from-emerald-300 to-emerald-500 text-white shadow-inner ring-2 ring-emerald-700/50";

  const parseQty = (v: string) => Math.max(0, parseInt((v ?? "").replace(/\D/g, ""), 10) || 0);
  const current = parseQty(value);

  // Ref con último valor para el repeat on-hold sin cierres obsoletos
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const holdRef = useRef<{ timeout?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> }>({});
  const stopHold = useCallback(() => {
    if (holdRef.current.timeout) clearTimeout(holdRef.current.timeout);
    if (holdRef.current.interval) clearInterval(holdRef.current.interval);
    holdRef.current = {};
  }, []);
  const bump = useCallback((delta: number) => {
    const next = Math.max(0, parseQty(valueRef.current) + delta);
    valueRef.current = String(next);
    onChange(String(next));
  }, [onChange]);
  const startHold = (delta: number) => {
    stopHold();
    holdRef.current.timeout = setTimeout(() => {
      holdRef.current.interval = setInterval(() => bump(delta), 90);
    }, 400);
  };
  useEffect(() => () => stopHold(), [stopHold]);

  const btnBase =
    "select-none touch-manipulation grid place-items-center h-9 w-9 rounded-lg font-black text-lg text-white active:scale-95 transition-transform shadow-sm disabled:opacity-40 disabled:active:scale-100";

  return (
    <div className="rounded-xl border-2 border-[#B8E4F5] bg-white p-2">
      <div className={`inline-flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full ${pill} shadow-md -mt-5 mb-1`}>
        <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-black ${badge}`}>$</span>
        <span className="font-black text-xs whitespace-nowrap">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`Disminuir ${label}`}
          disabled={current <= 0}
          onClick={() => bump(-1)}
          onPointerDown={() => startHold(-1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onContextMenu={(e) => e.preventDefault()}
          className={`${btnBase} bg-gradient-to-b from-rose-500 to-rose-700`}
        >
          –
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          onBlur={(e) => { if (e.target.value.trim() === "") onChange("0"); }}
          placeholder="0"
          className="w-full min-w-0 text-center rounded-lg border border-slate-200 bg-white text-[#0A4E7A] font-bold py-1.5 text-lg outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 tabular-nums"
        />
        <button
          type="button"
          aria-label={`Aumentar ${label}`}
          onClick={() => bump(1)}
          onPointerDown={() => startHold(1)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          onContextMenu={(e) => e.preventDefault()}
          className={`${btnBase} bg-gradient-to-b from-emerald-500 to-emerald-700`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function PaymentRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,180px)] items-center gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="font-extrabold text-[#0A4E7A] text-sm truncate">{label}</span>
      </div>
      <div className="flex items-center gap-1 rounded-lg border-2 border-pink-200 px-2 py-1">
        <span className="text-[#C41A6B] font-black">$</span>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={onChange}
          placeholder="0"
          className="w-full text-right bg-transparent outline-none text-[#0A4E7A] font-bold tabular-nums"
        />
      </div>
    </div>
  );
}
