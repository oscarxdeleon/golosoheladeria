import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBranch } from "@/contexts/branch-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Receipt, Upload, Delete, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/gastos")({
  head: () => ({ meta: [{ title: "Nuevo gasto · Goloso POS" }] }),
  component: GastosPage,
});

const MIN_DESCRIPTION_LEN = 5;

function GastosPage() {
  const qc = useQueryClient();
  const { user, profile, isAdmin } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();

  const [category, setCategory] = useState<string>("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [payment, setPayment] = useState("efectivo");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Categorías dinámicas administradas por el admin
  const { data: categories = [] } = useQuery({
    queryKey: ["expense-categories", "active", activeBranchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id,name,sort_order,branch_id")
        .eq("active", true)
        .is("deleted_at", null)
        .or(activeBranchId ? `branch_id.is.null,branch_id.eq.${activeBranchId}` : "branch_id.is.null")
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const categoryOptions = useMemo(
    () => categories.map((c) => c.name).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })),
    [categories],
  );

  const categoryError = !category ? "Debe seleccionar el tipo de gasto." : "";
  const descriptionError = !description.trim()
    ? "Debe escribir la descripción del gasto."
    : description.trim().length < MIN_DESCRIPTION_LEN
      ? `La descripción debe tener al menos ${MIN_DESCRIPTION_LEN} caracteres.`
      : "";

  // Turno/caja activa de la sede
  const { data: activeSession } = useQuery({
    queryKey: ["active-cash-session", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("id, opened_at")
        .eq("branch_id", activeBranchId!)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const activeSessionId = activeSession?.id ?? null;

  const { data: history = [] } = useQuery({
    queryKey: ["gastos-history", activeBranchId, activeSessionId],
    enabled: !!activeBranchId && !!activeSessionId,
    queryFn: async () => (await supabase
      .from("expenses")
      .select("*")
      .eq("branch_id", activeBranchId!)
      .eq("cash_session_id", activeSessionId!)
      .order("created_at", { ascending: false })
      .limit(50)).data ?? [],
  });

  // Realtime: refresca cuando se registra/actualiza un gasto del turno
  useEffect(() => {
    if (!activeBranchId || !activeSessionId) return;
    const channel = supabase
      .channel(`expenses-shift-${activeSessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter: `cash_session_id=eq.${activeSessionId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["gastos-history", activeBranchId, activeSessionId] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeBranchId, activeSessionId, qc]);

  async function save(overrideAmount?: number) {
    if (!user) return toast.error("Sin sesión");
    if (!activeBranchId) return toast.error("Selecciona una sede activa");
    const value = overrideAmount ?? Number(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Monto inválido");

    // Validación obligatoria de tipo y descripción
    if (categoryError || descriptionError) {
      setShowErrors(true);
      toast.error(categoryError || descriptionError);
      return;
    }

    setSaving(true);
    try {
      // Siempre asociar al turno activo (independientemente del método de pago)
      let cashSessionId: string | null = activeSessionId;
      if (!cashSessionId) {
        const { data: cs } = await supabase.rpc("sync_active_cash_session", {
          _branch_id: activeBranchId,
          _user_name: profile?.full_name ?? user.email ?? "Usuario",
        });
        cashSessionId = (cs as { id?: string } | null)?.id ?? null;
      }
      if (!cashSessionId) {
        setSaving(false);
        return toast.error("Necesitas tener la caja abierta para registrar gastos");
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
      // Sólo abrir el cajón cuando el gasto se pague en efectivo real.
      if (payment === "efectivo") {
        const { openCashDrawer } = await import("@/lib/cash-drawer");
        void openCashDrawer({ event: "cash_expense", operationId: cashSessionId ?? undefined });
      }
      setDescription(""); setAmount(""); setFile(null); setCategory(""); setShowErrors(false);
      qc.invalidateQueries({ queryKey: ["gastos-history"] });
      qc.invalidateQueries({ queryKey: ["active-cash-session"] });

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  // --- Calculadora ---
  function safeEval(expr: string): number {
    // Solo dígitos, . y operadores + - * /  %
    const cleaned = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
    if (!/^[0-9+\-*/.%\s]*$/.test(cleaned)) return NaN;
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const r = Function(`"use strict"; return (${cleaned || 0})`)();
      return typeof r === "number" && Number.isFinite(r) ? r : NaN;
    } catch { return NaN; }
  }
  const currentValue = (() => {
    const v = safeEval(amount);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  })();
  function pushKey(k: string) {
    setAmount((prev) => {
      if (k === "C") return "";
      if (k === "back") return prev.slice(0, -1);
      const ops = ["+", "-", "*", "/", "%"];
      const last = prev.slice(-1);
      if (ops.includes(k) && ops.includes(last)) return prev.slice(0, -1) + k;
      if (k === "." && /\.\d*$/.test(prev.split(/[+\-*/%]/).pop() ?? "")) return prev;
      return prev + k;
    });
  }
  const KeyBtn = ({ label, onClick, variant = "num", wide = false, className = "" }:
    { label: ReactNode; onClick: () => void; variant?: "num" | "op" | "act" | "primary"; wide?: boolean; className?: string }) => {
    const styles = {
      num: "bg-white hover:bg-gray-50 text-foreground shadow-sm border border-gray-200",
      op:  "bg-[#EAF4F6] hover:bg-[#d9ecef] text-[#0F5A68] font-semibold shadow-sm",
      act: "bg-[#EAF4F6] hover:bg-[#d9ecef] text-[#0F5A68] shadow-sm",
      primary: "bg-[#0F5A68] hover:bg-[#0c4a56] text-white font-bold shadow-md",
    }[variant];
    return (
      <button type="button" onClick={onClick}
        className={`${styles} ${wide ? "row-span-2" : ""} rounded-2xl h-14 text-2xl font-semibold active:scale-95 transition ${className}`}>
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-5 max-w-2xl mx-auto pb-8">
      <div>
        <h1 className="font-display text-2xl md:text-3xl flex items-center gap-2"><Receipt className="h-6 w-6" />Registrar gastos</h1>
        <p className="text-sm text-muted-foreground">Sede activa: <b>{activeBranch?.name ?? "—"}</b></p>
      </div>

      <Card className="rounded-3xl shadow-sm">
        <CardContent className="p-4 md:p-5 space-y-4">
          {/* Tipo de gasto */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-base font-medium">
                Tipo de gasto <span className="text-rose-600">*</span>
              </Label>
              {isAdmin && (
                <Link to="/tipos-gasto">
                  <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl" title="Administrar tipos de gasto">
                    <Settings2 className="h-3.5 w-3.5" />
                    <span className="text-xs">Administrar</span>
                  </Button>
                </Link>
              )}
            </div>

            {categoryOptions.length === 0 ? (
              <div className={`rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm text-muted-foreground ${showErrors && categoryError ? "border-rose-400 bg-rose-50" : "border-gray-200"}`}>
                No hay categorías activas. Pídele al administrador que cree una.
              </div>
            ) : (
              <RadioGroup
                value={category}
                onValueChange={(v) => { setCategory(v); setShowErrors(true); }}
                className={`grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-2xl p-2 border ${showErrors && categoryError ? "border-rose-400 bg-rose-50/40" : "border-gray-100 bg-gray-50/60"}`}
                aria-invalid={showErrors && !!categoryError}
              >
                {categoryOptions.map((c) => {
                  const selected = category === c;
                  return (
                    <label
                      key={c}
                      htmlFor={`cat-${c}`}
                      className={`group cursor-pointer select-none flex items-center gap-2.5 rounded-xl px-3 py-3 border transition active:scale-[0.98] ${
                        selected
                          ? "bg-[#0F5A68] text-white border-[#0F5A68] shadow-md"
                          : "bg-white text-foreground border-gray-200 hover:border-[#0F5A68]/50 hover:bg-[#EAF4F6]"
                      }`}
                    >
                      <RadioGroupItem
                        id={`cat-${c}`}
                        value={c}
                        className={selected ? "border-white text-white" : "border-gray-400"}
                      />
                      <span className="text-sm font-medium leading-tight">{c}</span>
                    </label>
                  );
                })}
              </RadioGroup>
            )}

            {showErrors && categoryError && (
              <p className="text-xs font-medium text-rose-600">Debe seleccionar una categoría para registrar el gasto.</p>
            )}
          </div>



          {/* Descripción */}
          <div className="space-y-1.5">
            <Label className="text-base font-medium">
              Descripción del gasto <span className="text-rose-600">*</span>
            </Label>
            <div className="relative">
              <Receipt className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => setShowErrors(true)}
                placeholder="Ej.: Compra de vasos desechables, pago de transporte…"
                aria-invalid={showErrors && !!descriptionError}
                className={`h-12 rounded-xl pl-10 text-base ${showErrors && descriptionError ? "border-rose-500 ring-1 ring-rose-500 focus-visible:ring-rose-500" : ""}`}
              />
            </div>
            {showErrors && descriptionError ? (
              <p className="text-xs font-medium text-rose-600">{descriptionError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Mínimo {MIN_DESCRIPTION_LEN} caracteres. Este motivo aparecerá en reportes, cierre de caja y auditoría.</p>
            )}
          </div>

          {/* Display valor */}
          <div className="rounded-2xl bg-white px-4 py-4 text-right border border-gray-100">
            <div className="text-2xl text-muted-foreground tabular-nums truncate min-h-[2rem]">
              {amount || "0"}
            </div>
            <div className="text-4xl font-black tracking-tight tabular-nums text-foreground">
              {formatMoney(currentValue)}
            </div>
          </div>

          {/* Teclado */}
          <div className="grid grid-cols-4 gap-2.5">
            <button type="button" onClick={() => pushKey("C")}
              className="rounded-2xl h-14 bg-[#E85A6E] hover:bg-[#d94a5e] text-white text-2xl font-bold shadow-md active:scale-95 transition">C</button>
            <KeyBtn variant="act" label={<Delete className="h-6 w-6 mx-auto" />} onClick={() => pushKey("back")} />
            <KeyBtn variant="op" label="%" onClick={() => pushKey("%")} />
            <KeyBtn variant="op" label="÷" onClick={() => pushKey("/")} />

            <KeyBtn label="7" onClick={() => pushKey("7")} />
            <KeyBtn label="8" onClick={() => pushKey("8")} />
            <KeyBtn label="9" onClick={() => pushKey("9")} />
            <KeyBtn variant="op" label="×" onClick={() => pushKey("*")} />

            <KeyBtn label="4" onClick={() => pushKey("4")} />
            <KeyBtn label="5" onClick={() => pushKey("5")} />
            <KeyBtn label="6" onClick={() => pushKey("6")} />
            <KeyBtn variant="op" label="−" onClick={() => pushKey("-")} />

            <KeyBtn label="1" onClick={() => pushKey("1")} />
            <KeyBtn label="2" onClick={() => pushKey("2")} />
            <KeyBtn label="3" onClick={() => pushKey("3")} />
            <button type="button" onClick={() => pushKey("+")}
              className="row-span-2 rounded-2xl bg-[#0F5A68] hover:bg-[#0c4a56] text-white text-3xl font-bold shadow-md active:scale-95 transition">+</button>

            <KeyBtn label="0" onClick={() => pushKey("0")} />
            <KeyBtn label="00" onClick={() => pushKey("00")} />
            <KeyBtn label="." onClick={() => pushKey(".")} />
          </div>

          {/* Método de pago */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <Label className="text-base font-medium shrink-0">Método de pago</Label>
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger className="h-12 rounded-xl max-w-[60%]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="efectivo">Efectivo de caja</SelectItem>
                <SelectItem value="nequi">Nequi</SelectItem>
                <SelectItem value="bancolombia">Cuenta bancaria</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Soporte */}
          <div>
            <Label className="flex items-center gap-1 text-sm text-muted-foreground mb-1"><Upload className="h-3.5 w-3.5" />Soporte (opcional)</Label>
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="rounded-xl" />
            {file && <p className="text-xs text-muted-foreground mt-1">{file.name}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" className="h-14 rounded-2xl text-base font-semibold"
          onClick={() => { setAmount(""); setDescription(""); setFile(null); }}>
          Limpiar
        </Button>
        <Button size="lg" onClick={() => save(currentValue)} disabled={saving || currentValue <= 0}
          className="h-14 rounded-2xl text-base font-bold bg-[#0F5A68] hover:bg-[#0c4a56]">
          {saving ? "Guardando…" : "Agregar gasto"}
        </Button>
      </div>


      <Card>
        <CardHeader>
          <CardTitle>Últimos gastos de esta sede</CardTitle>
          {activeSession?.opened_at && (
            <p className="text-xs text-muted-foreground">
              Turno actual abierto el {new Date(activeSession.opened_at).toLocaleString()}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h: { id: string; created_at: string; category: string; description: string; payment_method: string; amount: number; user_name: string | null }) => {
                const d = new Date(h.created_at);
                return (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs whitespace-nowrap">{d.toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{d.toLocaleTimeString()}</TableCell>
                    <TableCell>{h.category}</TableCell>
                    <TableCell className="max-w-md truncate">{h.description}</TableCell>
                    <TableCell className="capitalize">{h.payment_method}</TableCell>
                    <TableCell className="text-xs">{h.user_name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(h.amount)}</TableCell>
                  </TableRow>
                );
              })}
              {history.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {activeSessionId
                      ? "No hay gastos registrados en el turno actual."
                      : "No hay una caja abierta en esta sede."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}
