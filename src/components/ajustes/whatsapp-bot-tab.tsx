import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBranch } from "@/contexts/branch-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import {
  MessageCircle, Copy, RefreshCw, Plus, Trash2, QrCode, Download,
  Wifi, WifiOff, CircleAlert, Info, Smartphone, LogOut, RotateCw,
  Upload, Sparkles, Check, X,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useServerFn } from "@tanstack/react-start";
import { extractFaqsFromChat, type ExtractedFaq } from "@/lib/whatsapp-faq-import.functions";

interface BotConfigRow {
  branch_id: string;
  enabled: boolean;
  welcome_messages: string[];
  menu_triggers: string[];
  menu_message: string;
  connection_status: string;
  qr_code: string | null;
  qr_generated_at: string | null;
  last_seen_at: string | null;
  device_token: string;
  connected_phone: string | null;
  bot_version: string | null;
  last_outbound_poll_at: string | null;
  last_outbound_poll_status: string | null;
  last_outbound_poll_count: number | null;
  last_outbound_error: string | null;
  after_hours_enabled: boolean;
  after_hours_messages: string[];
  pickup_after_hours_enabled: boolean;
  pickup_after_hours_messages: string[];
  greet_cooldown_hours: number;
  short_reply_words: string[];
  ai_enabled: boolean;
  ai_sandbox_numbers: string[];
  ai_system_prompt: string | null;
  ai_last_reply_at: string | null;
}


interface BranchRow { id: string; name: string; slug: string | null; }
interface MessageRow {
  id: string;
  branch_id: string;
  from_number: string;
  direction: "in" | "out";
  body: string | null;
  matched_trigger: string | null;
  received_at: string;
}

const WHATSAPP_BOT_DOWNLOAD_URL = "/downloads/whatsapp-bot.zip";

function normalizeColombiaWhatsApp(raw: string): string {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  return digits.length === 10 ? `57${digits}` : digits;
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  connected:    { label: "Conectado",     color: "bg-emerald-500", icon: Wifi },
  connecting:   { label: "Conectando…",   color: "bg-amber-500",   icon: RefreshCw },
  qr:           { label: "Esperando QR",  color: "bg-amber-500",   icon: QrCode },
  disconnected: { label: "Desconectado",  color: "bg-slate-400",   icon: WifiOff },
  error:        { label: "Error",         color: "bg-rose-500",    icon: CircleAlert },
};

