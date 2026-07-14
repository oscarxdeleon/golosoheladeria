import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBranch } from "@/contexts/branch-context";
import { useBranchCashSession } from "@/hooks/use-branch-cash-session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { formatMoney, formatDate } from "@/lib/format";
import { Banknote, Smartphone, Building2, ArrowDownToLine, Ban, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/depositos")({
  head: () => ({ meta: [{ title: "Depósitos · Goloso POS" }] }),
  component: DepositosPage,
});

type Method = "efectivo" | "nequi" | "bancolombia";

interface DepositRow {
  id: string;
  cash_session_id: string;
  branch_id: string | null;
  user_id: string;
  user_name: string | null;
  amount: number;
  description: string;
  method: Method;
  status: "active" | "void";
  void_reason: string | null;
  voided_at: string | null;
  device: string | null;
  created_at: string;
}

const METHODS: { key: Method; label: string; icon: React.ComponentType<{ className?: string }>; color: string; ring: string }[] = [
  { key: "efectivo",    label: "Efectivo",    icon: Banknote,   color: "bg-emerald-600 text-white",  ring: "ring-emerald-300" },
  { key: "nequi",       label: "Nequi",       icon: Smartphone, color: "bg-fuchsia-600 text-white",  ring: "ring-fuchsia-300" },
  { key: "bancolombia", label: "Bancolombia", icon: Building2,  color: "bg-amber-500 text-white",    ring: "ring-amber-300" },
];

const MIN_DESCRIPTION_LEN = 5;

