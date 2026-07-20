import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendCashReport } from "@/lib/cash-report.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Mail, Save, Send, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface EmailRecipient { email: string; label?: string; enabled: boolean }

interface Branch {
  id: string;
  name: string;
  report_emails: unknown;
  report_emails_enabled: boolean | null;
  report_email: string | null;
}

const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export function CashReportEmailsTab() {
  const { data: branches, isLoading } = useQuery({
    queryKey: ["branches-report-emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, report_emails, report_emails_enabled, report_email")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Branch[];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Mail className="w-6 h-6 text-primary" /> Destinatarios del reporte de cierre
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Configura hasta <b>2 correos electrónicos por sede</b> para recibir automáticamente el reporte
          completo del cierre de caja. Al activar esta opción, el mensaje de WhatsApp enviado al teléfono
          de la sede será un aviso corto sin datos financieros.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Cargando sedes…</p>}

      {(branches ?? []).map((b) => (
        <BranchEmailCard key={b.id} branch={b} />
      ))}

      <DeliveryHistoryCard />
    </div>
  );
}

function BranchEmailCard({ branch }: { branch: Branch }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<EmailRecipient[]>([]);
  const [enabled, setEnabled] = useState<boolean>(branch.report_emails_enabled !== false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const raw = branch.report_emails;
    const arr = Array.isArray(raw) ? (raw as Array<Partial<EmailRecipient>>) : [];
    const initial: EmailRecipient[] = arr.slice(0, 2).map((r) => ({
      email: String(r.email ?? ""),
      label: String(r.label ?? ""),
      enabled: r.enabled !== false,
    }));
    // If no new-style emails but legacy field exists, seed from it
    if (initial.length === 0 && branch.report_email) {
      initial.push({ email: branch.report_email, label: "Legado", enabled: true });
    }
    // Always show 2 slots
    while (initial.length < 2) initial.push({ email: "", label: "", enabled: true });
    setRows(initial);
    setEnabled(branch.report_emails_enabled !== false);
  }, [branch.report_emails, branch.report_email, branch.report_emails_enabled]);

  const updateRow = (i: number, patch: Partial<EmailRecipient>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const clearRow = (i: number) => updateRow(i, { email: "", label: "" });

  const save = async () => {
    // Validate emails
    for (const r of rows) {
      if (r.email.trim() && !isValidEmail(r.email)) {
        toast.error(`Correo inválido: ${r.email}`);
        return;
      }
    }
    const clean = rows
      .filter((r) => r.email.trim())
      .map((r) => ({ email: r.email.trim(), label: r.label?.trim() || "", enabled: !!r.enabled }));

    setSaving(true);
    const { error } = await supabase
      .from("branches")
      .update({
        report_emails: clean,
        report_emails_enabled: enabled,
      } as never)
      .eq("id", branch.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Configuración guardada · ${branch.name}`);
    qc.invalidateQueries({ queryKey: ["branches-report-emails"] });
  };

  const sendReport = useServerFn(sendCashReport);
  const [testing, setTesting] = useState(false);
  const runTest = async () => {
    setTesting(true);
    try {
      // Find latest closed session for this branch, if any, to render a real report
      const { data: sess } = await supabase
        .from("cash_sessions")
        .select("id")
        .eq("branch_id", branch.id)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sess?.id) {
        toast.error("No hay cierres de caja previos en esta sede para usar como muestra.");
        return;
      }
      const r = await sendReport({ data: { sessionId: sess.id } }) as {
        sent?: boolean; count?: number; total?: number; skipped?: boolean; reason?: string;
        results?: Array<{ email: string; sent: boolean; error?: string }>;
      };
      if (r.skipped) { toast.warning(r.reason ?? "Envío omitido"); return; }
      if (r.sent) {
        toast.success(`Correo enviado a ${r.count}/${r.total} destinatarios`);
      } else {
        const err = r.results?.find((x) => !x.sent)?.error ?? "Error desconocido";
        toast.error(`Falló envío: ${err}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              {branch.name}
              {enabled ? <Badge className="bg-emerald-600">Activo</Badge> : <Badge variant="secondary">Inactivo</Badge>}
            </CardTitle>
            <CardDescription>Correos que recibirán el reporte de cierre de caja de esta sede.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`en-${branch.id}`} className="text-sm">Envío activo</Label>
            <Switch id={`en-${branch.id}`} checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
            <div className="md:col-span-6">
              <Label className="text-xs">Correo electrónico {i + 1}</Label>
              <Input
                type="email"
                value={r.email}
                onChange={(e) => updateRow(i, { email: e.target.value })}
                placeholder={`correo${i + 1}@empresa.com`}
              />
            </div>
            <div className="md:col-span-4">
              <Label className="text-xs">Nombre / rol (opcional)</Label>
              <Input
                value={r.label ?? ""}
                onChange={(e) => updateRow(i, { label: e.target.value })}
                placeholder="Administrador"
              />
            </div>
            <div className="md:col-span-1 flex items-center gap-2">
              <Switch checked={r.enabled} onCheckedChange={(v) => updateRow(i, { enabled: v })} />
            </div>
            <div className="md:col-span-1 flex justify-end">
              <Button variant="ghost" size="icon" onClick={() => clearRow(i)} title="Vaciar">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-2 border-t">
          <Button onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button variant="outline" onClick={runTest} disabled={testing}>
            <Send className="w-4 h-4 mr-2" />
            {testing ? "Enviando prueba…" : "Enviar prueba"}
          </Button>
          <p className="text-xs text-muted-foreground ml-auto">
            La prueba usa el <b>último cierre real</b> de esta sede.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DeliveryHistoryCard() {
  const { data } = useQuery({
    queryKey: ["cash-report-email-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_report_email_log")
        .select("id, recipient_email, status, error_message, created_at, branch_id")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial reciente de envíos</CardTitle>
        <CardDescription>Últimos 30 intentos de envío por correo.</CardDescription>
      </CardHeader>
      <CardContent>
        {(!data || data.length === 0) ? (
          <p className="text-sm text-muted-foreground">Aún no hay envíos registrados.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(r.created_at).toLocaleString("es-CO")}</TableCell>
                  <TableCell className="text-sm">{r.recipient_email}</TableCell>
                  <TableCell>
                    {r.status === "sent" ? (
                      <Badge className="bg-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1" /> Enviado</Badge>
                    ) : (
                      <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" /> Falló</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[380px] truncate" title={r.error_message ?? ""}>
                    {r.error_message ?? "OK"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