export function WhatsAppBotTab() {
  const { isAdmin } = useAuth();
  const { branches, activeBranchId } = useBranch();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState<string | null>(activeBranchId);

  useEffect(() => {
    if (!branchId && activeBranchId) setBranchId(activeBranchId);
  }, [activeBranchId, branchId]);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["whatsapp-bot-config", branchId],
    enabled: !!branchId,
    staleTime: 3_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_bot_config")
        .select("*")
        .eq("branch_id", branchId!)
        .maybeSingle();
      if (error) throw error;
      return data as BotConfigRow | null;
    },
  });

  // Realtime: escuchar cambios de esta sede para reflejar QR/estado al instante
  useEffect(() => {
    if (!branchId) return;
    const ch = supabase
      .channel(`whatsapp_bot_cfg_${branchId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "whatsapp_bot_config",
        filter: `branch_id=eq.${branchId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] });
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "whatsapp_bot_messages",
        filter: `branch_id=eq.${branchId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ["whatsapp-bot-messages", branchId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [branchId, qc]);

  const { data: messages = [] } = useQuery({
    queryKey: ["whatsapp-bot-messages", branchId],
    enabled: !!branchId,
    staleTime: 5_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_bot_messages")
        .select("*")
        .eq("branch_id", branchId!)
        .order("received_at", { ascending: false })
        .limit(50);
      return (data ?? []) as MessageRow[];
    },
  });

  if (isLoading || !cfg) {
    return <div className="p-8 text-sm text-muted-foreground">Cargando configuración del bot…</div>;
  }

  return (
    <div className="space-y-6">
      {isAdmin && branches.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sede</CardTitle>
            <CardDescription>Cada sede tiene su propio bot y su propio número de WhatsApp.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={branchId ?? undefined} onValueChange={(v) => setBranchId(v)}>
              <SelectTrigger className="w-full sm:w-80"><SelectValue placeholder="Elegir sede…" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <StatusCard cfg={cfg} branch={branches.find((b) => b.id === cfg.branch_id) as BranchRow | undefined} onChanged={() => qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] })} />
      <InstallCard cfg={cfg} />
      <WelcomeCard cfg={cfg} onSaved={() => qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] })} />
      <FrequencyCard cfg={cfg} onSaved={() => qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] })} />

      <AfterHoursCard cfg={cfg} branch={branches.find((b) => b.id === cfg.branch_id) as BranchRow | undefined} onSaved={() => qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] })} />
      <PickupAfterHoursCard cfg={cfg} branch={branches.find((b) => b.id === cfg.branch_id) as BranchRow | undefined} onSaved={() => qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] })} />
      <MenuTriggersCard cfg={cfg} branch={branches.find((b) => b.id === cfg.branch_id) as BranchRow | undefined} onSaved={() => qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] })} />
      <AiAssistantCard cfg={cfg} onSaved={() => qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] })} />
      <FaqManagerCard branchId={cfg.branch_id} />
      <ReportRecipientsCard branchId={cfg.branch_id} />
      <MessagesCard messages={messages} />
    </div>
  );
}

/* --------------------------------------------------------- */

function StatusCard({ cfg, branch, onChanged }: { cfg: BotConfigRow; branch?: BranchRow; onChanged: () => void }) {
  const meta = STATUS_META[cfg.connection_status] ?? STATUS_META.disconnected;
  const Icon = meta.icon;
  const [qrOpen, setQrOpen] = useState(false);
  const lastSeenText = useMemo(() => {
    if (!cfg.last_seen_at) return "Nunca";
    const diff = Date.now() - new Date(cfg.last_seen_at).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "Hace un instante";
    if (m < 60) return `Hace ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `Hace ${h} h`;
    return new Date(cfg.last_seen_at).toLocaleString();
  }, [cfg.last_seen_at]);

  const toggleEnabled = async (v: boolean) => {
    const { error } = await supabase.from("whatsapp_bot_config").update({ enabled: v }).eq("branch_id", cfg.branch_id);
    if (error) { toast.error(error.message); return; }
    toast.success(v ? "Bot activado" : "Bot desactivado");
    onChanged();
  };

  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [busyCmd, setBusyCmd] = useState<"unlink" | "reconnect" | null>(null);

  const sendCommand = async (command: "unlink" | "reconnect") => {
    setBusyCmd(command);
    const { error } = await supabase.rpc("whatsapp_bot_request_command", {
      _branch_id: cfg.branch_id,
      _command: command,
    });
    setBusyCmd(null);
    if (error) { toast.error(error.message); return; }
    toast.success(
      command === "unlink"
        ? "Solicitud enviada. En unos segundos el bot borrará la sesión y generará un nuevo QR."
        : "Solicitud enviada. El bot está reconectándose."
    );
    onChanged();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" /> Estado del bot</CardTitle>
        <CardDescription>Conexión con WhatsApp de la sede {branch?.name ?? ""}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
          <div className={`grid h-14 w-14 place-items-center rounded-full ${meta.color} text-white shadow-lg`}>
            <Icon className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold">{meta.label}</div>
            <div className="text-xs text-muted-foreground">Última señal: {lastSeenText}</div>
            {cfg.connected_phone && <div className="text-xs text-muted-foreground">Número: +{cfg.connected_phone}</div>}
            {cfg.bot_version && <div className="text-xs text-muted-foreground">Versión instalada: v{cfg.bot_version}</div>}
            {cfg.last_outbound_poll_at && (
              <div className="text-xs text-muted-foreground">
                Cola de reportes: revisada {new Date(cfg.last_outbound_poll_at).toLocaleTimeString()}
                {typeof cfg.last_outbound_poll_count === "number" ? ` · ${cfg.last_outbound_poll_count} pendiente(s)` : ""}
              </div>
            )}
            {cfg.last_outbound_error && (
              <div className="mt-1 text-xs font-medium text-destructive">Error envío reportes: {cfg.last_outbound_error}</div>
            )}
            {cfg.qr_generated_at && cfg.connection_status !== "connected" && (
              <div className="text-xs text-muted-foreground">QR generado: {new Date(cfg.qr_generated_at).toLocaleString()}</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
              <QrCode className="mr-2 h-4 w-4" /> Ver / Generar QR
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendCommand("reconnect")}
              disabled={busyCmd !== null}
            >
              <RotateCw className={`mr-2 h-4 w-4 ${busyCmd === "reconnect" ? "animate-spin" : ""}`} /> Reconectar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setUnlinkOpen(true)}
              disabled={busyCmd !== null}
            >
              <LogOut className="mr-2 h-4 w-4" /> Desvincular dispositivo
            </Button>
            <div className="flex items-center gap-2">
              <Switch id="bot-enabled" checked={cfg.enabled} onCheckedChange={toggleEnabled} />
              <Label htmlFor="bot-enabled" className="text-sm font-semibold">Bot activo</Label>
            </div>
          </div>
        </div>

        <AlertDialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Desvincular el dispositivo actual?</AlertDialogTitle>
              <AlertDialogDescription>
                Se cerrará la sesión de WhatsApp en el PC de la sede, se eliminará la sesión almacenada y se invalidará el QR anterior.
                Será necesario escanear un nuevo código QR para volver a conectar el bot. El PC no necesita reinstalación.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => sendCommand("unlink")}>Sí, desvincular</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>


        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Escanea el QR desde WhatsApp</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Abre WhatsApp Business en el celular de la sede.</li>
                <li>Menú (⋮) → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.</li>
                <li>Escanea este código.</li>
              </ol>
              <div className="grid place-items-center rounded-xl border bg-white p-4 min-h-[320px]">
                {cfg.qr_code ? (
                  <QRCodeCanvas value={cfg.qr_code} size={280} includeMargin />
                ) : (
                  <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
                    <QrCode className="mx-auto h-10 w-10 opacity-40" />
                    <p className="font-semibold text-foreground">Aún no hay QR disponible</p>
                    <p>Instala el bot en el PC de la sede. Si ya lo instalaste, abre <b>http://localhost:8790</b> en ese mismo PC: allí debe aparecer el QR o el error exacto.</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">El QR se refresca solo mientras el bot está en modo de vinculación.</p>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */

function InstallCard({ cfg }: { cfg: BotConfigRow }) {
  const [showToken, setShowToken] = useState(false);
  const copyToken = async () => {
    await navigator.clipboard.writeText(cfg.device_token);
    toast.success("Token copiado");
  };
  const rotateToken = async () => {
    if (!confirm("Regenerar el token invalidará el bot instalado hasta configurar el nuevo token. ¿Continuar?")) return;
    const { data, error } = await supabase.rpc("whatsapp_bot_rotate_token", { _branch_id: cfg.branch_id });
    if (error) { toast.error(error.message); return; }
    toast.success("Token regenerado. Configura el bot con el nuevo token.");
    // Realtime actualizará la vista
    void data;
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-primary" /> Instalación en el PC de la sede</CardTitle>
          <CardDescription>Descarga el bot. Si ya estaba vinculado, actualízalo sin token y sin QR.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">1</span> Si no sabes dónde quedó instalado, descarga el ZIP nuevo y ejecuta <code>SOLUCION-SIN-SABER-CARPETA.bat</code>.</li>
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">2</span> El actualizador hará una búsqueda profunda, conserva <code>config.json</code> y <code>auth_state</code>, y no pide token ni QR.</li>
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">3</span> Si por error ejecutas <code>install-windows.bat</code>, también intentará actualizar automáticamente antes de pedir token.</li>
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">4</span> Solo una instalación totalmente nueva necesita token y vinculación por QR.</li>
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">5</span> Estado pasa a <b>Conectado</b>. Al reiniciar el PC el bot se recupera solo.</li>
        </ol>

        <div className="rounded-xl border bg-muted/40 p-4 space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Token de esta sede</Label>
            <div className="mt-1 flex gap-2">
              <Input
                readOnly
                value={showToken ? cfg.device_token : "•".repeat(Math.min(cfg.device_token.length, 32))}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="outline" size="sm" onClick={() => setShowToken((v) => !v)}>{showToken ? "Ocultar" : "Ver"}</Button>
              <Button variant="outline" size="sm" onClick={copyToken}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Guárdalo en secreto. Si sospechas que alguien más lo tiene, regenéralo.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={WHATSAPP_BOT_DOWNLOAD_URL} download="whatsapp-bot.zip">
                <Download className="mr-2 h-4 w-4" /> Descargar actualización sin QR
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={rotateToken}>
              <RefreshCw className="mr-2 h-4 w-4" /> Regenerar token
            </Button>
          </div>
          <p className="text-xs text-muted-foreground flex gap-1.5 items-start">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Para actualizar sin saber la carpeta anterior, usa SOLUCION-SIN-SABER-CARPETA.bat. Solo se pedirá QR si auth_state fue borrada o WhatsApp cerró la sesión.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */

function WelcomeCard({ cfg, onSaved }: { cfg: BotConfigRow; onSaved: () => void }) {
  const [messages, setMessages] = useState<string[]>(cfg.welcome_messages ?? []);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMessages(cfg.welcome_messages ?? []); }, [cfg.welcome_messages]);

  const save = async () => {
    const clean = messages.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) { toast.error("Debe haber al menos 1 mensaje"); return; }
    setSaving(true);
    const { error } = await supabase.from("whatsapp_bot_config").update({ welcome_messages: clean }).eq("branch_id", cfg.branch_id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Mensajes de bienvenida guardados");
    onSaved();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Mensajes de bienvenida</CardTitle>
        <CardDescription>El bot rota estos mensajes aleatoriamente cuando alguien escribe por primera vez en el día.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {messages.map((m, i) => (
          <div key={i} className="flex gap-2">
            <span className="mt-2 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
            <Textarea
              value={m}
              onChange={(e) => setMessages((arr) => arr.map((x, ix) => ix === i ? e.target.value : x))}
              rows={2}
              placeholder="Ej: ¡Hola! Gracias por escribir a Goloso 🍨"
            />
            <Button variant="ghost" size="icon" onClick={() => setMessages((arr) => arr.filter((_, ix) => ix !== i))} disabled={messages.length <= 1}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setMessages((arr) => [...arr, ""])}>
            <Plus className="mr-2 h-4 w-4" /> Agregar mensaje
          </Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */

const COOLDOWN_OPTIONS: { value: number; label: string }[] = [
  { value: 0,   label: "Siempre responder (sin cooldown)" },
  { value: 3,   label: "Cada 3 horas" },
  { value: 6,   label: "Cada 6 horas" },
  { value: 12,  label: "Cada 12 horas" },
  { value: 24,  label: "Una vez al día (24 horas) — recomendado" },
  { value: 48,  label: "Cada 2 días (48 horas)" },
  { value: 168, label: "Una vez por semana" },
];

function FrequencyCard({ cfg, onSaved }: { cfg: BotConfigRow; onSaved: () => void }) {
  const [hours, setHours] = useState<number>(cfg.greet_cooldown_hours ?? 24);
  const [shortWords, setShortWords] = useState<string>((cfg.short_reply_words ?? []).join(", "));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHours(cfg.greet_cooldown_hours ?? 24);
    setShortWords((cfg.short_reply_words ?? []).join(", "));
  }, [cfg.greet_cooldown_hours, cfg.short_reply_words]);

  const save = async () => {
    setSaving(true);
    const words = shortWords
      .split(/[,\n]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const { error } = await supabase
      .from("whatsapp_bot_config")
      .update({ greet_cooldown_hours: hours, short_reply_words: words })
      .eq("branch_id", cfg.branch_id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Frecuencia guardada");
    onSaved();
  };

  const isPreset = COOLDOWN_OPTIONS.some((o) => o.value === hours);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Frecuencia de respuesta automática</CardTitle>
        <CardDescription>
          Define cada cuánto puede el bot volver a saludar automáticamente al mismo cliente.
          Así evitas que el saludo se sienta como spam.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Volver a saludar al mismo número</Label>
          <Select
            value={isPreset ? String(hours) : "custom"}
            onValueChange={(v) => { if (v !== "custom") setHours(parseInt(v, 10)); }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {COOLDOWN_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
              ))}
              {!isPreset && <SelectItem value="custom">Personalizado ({hours} h)</SelectItem>}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Si el cliente vuelve a escribir dentro de este tiempo, el bot guarda silencio
            (asumiendo que ya está en conversación con alguien de la sede).
          </p>
        </div>

        <div className="space-y-2">
          <Label>Palabras cortas que NO deben re-activar el saludo</Label>
          <Textarea
            value={shortWords}
            onChange={(e) => setShortWords(e.target.value)}
            rows={3}
            placeholder="gracias, ok, listo, si, vale, confirmo…"
          />
          <p className="text-xs text-muted-foreground">
            Separadas por coma. Cuando el cliente responde solo una de estas palabras
            (confirmaciones típicas), el bot no manda saludo automático.
          </p>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <Info className="h-4 w-4" /> Recomendación
          </div>
          <p>
            Deja <b>24 horas</b> para que el cliente perciba al bot como atento pero discreto.
            El sistema además rota los mensajes de bienvenida sin repetir el último enviado a ese número.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar frecuencia"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */



function AfterHoursCard({ cfg, branch, onSaved }: { cfg: BotConfigRow; branch?: BranchRow; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(cfg.after_hours_enabled);
  const [messages, setMessages] = useState<string[]>(cfg.after_hours_messages ?? []);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setEnabled(cfg.after_hours_enabled);
    setMessages(cfg.after_hours_messages ?? []);
  }, [cfg.after_hours_enabled, cfg.after_hours_messages]);

  const menuLink = branch?.slug ? `https://golosoheladeria.vercel.app/menu?sede=${branch.slug}` : "(sin slug de sede)";

  const save = async () => {
    const clean = messages.map((s) => s.trim()).filter(Boolean);
    if (enabled && clean.length === 0) { toast.error("Debe haber al menos 1 mensaje si está activo"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_bot_config")
      .update({ after_hours_enabled: enabled, after_hours_messages: clean })
      .eq("branch_id", cfg.branch_id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Mensajes fuera de horario guardados");
    onSaved();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Mensajes fuera de horario</CardTitle>
            <CardDescription>
              Cuando el <b>servicio a domicilio</b> de esta sede está cerrado (según los horarios de la sede),
              el bot responde con uno de estos mensajes e invita al cliente a programar su pedido. Usa <code>{"{menu_link}"}</code> para insertar el link del menú online.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch id="ah-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="ah-enabled" className="text-sm font-semibold">Activo</Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {messages.map((m, i) => (
          <div key={i} className="flex gap-2">
            <span className="mt-2 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-500/10 text-xs font-bold text-amber-600">{i + 1}</span>
            <Textarea
              value={m}
              onChange={(e) => setMessages((arr) => arr.map((x, ix) => ix === i ? e.target.value : x))}
              rows={3}
              placeholder="Ej: ¡Hola! Ahora estamos cerrados. Programa tu pedido en {menu_link}"
              disabled={!enabled}
            />
            <Button variant="ghost" size="icon" onClick={() => setMessages((arr) => arr.filter((_, ix) => ix !== i))} disabled={messages.length <= 1 || !enabled}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setMessages((arr) => [...arr, ""])} disabled={!enabled}>
            <Plus className="mr-2 h-4 w-4" /> Agregar mensaje
          </Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <b>Link que reemplaza <code>{"{menu_link}"}</code>:</b> {menuLink}
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */

function PickupAfterHoursCard({ cfg, branch, onSaved }: { cfg: BotConfigRow; branch?: BranchRow; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(cfg.pickup_after_hours_enabled);
  const [messages, setMessages] = useState<string[]>(cfg.pickup_after_hours_messages ?? []);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setEnabled(cfg.pickup_after_hours_enabled);
    setMessages(cfg.pickup_after_hours_messages ?? []);
  }, [cfg.pickup_after_hours_enabled, cfg.pickup_after_hours_messages]);

  const menuLink = branch?.slug ? `https://golosoheladeria.vercel.app/menu?sede=${branch.slug}` : "(sin slug de sede)";

  const save = async () => {
    const clean = messages.map((s) => s.trim()).filter(Boolean);
    if (enabled && clean.length === 0) { toast.error("Debe haber al menos 1 mensaje si está activo"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_bot_config")
      .update({ pickup_after_hours_enabled: enabled, pickup_after_hours_messages: clean })
      .eq("branch_id", cfg.branch_id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Mensajes de 'solo recoger / consumir en local' guardados");
    onSaved();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Domicilio cerrado, heladería abierta</CardTitle>
            <CardDescription>
              Cuando el <b>servicio a domicilio</b> ya cerró pero la <b>heladería sigue atendiendo</b> (recoger o consumir en el local),
              el bot responderá con uno de estos mensajes. Usa <code>{"{menu_link}"}</code> para insertar el link del menú online.
              Si la heladería también está cerrada, se usan los mensajes de "fuera de horario" de arriba.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch id="pah-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="pah-enabled" className="text-sm font-semibold">Activo</Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {messages.map((m, i) => (
          <div key={i} className="flex gap-2">
            <span className="mt-2 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-600">{i + 1}</span>
            <Textarea
              value={m}
              onChange={(e) => setMessages((arr) => arr.map((x, ix) => ix === i ? e.target.value : x))}
              rows={3}
              placeholder="Ej: Domicilios cerrados, pero puedes pasar a recoger. Menú: {menu_link}"
              disabled={!enabled}
            />
            <Button variant="ghost" size="icon" onClick={() => setMessages((arr) => arr.filter((_, ix) => ix !== i))} disabled={messages.length <= 1 || !enabled}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setMessages((arr) => [...arr, ""])} disabled={!enabled}>
            <Plus className="mr-2 h-4 w-4" /> Agregar mensaje
          </Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
        </div>
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <b>Link que reemplaza <code>{"{menu_link}"}</code>:</b> {menuLink}
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */


function MenuTriggersCard({ cfg, branch, onSaved }: { cfg: BotConfigRow; branch?: BranchRow; onSaved: () => void }) {
  const [triggers, setTriggers] = useState<string[]>(cfg.menu_triggers ?? []);
  const [message, setMessage] = useState(cfg.menu_message);
  const [newTrigger, setNewTrigger] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setTriggers(cfg.menu_triggers ?? []); setMessage(cfg.menu_message); }, [cfg.menu_triggers, cfg.menu_message]);

  const menuLink = branch?.slug ? `https://golosoheladeria.vercel.app/menu?sede=${branch.slug}` : "(sin slug de sede)";
  const preview = message.replace("{menu_link}", menuLink);

  const addTrigger = () => {
    const t = newTrigger.trim().toLowerCase();
    if (!t) return;
    if (triggers.includes(t)) { setNewTrigger(""); return; }
    setTriggers((arr) => [...arr, t]);
    setNewTrigger("");
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("whatsapp_bot_config").update({ menu_triggers: triggers, menu_message: message }).eq("branch_id", cfg.branch_id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Configuración de menú guardada");
    onSaved();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Envío automático del menú</CardTitle>
        <CardDescription>Cuando el cliente escribe cualquiera de estas palabras, el bot le envía el link del menú online de esta sede.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">Palabras clave</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {triggers.map((t) => (
              <Badge key={t} variant="secondary" className="gap-1 pl-3 pr-2 py-1.5 text-sm">
                {t}
                <button type="button" onClick={() => setTriggers((arr) => arr.filter((x) => x !== t))} className="rounded-full p-0.5 hover:bg-black/10">
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input value={newTrigger} onChange={(e) => setNewTrigger(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTrigger())} placeholder="Ej: menú, carta, pedido…" className="max-w-xs" />
            <Button variant="outline" size="sm" onClick={addTrigger}><Plus className="mr-2 h-4 w-4" /> Agregar</Button>
          </div>
        </div>

        <div>
          <Label className="text-xs">Mensaje que se envía</Label>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="mt-1" />
          <p className="mt-1 text-xs text-muted-foreground">Usa <code>{"{menu_link}"}</code> donde quieras que aparezca el link.</p>
        </div>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Vista previa</div>
          <div className="whitespace-pre-wrap">{preview}</div>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */

function MessagesCard({ messages }: { messages: MessageRow[] }) {
  const [filter, setFilter] = useState("");
  const filtered = filter ? messages.filter((m) => m.from_number.includes(filter)) : messages;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Últimos mensajes</CardTitle>
        <CardDescription>50 más recientes (entrantes y respuestas del bot).</CardDescription>
      </CardHeader>
      <CardContent>
        <Input placeholder="Filtrar por número…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3 max-w-xs" />
        <div className="rounded-lg border divide-y max-h-[420px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">Sin mensajes todavía.</div>
          )}
          {filtered.map((m) => (
            <div key={m.id} className={`p-3 text-sm ${m.direction === "in" ? "bg-background" : "bg-emerald-50/50 dark:bg-emerald-950/20"}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={m.direction === "in" ? "outline" : "secondary"} className="uppercase text-[10px]">
                    {m.direction === "in" ? "Entrante" : "Bot"}
                  </Badge>
                  <span className="font-mono">{m.from_number}</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{new Date(m.received_at).toLocaleString()}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm">{m.body}</div>
              {m.matched_trigger && (
                <div className="mt-1 text-[11px] text-muted-foreground">Trigger: <span className="font-mono">{m.matched_trigger}</span></div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */

interface ReportNumber { phone: string; label: string; enabled: boolean }

function ReportRecipientsCard({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ReportNumber[]>([]);
  const [saving, setSaving] = useState(false);
  const [testingIdx, setTestingIdx] = useState<number | null>(null);

  const { data: branch } = useQuery({
    queryKey: ["branch-report-wa", branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, report_whatsapp_numbers")
        .eq("id", branchId)
        .single();
      if (error) throw error;
      return data as { id: string; name: string; report_whatsapp_numbers: unknown };
    },
  });

  useEffect(() => {
    const raw = (branch?.report_whatsapp_numbers ?? []) as unknown;
    const arr = Array.isArray(raw) ? (raw as Array<Partial<ReportNumber>>) : [];
    setRows(arr.map((n) => ({
      phone: String(n.phone ?? ""),
      label: String(n.label ?? ""),
      enabled: n.enabled !== false,
    })));
  }, [branch?.report_whatsapp_numbers]);

  const addRow = () => {
    if (rows.length >= 5) { toast.error("Máximo 5 destinatarios"); return; }
    setRows((prev) => [...prev, { phone: "", label: "", enabled: true }]);
  };
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<ReportNumber>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const save = async () => {
    const clean = rows
      .map((r) => ({ phone: normalizeColombiaWhatsApp(r.phone), label: r.label.trim(), enabled: !!r.enabled }))
      .filter((r) => r.phone.length >= 10);
    setSaving(true);
    const { error } = await supabase
      .from("branches")
      .update({ report_whatsapp_numbers: clean } as never)
      .eq("id", branchId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Destinatarios guardados");
    qc.invalidateQueries({ queryKey: ["branch-report-wa", branchId] });
  };

  const sendTest = async (i: number) => {
    const row = rows[i];
    const phone = normalizeColombiaWhatsApp(row.phone);
    if (phone.length < 10) { toast.error("Número inválido"); return; }
    setTestingIdx(i);
    const body = `🍦 *Prueba de envío · Goloso*\n\nEste es un mensaje de prueba del reporte de cierre de caja.\nSi lo recibes, la configuración está correcta.\n\n_Goloso POS_`;
    const { error } = await supabase
      .from("whatsapp_outbound_queue")
      .insert({ branch_id: branchId, to_phone: phone, body, purpose: "test" } as never);
    setTestingIdx(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Prueba encolada. Debe llegar en menos de 30s si el bot está conectado.");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" /> Reporte de Cierre de Caja</CardTitle>
        <CardDescription>Al cerrar caja, el sistema envía automáticamente el resumen por WhatsApp a estos números. Máx 5.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground italic">Aún no has agregado destinatarios.</p>
        )}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto_auto_auto] gap-2 items-center">
            <Input
              placeholder="Número (ej: 3001234567)"
              value={r.phone}
              onChange={(e) => updateRow(i, { phone: e.target.value })}
              inputMode="tel"
            />
            <Input
              placeholder="Etiqueta (ej: Dueño)"
              value={r.label}
              onChange={(e) => updateRow(i, { label: e.target.value })}
            />
            <div className="flex items-center gap-1.5">
              <Switch checked={r.enabled} onCheckedChange={(v) => updateRow(i, { enabled: v })} />
              <span className="text-xs text-muted-foreground">{r.enabled ? "Activo" : "Pausado"}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => sendTest(i)} disabled={testingIdx === i}>
              {testingIdx === i ? "…" : "Prueba"}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => removeRow(i)}>
              <Trash2 className="h-4 w-4 text-rose-600" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" size="sm" onClick={addRow} disabled={rows.length >= 5}>
            <Plus className="mr-2 h-4 w-4" /> Agregar número
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground flex gap-1.5 items-start pt-1">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          El mensaje se envía desde el bot local de la sede. El cajero nunca ve el contenido enviado.
        </p>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */
/* Asistente IA (Fase 1 MVP) — Modo sandbox                  */
/* --------------------------------------------------------- */

const DEFAULT_AI_PROMPT = `Eres el asistente virtual de Heladería Goloso. Tono cercano, juvenil y con emojis de helado 🍦🍨. Respuestas cortas (2-3 líneas máx). Si el cliente quiere pedir, dirígelo al link del menú. Si pregunta por sabores o precios específicos, envíale el link. No inventes promociones ni precios. Si no sabes algo, di que un asesor lo contacta pronto. Responde SIEMPRE en español.`;

function AiAssistantCard({ cfg, onSaved }: { cfg: BotConfigRow; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(cfg.ai_enabled);
  const [numbersText, setNumbersText] = useState<string>((cfg.ai_sandbox_numbers ?? []).join("\n"));
  const [prompt, setPrompt] = useState<string>(cfg.ai_system_prompt ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(cfg.ai_enabled);
    setNumbersText((cfg.ai_sandbox_numbers ?? []).join("\n"));
    setPrompt(cfg.ai_system_prompt ?? "");
  }, [cfg.branch_id, cfg.ai_enabled, cfg.ai_sandbox_numbers, cfg.ai_system_prompt]);

  const parsedNumbers = useMemo(() => {
    return numbersText
      .split(/[\n,;]+/)
      .map((n) => n.trim())
      .filter(Boolean);
  }, [numbersText]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_bot_config")
      .update({
        ai_enabled: enabled,
        ai_sandbox_numbers: parsedNumbers,
        ai_system_prompt: prompt.trim() ? prompt.trim() : null,
      })
      .eq("branch_id", cfg.branch_id);
    setSaving(false);
    if (error) {
      toast.error("No se pudo guardar", { description: error.message });
      return;
    }
    toast.success("Asistente IA actualizado");
    onSaved();
  };

  return (
    <Card className="border-violet-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">🤖</span> Asistente IA
              <Badge variant="secondary" className="ml-1 bg-violet-100 text-violet-700 hover:bg-violet-100">Beta</Badge>
            </CardTitle>
            <CardDescription>
              Cuando el bot no tiene una respuesta fija (bienvenida, menú, fuera de horario), la IA responde
              de forma natural, incluye interpretación de notas de voz 🎙️. En modo pruebas solo responde a los
              números autorizados.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label htmlFor="ai-enabled" className="text-sm">Activar</Label>
            <Switch id="ai-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="ai-numbers" className="text-sm font-medium">
            Números autorizados en pruebas (modo sandbox)
          </Label>
          <Textarea
            id="ai-numbers"
            value={numbersText}
            onChange={(e) => setNumbersText(e.target.value)}
            placeholder={"573001234567\n573109876543"}
            rows={4}
            className="mt-1 font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1.5 flex gap-1.5 items-start">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Uno por línea. Formato con código de país (Colombia: 57…). La IA <b>solo</b> responderá a estos
            números; los demás clientes seguirán viendo las respuestas fijas actuales.
          </p>
          {parsedNumbers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {parsedNumbers.map((n) => (
                <Badge key={n} variant="outline" className="font-mono text-xs">{n}</Badge>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <Label htmlFor="ai-prompt" className="text-sm font-medium">Personalidad del asistente</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPrompt(DEFAULT_AI_PROMPT)}
            >
              Usar valor por defecto
            </Button>
          </div>
          <Textarea
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={DEFAULT_AI_PROMPT}
            rows={5}
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Deja vacío para usar la personalidad por defecto (juvenil, con emojis). El nombre de la sede,
            los horarios y el link del menú se agregan automáticamente al prompt.
          </p>
        </div>

        {cfg.ai_last_reply_at && (
          <p className="text-xs text-muted-foreground">
            Última respuesta IA: {new Date(cfg.ai_last_reply_at).toLocaleString("es-CO")}
          </p>
        )}

        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------- */
/* FAQs — Preguntas y respuestas frecuentes por sede         */
/* --------------------------------------------------------- */

interface FaqRow {
  id: string;
  branch_id: string;
  question: string;
  answer: string;
  sort_order: number;
  active: boolean;
}

function FaqManagerCard({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const { data: faqs = [], isLoading } = useQuery<FaqRow[]>({
    queryKey: ["whatsapp-bot-faqs", branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_bot_faqs")
        .select("id, branch_id, question, answer, sort_order, active")
        .eq("branch_id", branchId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as FaqRow[];
    },
  });

  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [saving, setSaving] = useState(false);

  // ---- Importador de chat .txt ----
  const extractFn = useServerFn(extractFaqsFromChat);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<Array<ExtractedFaq & { keep: boolean }>>([]);
  const [importOpen, setImportOpen] = useState(false);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Archivo muy grande (máx 5 MB)");
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const result = await extractFn({ data: { text, branchId } });
      if (!result.pairs.length) {
        toast.warning(result.warnings[0] ?? "No se encontraron preguntas útiles");
        setImporting(false);
        return;
      }
      setPreview(result.pairs.map((p) => ({ ...p, keep: true })));
      setImportOpen(true);
    } catch (err) {
      toast.error("Error al procesar el chat", { description: (err as Error).message });
    } finally {
      setImporting(false);
    }
  };

  const saveImported = async () => {
    const chosen = preview.filter((p) => p.keep && p.question.trim() && p.answer.trim());
    if (!chosen.length) {
      toast.error("Marca al menos una pregunta");
      return;
    }
    setImporting(true);
    let order = (faqs.at(-1)?.sort_order ?? 0) + 10;
    const rows = chosen.map((p) => ({
      branch_id: branchId,
      question: p.question.trim(),
      answer: p.answer.trim(),
      sort_order: (order += 10),
      active: true,
    }));
    const { error } = await supabase.from("whatsapp_bot_faqs").insert(rows);
    setImporting(false);
    if (error) {
      toast.error("No se pudieron guardar", { description: error.message });
      return;
    }
    toast.success(`${rows.length} preguntas agregadas`);
    setPreview([]);
    setImportOpen(false);
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
  };


  const add = async () => {
    const question = q.trim();
    const answer = a.trim();
    if (!question || !answer) {
      toast.error("Escribe la pregunta y la respuesta");
      return;
    }
    setSaving(true);
    const nextOrder = (faqs.at(-1)?.sort_order ?? 0) + 10;
    const { error } = await supabase.from("whatsapp_bot_faqs").insert({
      branch_id: branchId,
      question,
      answer,
      sort_order: nextOrder,
      active: true,
    });
    setSaving(false);
    if (error) {
      toast.error("No se pudo agregar", { description: error.message });
      return;
    }
    setQ("");
    setA("");
    toast.success("Pregunta agregada");
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
  };

  const updateField = async (id: string, patch: Partial<FaqRow>) => {
    const { error } = await supabase.from("whatsapp_bot_faqs").update(patch).eq("id", id);
    if (error) toast.error("No se pudo actualizar", { description: error.message });
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("whatsapp_bot_faqs").delete().eq("id", id);
    if (error) {
      toast.error("No se pudo eliminar", { description: error.message });
      return;
    }
    toast.success("Pregunta eliminada");
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
  };

  return (
    <Card className="border-fuchsia-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <span className="text-lg">📚</span> Preguntas frecuentes (respuestas oficiales)
          <Badge variant="secondary" className="ml-1 bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-100">
            Few-shot
          </Badge>
        </CardTitle>
        <CardDescription>
          Escribe pares de <b>Pregunta / Respuesta</b> con la voz oficial de tu sede. La IA los usa como
          referencia y responde con esas respuestas cuando el cliente pregunta algo parecido, en lugar de
          inventar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Formulario para agregar */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div>
            <Label htmlFor="faq-q" className="text-xs font-medium">Pregunta del cliente</Label>
            <Input
              id="faq-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ej: ¿tienen domicilio a Chapinero?"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="faq-a" className="text-xs font-medium">Respuesta oficial</Label>
            <Textarea
              id="faq-a"
              value={a}
              onChange={(e) => setA(e.target.value)}
              placeholder="Ej: Sí, hacemos domicilio a Chapinero. El costo es $5.000 y el tiempo estimado es 30–40 min."
              rows={3}
              className="mt-1"
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={add} disabled={saving}>
              <Plus className="h-4 w-4 mr-1" />
              {saving ? "Agregando…" : "Agregar"}
            </Button>
          </div>
        </div>

        {/* Lista existente */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : faqs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aún no hay preguntas frecuentes. Agrega la primera para que la IA la use como referencia.
          </p>
        ) : (
          <div className="space-y-2">
            {faqs.map((f) => (
              <div
                key={f.id}
                className={`rounded-lg border p-3 space-y-2 ${f.active ? "bg-card" : "bg-muted/40 opacity-70"}`}
              >
                <Input
                  value={f.question}
                  onChange={(e) => updateField(f.id, { question: e.target.value })}
                  className="text-sm font-medium"
                />
                <Textarea
                  value={f.answer}
                  onChange={(e) => updateField(f.id, { answer: e.target.value })}
                  rows={3}
                  className="text-sm"
                />
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={f.active}
                      onCheckedChange={(v) => updateField(f.id, { active: v })}
                    />
                    <span className="text-xs text-muted-foreground">
                      {f.active ? "Activa" : "Desactivada"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    onClick={() => remove(f.id)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Eliminar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground flex gap-1.5 items-start">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Solo las preguntas <b>activas</b> se envían a la IA. Guardar es instantáneo.
        </p>
      </CardContent>
    </Card>
  );
}