function DepositosPage() {
  const qc = useQueryClient();
  const { user, profile, isAdmin } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const { session: cashSession, isOpen } = useBranchCashSession(activeBranchId);

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<Method | "">("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<DepositRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  const parseAmount = (v: string) => Number(v.replace(/\D/g, "") || 0);
  const formatThousands = (v: string) => {
    const digits = v.replace(/\D/g, "");
    return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
  };
  const value = parseAmount(amount);

  const descTrim = description.trim();
  const errAmount = value <= 0 ? "Ingresa un valor mayor a cero." : "";
  const errDesc = !descTrim
    ? "Escribe una descripción."
    : descTrim.length < MIN_DESCRIPTION_LEN
      ? `La descripción debe tener al menos ${MIN_DESCRIPTION_LEN} caracteres.`
      : "";
  const errMethod = !method ? "Selecciona el medio del depósito." : "";
  const canSubmit = !errAmount && !errDesc && !errMethod && isOpen && !!cashSession;

  const { data: deposits = [] } = useQuery({
    queryKey: ["deposits-shift", cashSession?.id ?? null],
    enabled: !!cashSession?.id,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_deposits")
        .select("*")
        .eq("cash_session_id", cashSession!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DepositRow[];
    },
  });

  const totals = useMemo(() => {
    const t = { efectivo: 0, nequi: 0, bancolombia: 0 };
    for (const d of deposits) {
      if (d.status !== "active") continue;
      t[d.method] = (t[d.method] ?? 0) + Number(d.amount || 0);
    }
    return t;
  }, [deposits]);

  async function doSave() {
    if (!user) return toast.error("Sin sesión.");
    if (!activeBranchId) return toast.error("Selecciona una sede.");
    if (!cashSession?.id) return toast.error("No hay caja abierta.");
    if (!canSubmit || !method) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("cash_deposits").insert({
        cash_session_id: cashSession.id,
        branch_id: activeBranchId,
        user_id: user.id,
        user_name: profile?.full_name ?? user.email ?? "Usuario",
        amount: value,
        description: descTrim,
        method,
        device: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
      });
      if (error) throw error;
      await supabase.from("audit_log").insert({
        action: "cash_deposit:create",
        entity: "cash_deposits",
        user_id: user.id,
        user_name: profile?.full_name ?? user.email ?? null,
        branch_id: activeBranchId,
        meta: { amount: value, method, description: descTrim, cash_session_id: cashSession.id },
      } as never);
      toast.success("Depósito registrado correctamente.");
      // Sólo abrir el cajón cuando el depósito sea en efectivo real.
      if (method === "efectivo") {
        const { openCashDrawer } = await import("@/lib/cash-drawer");
        void openCashDrawer({ event: "cash_deposit", operationId: cashSession.id });
      }
      setAmount(""); setDescription(""); setMethod("");
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["deposits-shift"] });

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo registrar el depósito.");
    } finally {
      setSaving(false);
    }
  }

  async function doVoid() {
    if (!voidTarget || !user) return;
    const reason = voidReason.trim();
    if (reason.length < MIN_DESCRIPTION_LEN) return toast.error("Motivo obligatorio (mínimo 5 caracteres).");
    setVoiding(true);
    try {
      const { error } = await supabase
        .from("cash_deposits")
        .update({
          status: "void",
          void_reason: reason,
          voided_by: user.id,
          voided_at: new Date().toISOString(),
        })
        .eq("id", voidTarget.id);
      if (error) throw error;
      await supabase.from("audit_log").insert({
        action: "cash_deposit:void",
        entity: "cash_deposits",
        user_id: user.id,
        user_name: profile?.full_name ?? user.email ?? null,
        branch_id: activeBranchId,
        meta: { deposit_id: voidTarget.id, amount: voidTarget.amount, method: voidTarget.method, reason },
      } as never);
      toast.success("Depósito anulado.");
      setVoidTarget(null); setVoidReason("");
      qc.invalidateQueries({ queryKey: ["deposits-shift"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo anular.");
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10">
      <div>
        <h1 className="font-display text-2xl md:text-3xl flex items-center gap-2">
          <ArrowDownToLine className="h-6 w-6 text-emerald-600" /> Depósitos
        </h1>
        <p className="text-sm text-muted-foreground">
          Registra dinero adicional que ingresa a la caja durante el turno. Sede activa: <b>{activeBranch?.name ?? "—"}</b>
        </p>
      </div>

      {!isOpen && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="py-4 text-sm text-amber-800">
            No es posible registrar depósitos porque no existe una caja abierta para esta sede.
          </CardContent>
        </Card>
      )}

      <Card className="rounded-3xl shadow-sm">
        <CardContent className="p-4 md:p-5 space-y-5">
          {/* Valor */}
          <div className="space-y-1.5">
            <Label className="text-base font-medium">Valor del depósito <span className="text-rose-600">*</span></Label>
            <div className="rounded-2xl border bg-white px-4 py-3 flex items-baseline justify-between gap-3">
              <Input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(formatThousands(e.target.value))}
                placeholder="0"
                disabled={!isOpen}
                className="border-0 shadow-none text-right text-3xl font-black tracking-tight tabular-nums focus-visible:ring-0 h-auto p-0"
              />
              <span className="text-sm text-muted-foreground">COP</span>
            </div>
            <div className="text-right font-display text-emerald-700 font-bold">{formatMoney(value)}</div>
            {errAmount && <p className="text-xs font-medium text-rose-600">{errAmount}</p>}
          </div>

          {/* Descripción */}
          <div className="space-y-1.5">
            <Label className="text-base font-medium">Descripción o motivo <span className="text-rose-600">*</span></Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej.: Reposición de base de caja, ajuste de efectivo, transferencia recibida…"
              disabled={!isOpen}
              className="min-h-[80px] rounded-xl"
            />
            {errDesc && <p className="text-xs font-medium text-rose-600">{errDesc}</p>}
          </div>

          {/* Medio */}
          <div className="space-y-2">
            <Label className="text-base font-medium">Medio del depósito <span className="text-rose-600">*</span></Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {METHODS.map((m) => {
                const selected = method === m.key;
                const Icon = m.icon;
                return (
                  <button
                    key={m.key}
                    type="button"
                    disabled={!isOpen}
                    onClick={() => setMethod(m.key)}
                    className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition active:scale-[0.98] disabled:opacity-50 ${
                      selected
                        ? `${m.color} border-transparent shadow-md ring-2 ${m.ring}`
                        : "bg-white border-gray-200 hover:border-emerald-400"
                    }`}
                  >
                    <span className={`grid h-10 w-10 place-items-center rounded-xl ${selected ? "bg-white/25" : "bg-emerald-50 text-emerald-700"}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="font-bold">{m.label}</div>
                      <div className={`text-[11px] ${selected ? "opacity-90" : "text-muted-foreground"}`}>
                        {m.key === "efectivo" ? "Suma al efectivo esperado" : `Suma al saldo de ${m.label}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {errMethod && <p className="text-xs font-medium text-rose-600">{errMethod}</p>}
          </div>

          <Button
            size="lg"
            disabled={!canSubmit || saving}
            onClick={() => setConfirmOpen(true)}
            className="w-full h-14 rounded-2xl text-base font-bold bg-emerald-600 hover:bg-emerald-700"
          >
            {saving ? "Registrando…" : "Registrar depósito"}
          </Button>
        </CardContent>
      </Card>

      {/* Totales del turno */}
      {isOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {METHODS.map((m) => (
            <Card key={m.key} className="rounded-2xl">
              <CardContent className="p-4">
                <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{m.label} · turno</div>
                <div className="mt-1 font-display text-2xl font-extrabold text-emerald-700">
                  {formatMoney(totals[m.key] ?? 0)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Historial */}
      <Card>
        <CardHeader><CardTitle>Depósitos del turno</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Medio</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((d) => (
                <TableRow key={d.id} className={d.status === "void" ? "opacity-60" : ""}>
                  <TableCell className="text-xs">{formatDate(d.created_at)}</TableCell>
                  <TableCell className="max-w-md truncate">{d.description}</TableCell>
                  <TableCell className="capitalize">{d.method}</TableCell>
                  <TableCell className="text-xs">{d.user_name ?? "—"}</TableCell>
                  <TableCell>
                    {d.status === "active" ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Activo
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-rose-600 border-rose-200">Anulado</Badge>
                    )}
                  </TableCell>
                  <TableCell className={`text-right font-mono ${d.status === "void" ? "line-through" : "font-bold text-emerald-700"}`}>
                    {formatMoney(d.amount)}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      {d.status === "active" && (
                        <Button size="sm" variant="outline" className="h-8 gap-1 border-rose-200 text-rose-600 hover:bg-rose-50"
                          onClick={() => { setVoidTarget(d); setVoidReason(""); }}>
                          <Ban className="h-3.5 w-3.5" /> Anular
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {deposits.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 7 : 6} className="text-center py-8 text-muted-foreground">
                    Aún no hay depósitos registrados en este turno.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confirmación */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar depósito</DialogTitle>
            <DialogDescription>Revisa los datos antes de registrar. Esta acción actualizará el saldo del turno.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <Row label="Valor" value={<span className="font-display text-lg font-extrabold text-emerald-700">{formatMoney(value)}</span>} />
            <Row label="Descripción" value={descTrim} />
            <Row label="Medio" value={<span className="capitalize font-semibold">{method || "—"}</span>} />
            <Row label="Usuario" value={profile?.full_name ?? user?.email ?? "—"} />
            <Row label="Sede" value={activeBranch?.name ?? "—"} />
            <Row label="Caja" value={cashSession ? `Abierta desde ${formatDate(cashSession.opened_at)}` : "—"} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>Cancelar</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={doSave} disabled={saving}>
              {saving ? "Registrando…" : "Confirmar depósito"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Anular */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => { if (!o) { setVoidTarget(null); setVoidReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular depósito</DialogTitle>
            <DialogDescription>Se revertirá el impacto en el saldo del turno. Ingresa el motivo.</DialogDescription>
          </DialogHeader>
          {voidTarget && (
            <div className="space-y-2 text-sm">
              <Row label="Valor" value={formatMoney(voidTarget.amount)} />
              <Row label="Medio" value={<span className="capitalize">{voidTarget.method}</span>} />
              <Row label="Descripción" value={voidTarget.description} />
              <Textarea placeholder="Motivo de la anulación" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="rounded-xl min-h-[80px]" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVoidTarget(null); setVoidReason(""); }} disabled={voiding}>Cancelar</Button>
            <Button variant="destructive" onClick={doVoid} disabled={voiding}>{voiding ? "Anulando…" : "Anular depósito"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
