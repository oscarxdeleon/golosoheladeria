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
  Upload, Sparkles, Check, X, Search, ChevronDown, ChevronRight,
  Pencil, MoreHorizontal, AlertTriangle, Globe, Home,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GeminiQuotaCard } from "./gemini-quota-card";
import { useServerFn } from "@tanstack/react-start";
import { extractFaqsFromChat, type ExtractedFaq, type ExtractFaqsResult } from "@/lib/whatsapp-faq-import.functions";


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
      
      <OrderingCard branchId={cfg.branch_id} />
      <FaqManagerCard branchId={cfg.branch_id} />
      <ReportRecipientsCard branchId={cfg.branch_id} />
      {isAdmin && <GeminiQuotaCard />}
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

  const { isAdmin } = useAuth();
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [busyCmd, setBusyCmd] = useState<"unlink" | "reconnect" | "restart" | "update" | null>(null);
  const [progressStep, setProgressStep] = useState<string | null>(null);

  const sendCommand = async (command: "unlink" | "reconnect" | "restart" | "update") => {
    setBusyCmd(command);
    if (command === "restart" || command === "update") {
      setProgressStep("Conectando al servidor…");
    }
    const started = Date.now();
    const { error } = await supabase.rpc("whatsapp_bot_request_command", {
      _branch_id: cfg.branch_id,
      _command: command,
    });
    if (error) {
      setBusyCmd(null);
      setProgressStep(null);
      toast.error(command === "update" && /forbidden/i.test(error.message)
        ? "Solo un Administrador puede actualizar el bot."
        : error.message);
      return;
    }
    if (command === "restart" || command === "update") {
      const steps = command === "update"
        ? ["Aplicando configuración…", "Descargando última versión…", "Reiniciando servicio…", "Verificando conexión…"]
        : ["Aplicando configuración…", "Reiniciando servicio…", "Verificando conexión…"];
      for (const s of steps) {
        setProgressStep(s);
        await new Promise(r => setTimeout(r, command === "update" ? 4000 : 2000));
      }
      setProgressStep("Finalizando…");
      await new Promise(r => setTimeout(r, 1500));
      const elapsed = Math.round((Date.now() - started) / 1000);
      toast.success(command === "update"
        ? `✅ Bot actualizado correctamente (${elapsed}s). PM2 lo reiniciará automáticamente al terminar la descarga.`
        : `✅ Bot reiniciado (${elapsed}s). El servicio volverá a estar disponible en unos segundos.`);
    } else {
      toast.success(
        command === "unlink"
          ? "Solicitud enviada. En unos segundos el bot borrará la sesión y generará un nuevo QR."
          : "Solicitud enviada. El bot está reconectándose."
      );
    }
    setBusyCmd(null);
    setProgressStep(null);
    onChanged();
  };


  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" /> Estado del bot</CardTitle>
        <CardDescription>Conexión con WhatsApp de la sede {branch?.name ?? ""}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="mb-2 font-semibold">Cómo vincular WhatsApp en 3 pasos</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Presiona <b>Ver / Generar QR</b> aquí abajo.</li>
            <li>En el celular de la sede abre WhatsApp Business → Menú (⋮) → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.</li>
            <li>Escanea el código que aparece en pantalla. Listo — el estado pasará a <b>Conectado</b> en segundos.</li>
          </ol>
          <p className="mt-2 text-xs text-emerald-800/80">No necesitas entrar al servidor ni ejecutar comandos. Si el QR no aparece, presiona <b>Regenerar QR</b> dentro del mismo diálogo.</p>
        </div>
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
              variant="outline"
              size="sm"
              onClick={() => setRestartOpen(true)}
              disabled={busyCmd !== null}
              title="Reinicia el servicio del bot en el servidor (PM2 lo respawnará)."
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${busyCmd === "restart" ? "animate-spin" : ""}`} /> 🚀 Reiniciar Bot
            </Button>
            {isAdmin && (
              <Button
                variant="default"
                size="sm"
                onClick={() => setUpdateOpen(true)}
                disabled={busyCmd !== null}
                title="Descarga la última versión y reinicia el bot automáticamente."
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Download className={`mr-2 h-4 w-4 ${busyCmd === "update" ? "animate-spin" : ""}`} /> 🔄 Actualizar Bot
              </Button>
            )}
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

        <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Reiniciar el Bot de WhatsApp?</AlertDialogTitle>
              <AlertDialogDescription>
                Durante unos segundos el servicio se reiniciará automáticamente. Se aplicarán las configuraciones actuales y la sesión de WhatsApp se conservará (no necesitas escanear el QR de nuevo).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => sendCommand("restart")}>Sí, reiniciar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={updateOpen} onOpenChange={setUpdateOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Actualizar el Bot a la última versión?</AlertDialogTitle>
              <AlertDialogDescription>
                Se descargará la última versión publicada, se aplicarán las nuevas configuraciones y el servicio se reiniciará automáticamente. La sesión de WhatsApp se conserva. Esta operación puede tardar entre 30 segundos y 2 minutos. Solo un Administrador puede ejecutarla.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => sendCommand("update")}>Sí, actualizar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {progressStep && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
            <div className="w-[90%] max-w-md rounded-2xl border bg-card p-6 shadow-2xl">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" />
                <div>
                  <div className="text-base font-semibold">
                    {busyCmd === "update" ? "Actualizando Bot de WhatsApp" : "Reiniciando Bot de WhatsApp"}
                  </div>
                  <div className="text-sm text-muted-foreground">{progressStep}</div>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                No cierres esta ventana. El servicio se restablecerá automáticamente.
              </p>
            </div>
          </div>
        )}


          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Vincular WhatsApp por QR</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Abre WhatsApp Business en el celular de la sede.</li>
                <li>Menú (⋮) → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.</li>
                <li>Escanea el código que aparece aquí abajo.</li>
              </ol>
              <div className="grid place-items-center rounded-xl border bg-white p-4 min-h-[320px]">
                {cfg.qr_code ? (
                  <div className="space-y-2 text-center">
                    <QRCodeCanvas value={cfg.qr_code} size={280} includeMargin />
                    {cfg.qr_generated_at && (
                      <p className="text-[10px] text-muted-foreground">Actualizado {new Date(cfg.qr_generated_at).toLocaleTimeString()}</p>
                    )}
                  </div>
                ) : cfg.connection_status === "connected" ? (
                  <div className="space-y-3 p-4 text-center text-sm">
                    <Wifi className="mx-auto h-10 w-10 text-emerald-500" />
                    <p className="font-semibold text-foreground">Ya hay una sesión activa</p>
                    {cfg.connected_phone && <p className="text-xs text-muted-foreground">Número vinculado: +{cfg.connected_phone}</p>}
                    <p className="text-xs text-muted-foreground">Para vincular otro teléfono presiona el botón de abajo. La sesión actual se cerrará.</p>
                  </div>
                ) : (
                  <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
                    <QrCode className="mx-auto h-10 w-10 animate-pulse opacity-40" />
                    <p className="font-semibold text-foreground">Generando QR…</p>
                    <p>Puede tardar entre 10 y 30 segundos. El QR aparecerá aquí automáticamente.</p>
                    <p className="text-xs">Si no aparece en 1 minuto, presiona <b>Regenerar QR</b>.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="flex-1"
                  onClick={() => sendCommand("unlink")}
                  disabled={busyCmd !== null}
                  variant={cfg.connection_status === "connected" ? "destructive" : "default"}
                >
                  <RotateCw className={`mr-2 h-4 w-4 ${busyCmd === "unlink" ? "animate-spin" : ""}`} />
                  {cfg.connection_status === "connected" ? "Cerrar sesión y generar nuevo QR" : "Regenerar QR"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => sendCommand("reconnect")}
                  disabled={busyCmd !== null}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${busyCmd === "reconnect" ? "animate-spin" : ""}`} />
                  Reintentar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Todo ocurre automáticamente desde este panel. No necesitas abrir el PC de la sede ni ejecutar comandos.
              </p>
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
              placeholder="Ej: 👋 ¡Hola! Soy Golosito, tu asistente. Será un gusto ayudarte con tu pedido 🍦"
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

const DEFAULT_AI_PROMPT = `Eres Golosito, el asistente oficial de Heladería Goloso. Preséntate SOLO al inicio de la conversación como "soy Golosito, tu asistente" — NUNCA uses "asistente virtual", "bot", "IA" ni "chatbot", y no repitas tu nombre en cada mensaje. Tono amable, cálido, alegre, respetuoso y profesional. Español neutro (nada de 'parcero', 'bro', 'amigo', 'mi amor'). Respuestas cortas (2-3 líneas máx.) y con emojis de helado 🍦🍨 solo cuando aporten. Si el cliente quiere pedir, dirígelo al link del menú. No inventes promociones ni precios. Responde SIEMPRE en español.`;

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
              Cuando el bot no tiene una respuesta fija (bienvenida, menú, fuera de horario), Golosito responde
              de forma natural, toma pedidos y puede interpretar notas de voz 🎙️.
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
            Números de prueba opcionales
          </Label>
          <Textarea
            id="ai-numbers"
            value={numbersText}
            onChange={(e) => setNumbersText(e.target.value)}
            placeholder={"Déjalo vacío para responder a todos los clientes\n573001234567"}
            rows={4}
            className="mt-1 font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1.5 flex gap-1.5 items-start">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Déjalo vacío para que Golosito responda a todos los clientes. Si escribes números aquí, la IA
            responderá solo a esos números de prueba.
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
            Deja vacío para usar la personalidad oficial de Golosito. El nombre de la sede,
            los horarios y el link del menú se agregan automáticamente.
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
/* Toma de pedidos por WhatsApp (Fase 2B)                    */
/* --------------------------------------------------------- */

interface OrderingCfg {
  ordering_enabled: boolean;
  min_amount: number;
  delivery_fee: number;
  zones: string | null;
  transfer_info: string | null;
  dry_run: boolean;
}

function OrderingCard({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<OrderingCfg | null>({
    queryKey: ["whatsapp-bot-ordering", branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_bot_config")
        .select("ai_ordering_enabled, ordering_min_amount, ordering_delivery_fee, ordering_delivery_zones, ordering_transfer_info, ai_dry_run")
        .eq("branch_id", branchId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ordering_enabled: data.ai_ordering_enabled,
        min_amount: data.ordering_min_amount,
        delivery_fee: data.ordering_delivery_fee,
        zones: data.ordering_delivery_zones,
        transfer_info: data.ordering_transfer_info,
        dry_run: data.ai_dry_run,
      } as OrderingCfg;
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [minAmount, setMinAmount] = useState("0");
  const [deliveryFee, setDeliveryFee] = useState("0");
  const [zones, setZones] = useState("");
  const [transferInfo, setTransferInfo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(!!data.ordering_enabled);
    setDryRun(!!data.dry_run);
    setMinAmount(String(data.min_amount ?? 0));
    setDeliveryFee(String(data.delivery_fee ?? 0));
    setZones(data.zones ?? "");
    setTransferInfo(data.transfer_info ?? "");
  }, [data]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_bot_config")
      .update({
        ai_ordering_enabled: enabled,
        ai_dry_run: dryRun,
        ordering_min_amount: Number(minAmount) || 0,
        ordering_delivery_fee: Number(deliveryFee) || 0,
        ordering_delivery_zones: zones.trim() || null,
        ordering_transfer_info: transferInfo.trim() || null,
      })
      .eq("branch_id", branchId);
    setSaving(false);
    if (error) return toast.error("No se pudo guardar", { description: error.message });
    toast.success("Toma de pedidos actualizada");
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-ordering", branchId] });
  };

  return (
    <Card className="border-emerald-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <span className="text-lg">🛒</span> Toma de pedidos por WhatsApp
              <Badge variant="secondary" className="ml-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Fase 2B</Badge>
            </CardTitle>
            <CardDescription>
              La IA arma pedidos de <b>domicilio</b> conversando con el cliente. Cada pedido queda
              como “Bot WhatsApp · Revisar” en Pedidos online para que el cajero lo confirme antes de cocina.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label htmlFor="ord-enabled" className="text-sm">Activar</Label>
            <Switch id="ord-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={isLoading} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`flex items-start justify-between gap-3 rounded-md border p-3 ${dryRun ? "bg-amber-50 border-amber-300" : "bg-muted/40"}`}>
          <div className="space-y-0.5">
            <Label htmlFor="ord-dryrun" className="text-sm font-medium flex items-center gap-1.5">
              🧪 Modo prueba (dry-run)
              {dryRun && <Badge variant="secondary" className="bg-amber-200 text-amber-900 hover:bg-amber-200">Activo</Badge>}
            </Label>
            <p className="text-xs text-muted-foreground">
              La IA arma y "confirma" pedidos con un número simulado (TEST-####), pero <b>no</b> se registran en el POS.
              Úsalo para probar el flujo sin ensuciar la operación real.
            </p>
          </div>
          <Switch id="ord-dryrun" checked={dryRun} onCheckedChange={setDryRun} disabled={isLoading} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Monto mínimo (COP)</Label>
            <Input inputMode="numeric" value={minAmount} onChange={(e) => setMinAmount(e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          <div>
            <Label className="text-sm">Costo de domicilio por defecto (COP)</Label>
            <Input inputMode="numeric" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value.replace(/[^\d]/g, ""))} />
          </div>
        </div>
        <div>
          <Label className="text-sm">Zonas de cobertura</Label>
          <Textarea rows={2} value={zones} onChange={(e) => setZones(e.target.value)} placeholder="Ej: Chapinero, Teusaquillo, Palermo…" />
        </div>
        <div>
          <Label className="text-sm">Datos para transferencia</Label>
          <Textarea rows={3} value={transferInfo} onChange={(e) => setTransferInfo(e.target.value)} placeholder="Nequi 300..., Bancolombia ahorros 123..., a nombre de …" />
          <p className="text-xs text-muted-foreground mt-1">La IA los compartirá SOLO si el cliente elige pagar por transferencia.</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || isLoading}>{saving ? "Guardando…" : "Guardar"}</Button>
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
  branch_id: string | null;
  question: string;
  answer: string;
  sort_order: number;
  active: boolean;
  created_at?: string;
}

type FaqFilter = "all" | "active" | "inactive" | "recent" | "duplicates" | "global" | "branch";
type DupStrategy = "skip" | "replace" | "keep-both";

interface ImportPair extends ExtractedFaq {
  keep: boolean;
  duplicateOfId: string | null;
  strategy: DupStrategy;
  status: "new" | "duplicate";
}

const normalizeQ = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function FaqManagerCard({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const { data: faqs = [], isLoading } = useQuery<FaqRow[]>({
    queryKey: ["whatsapp-bot-faqs", branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_bot_faqs")
        .select("id, branch_id, question, answer, sort_order, active, created_at")
        .or(`branch_id.eq.${branchId},branch_id.is.null`)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as FaqRow[];
    },
  });

  // ---- Add manual ----
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [addGlobal, setAddGlobal] = useState(false);
  const [saving, setSaving] = useState(false);

  // ---- Import ----
  const extractFn = useServerFn(extractFaqsFromChat);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPair[]>([]);
  const [importStats, setImportStats] = useState<ExtractFaqsResult["stats"] | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importAsGlobal, setImportAsGlobal] = useState(false);

  // ---- Browse UI state ----
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FaqFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<FaqRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // ---- Derived: filtered list + duplicate detection ----
  const duplicateIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const f of faqs) {
      const k = normalizeQ(f.question);
      const arr = map.get(k) ?? [];
      arr.push(f.id);
      map.set(k, arr);
    }
    const dup = new Set<string>();
    map.forEach((ids) => { if (ids.length > 1) ids.forEach((id) => dup.add(id)); });
    return dup;
  }, [faqs]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const s = search.trim().toLowerCase();
    return faqs.filter((f) => {
      if (filter === "active" && !f.active) return false;
      if (filter === "inactive" && f.active) return false;
      if (filter === "duplicates" && !duplicateIds.has(f.id)) return false;
      if (filter === "global" && f.branch_id !== null) return false;
      if (filter === "branch" && f.branch_id === null) return false;
      if (filter === "recent") {
        if (!f.created_at) return false;
        const age = now - new Date(f.created_at).getTime();
        if (age > 24 * 60 * 60 * 1000) return false;
      }
      if (s) {
        return f.question.toLowerCase().includes(s) || f.answer.toLowerCase().includes(s);
      }
      return true;
    });
  }, [faqs, filter, search, duplicateIds]);

  const allSelectedInView = filtered.length > 0 && filtered.every((f) => selected.has(f.id));

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleSelectAll = () => {
    if (allSelectedInView) {
      setSelected((prev) => {
        const n = new Set(prev);
        filtered.forEach((f) => n.delete(f.id));
        return n;
      });
    } else {
      setSelected((prev) => {
        const n = new Set(prev);
        filtered.forEach((f) => n.add(f.id));
        return n;
      });
    }
  };

  // ---- Import handlers ----
  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Archivo muy grande (máx 10 MB)");
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const host = typeof window !== "undefined" ? window.location.hostname : "";
      const isLovable = /\.lovable\.app$/.test(host);
      let result: ExtractFaqsResult;
      if (isLovable) {
        result = await extractFn({ data: { text, branchId } });
      } else {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) throw new Error("Sesión expirada, vuelve a iniciar sesión");
        const resp = await fetch("https://golosoheladeria.lovable.app/api/public/faq-extract", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, branchId }),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error ?? `HTTP ${resp.status}`);
        result = json;
      }
      if (!result.pairs.length) {
        toast.warning(result.warnings[0] ?? "No se encontraron preguntas útiles");
        setImporting(false);
        return;
      }
      // Marca duplicados contra los actuales
      const existingMap = new Map(faqs.map((f) => [normalizeQ(f.question), f.id] as const));
      const pairs: ImportPair[] = result.pairs.map((p) => {
        const dupId = existingMap.get(normalizeQ(p.question)) ?? null;
        return {
          ...p,
          keep: true,
          duplicateOfId: dupId,
          strategy: dupId ? "skip" : "keep-both",
          status: dupId ? "duplicate" : "new",
        };
      });
      setPreview(pairs);
      setImportStats(result.stats);
      setImportWarnings(result.warnings);
      setImportOpen(true);
    } catch (err) {
      toast.error("Error al procesar el archivo", { description: (err as Error).message });
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
    try {
      let order = (faqs.at(-1)?.sort_order ?? 0) + 10;
      const toInsert: Array<{ branch_id: string | null; question: string; answer: string; sort_order: number; active: boolean }> = [];
      const toReplace: Array<{ id: string; question: string; answer: string }> = [];
      let skipped = 0;

      for (const p of chosen) {
        const question = p.question.trim();
        const answer = p.answer.trim();
        if (p.duplicateOfId) {
          if (p.strategy === "skip") { skipped++; continue; }
          if (p.strategy === "replace") { toReplace.push({ id: p.duplicateOfId, question, answer }); continue; }
        }
        toInsert.push({
          branch_id: importAsGlobal ? null : branchId,
          question,
          answer,
          sort_order: (order += 10),
          active: true,
        });
      }

      const errors: string[] = [];
      if (toInsert.length) {
        const { error } = await supabase.from("whatsapp_bot_faqs").insert(toInsert);
        if (error) errors.push(`Insertar: ${error.message}`);
      }
      for (const r of toReplace) {
        const { error } = await supabase
          .from("whatsapp_bot_faqs")
          .update({ question: r.question, answer: r.answer, active: true })
          .eq("id", r.id);
        if (error) errors.push(`Reemplazar ${r.id.slice(0, 8)}: ${error.message}`);
      }

      if (errors.length) {
        toast.error("Algunos registros fallaron", { description: errors.slice(0, 3).join(" · ") });
      } else {
        const parts: string[] = [];
        if (toInsert.length) parts.push(`${toInsert.length} nuevas`);
        if (toReplace.length) parts.push(`${toReplace.length} reemplazadas`);
        if (skipped) parts.push(`${skipped} omitidas`);
        toast.success(`Importación completa: ${parts.join(", ")}`);
      }
      setPreview([]);
      setImportStats(null);
      setImportWarnings([]);
      setImportOpen(false);
      qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
    } finally {
      setImporting(false);
    }
  };

  const applyBulkDupStrategy = (strategy: DupStrategy) => {
    setPreview((prev) => prev.map((p) => (p.duplicateOfId ? { ...p, strategy, keep: strategy !== "skip" ? true : p.keep } : p)));
  };

  // ---- Manual add ----
  const add = async () => {
    const question = q.trim();
    const answer = a.trim();
    if (!question || !answer) { toast.error("Escribe la pregunta y la respuesta"); return; }
    setSaving(true);
    const nextOrder = (faqs.at(-1)?.sort_order ?? 0) + 10;
    const { error } = await supabase.from("whatsapp_bot_faqs").insert({
      branch_id: addGlobal ? null : branchId, question, answer, sort_order: nextOrder, active: true,
    });
    setSaving(false);
    if (error) { toast.error("No se pudo agregar", { description: error.message }); return; }
    setQ(""); setA("");
    toast.success("Pregunta agregada");
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
  };

  // ---- Row mutations ----
  const updateField = async (id: string, patch: Partial<FaqRow>) => {
    const { error } = await supabase.from("whatsapp_bot_faqs").update(patch).eq("id", id);
    if (error) toast.error("No se pudo actualizar", { description: error.message });
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
  };

  const removeOne = async (id: string) => {
    const { error } = await supabase.from("whatsapp_bot_faqs").delete().eq("id", id);
    if (error) { toast.error("No se pudo eliminar", { description: error.message }); return; }
    toast.success("Pregunta eliminada");
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
  };

  const bulkAction = async (action: "activate" | "deactivate" | "delete") => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (action === "delete") {
      const { error } = await supabase.from("whatsapp_bot_faqs").delete().in("id", ids);
      if (error) { toast.error("No se pudo eliminar", { description: error.message }); return; }
      toast.success(`${ids.length} eliminadas`);
    } else {
      const active = action === "activate";
      const { error } = await supabase.from("whatsapp_bot_faqs").update({ active }).in("id", ids);
      if (error) { toast.error("No se pudo actualizar", { description: error.message }); return; }
      toast.success(`${ids.length} ${active ? "activadas" : "desactivadas"}`);
    }
    setSelected(new Set());
    setConfirmBulkDelete(false);
    qc.invalidateQueries({ queryKey: ["whatsapp-bot-faqs", branchId] });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const question = editing.question.trim();
    const answer = editing.answer.trim();
    if (!question || !answer) { toast.error("Pregunta y respuesta son requeridas"); return; }
    await updateField(editing.id, { question, answer });
    setEditing(null);
    toast.success("Guardado");
  };

  const activeCount = faqs.filter((f) => f.active).length;
  const dupCount = duplicateIds.size;

  return (
    <Card className="border-fuchsia-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <span className="text-lg">📚</span>
          <span>Preguntas frecuentes</span>
          <Badge variant="secondary" className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-100">Few-shot</Badge>
          <Badge variant="outline" className="ml-auto">
            {faqs.length} totales · {activeCount} activas{dupCount ? ` · ${dupCount} duplicadas` : ""}
          </Badge>
        </CardTitle>
        <CardDescription>
          Pares Pregunta / Respuesta que la IA usa como referencia. Importa desde archivos .txt (formato
          <code className="mx-1 px-1 rounded bg-muted text-[10px]">Pregunta: … Respuesta: …</code>
          o chats de WhatsApp) o agrégalos manualmente.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Importador */}
        <div className="rounded-lg border border-dashed border-fuchsia-300 bg-fuchsia-50/50 p-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-fuchsia-600" />
                Importar archivo .txt
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Detecta automáticamente bloques <b>Pregunta / Respuesta</b>. Para chats de WhatsApp, la IA
                extrae los pares y <b>elimina nombres, teléfonos y datos personales</b>. Soporta archivos con
                50, 100, 200+ pares.
              </p>
              <label className="mt-2 inline-flex items-center gap-2 text-xs cursor-pointer">
                <Switch checked={importAsGlobal} onCheckedChange={setImportAsGlobal} />
                <span>Importar como <b>globales</b> (aplican a las dos sedes)</span>
              </label>
            </div>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) handleFile(f);
                }}
              />
              <span className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${importing ? "bg-muted text-muted-foreground" : "bg-fuchsia-600 text-white hover:bg-fuchsia-700"}`}>
                <Upload className="h-4 w-4" />
                {importing ? "Procesando…" : "Subir .txt"}
              </span>
            </label>
          </div>
        </div>

        {/* Add manual */}
        <details className="rounded-lg border bg-muted/30 p-3">
          <summary className="cursor-pointer text-sm font-medium flex items-center gap-1.5 select-none">
            <Plus className="h-4 w-4" /> Agregar manualmente
          </summary>
          <div className="mt-3 space-y-2">
            <div>
              <Label htmlFor="faq-q" className="text-xs font-medium">Pregunta del cliente</Label>
              <Input id="faq-q" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Ej: ¿tienen domicilio a Chapinero?" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="faq-a" className="text-xs font-medium">Respuesta oficial</Label>
              <Textarea id="faq-a" value={a} onChange={(e) => setA(e.target.value)}
                placeholder="Ej: Sí, hacemos domicilio a Chapinero. El costo es $5.000 y el tiempo estimado es 30–40 min."
                rows={3} className="mt-1" />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                <Switch checked={addGlobal} onCheckedChange={setAddGlobal} />
                <span>Global (ambas sedes)</span>
              </label>
              <Button size="sm" onClick={add} disabled={saving}>
                <Plus className="h-4 w-4 mr-1" />{saving ? "Agregando…" : "Agregar"}
              </Button>
            </div>
          </div>
        </details>

        {/* Toolbar: search + filter + bulk */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por palabra clave…"
              className="pl-8 h-9"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as FaqFilter)}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas ({faqs.length})</SelectItem>
              <SelectItem value="active">Activas ({activeCount})</SelectItem>
              <SelectItem value="inactive">Inactivas ({faqs.length - activeCount})</SelectItem>
              <SelectItem value="global">Globales ({faqs.filter((f) => f.branch_id === null).length})</SelectItem>
              <SelectItem value="branch">Solo esta sede ({faqs.filter((f) => f.branch_id !== null).length})</SelectItem>
              <SelectItem value="recent">Recientes (24 h)</SelectItem>
              <SelectItem value="duplicates">Duplicadas ({dupCount})</SelectItem>
            </SelectContent>
          </Select>
          {selected.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-9">
                  Acciones ({selected.size}) <ChevronDown className="h-3.5 w-3.5 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => bulkAction("activate")}>
                  <Check className="h-4 w-4 mr-2" /> Activar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkAction("deactivate")}>
                  <X className="h-4 w-4 mr-2" /> Desactivar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => setConfirmBulkDelete(true)}>
                  <Trash2 className="h-4 w-4 mr-2" /> Eliminar seleccionadas
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Lista compacta colapsable */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6 border rounded-lg bg-muted/20">
            {faqs.length === 0
              ? "Aún no hay preguntas frecuentes. Importa un .txt o agrega la primera manualmente."
              : "Ningún registro coincide con la búsqueda o el filtro."}
          </p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            {/* Header selección */}
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b text-xs font-medium">
              <Checkbox checked={allSelectedInView} onCheckedChange={toggleSelectAll} />
              <span className="text-muted-foreground">
                {selected.size > 0 ? `${selected.size} seleccionadas` : `Mostrando ${filtered.length} de ${faqs.length}`}
              </span>
            </div>

            <ul className="divide-y">
              {filtered.map((f) => {
                const isOpen = expanded.has(f.id);
                const isSel = selected.has(f.id);
                const isDup = duplicateIds.has(f.id);
                return (
                  <li key={f.id} className={`transition-colors ${isSel ? "bg-fuchsia-50/50" : "hover:bg-muted/30"} ${!f.active ? "opacity-60" : ""}`}>
                    <div className="flex items-start gap-2 px-3 py-2">
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={() => toggleSelected(f.id)}
                        className="mt-1"
                      />
                      <button
                        type="button"
                        onClick={() => toggleExpand(f.id)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          {isOpen
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                          <span className="text-sm font-medium truncate">{f.question}</span>
                          {f.branch_id === null && <Badge variant="outline" className="text-[10px] py-0 h-4 border-sky-400 text-sky-700 bg-sky-50">Global</Badge>}
                          {!f.active && <Badge variant="outline" className="text-[10px] py-0 h-4">Inactiva</Badge>}
                          {isDup && <Badge variant="outline" className="text-[10px] py-0 h-4 border-amber-400 text-amber-700">Duplicada</Badge>}
                        </div>
                        {!isOpen && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5 pl-5">
                            {f.answer.split("\n")[0]}
                          </p>
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(f)}>
                            <Pencil className="h-4 w-4 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateField(f.id, { active: !f.active })}>
                            {f.active ? <><X className="h-4 w-4 mr-2" /> Desactivar</> : <><Check className="h-4 w-4 mr-2" /> Activar</>}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => updateField(f.id, { branch_id: f.branch_id === null ? branchId : null })}>
                            {f.branch_id === null
                              ? <><Home className="h-4 w-4 mr-2" /> Anclar a esta sede</>
                              : <><Globe className="h-4 w-4 mr-2" /> Hacer global</>}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => setConfirmDeleteId(f.id)}>
                            <Trash2 className="h-4 w-4 mr-2" /> Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {isOpen && (
                      <div className="px-3 pb-3 pl-10 space-y-2">
                        <div className="text-xs whitespace-pre-wrap rounded bg-muted/40 p-2 border">
                          {f.answer}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Switch checked={f.active} onCheckedChange={(v) => updateField(f.id, { active: v })} />
                          <span className="text-xs text-muted-foreground">{f.active ? "Activa" : "Desactivada"}</span>
                          <div className="ml-auto flex gap-1">
                            <Button variant="outline" size="sm" className="h-7" onClick={() => setEditing(f)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => setConfirmDeleteId(f.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-1" /> Eliminar
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground flex gap-1.5 items-start">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Solo las preguntas <b>activas</b> se envían a la IA. Los cambios se guardan al instante.
        </p>
      </CardContent>

      {/* ==================== Import preview dialog ==================== */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-fuchsia-600" />
              Revisar importación
            </DialogTitle>
          </DialogHeader>

          {/* Stats */}
          {importStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded border p-2 bg-muted/20">
                <div className="text-lg font-bold">{importStats.totalDetected}</div>
                <div className="text-muted-foreground">Detectadas</div>
              </div>
              <div className="rounded border p-2 bg-emerald-50 border-emerald-200">
                <div className="text-lg font-bold text-emerald-700">{preview.filter((p) => p.keep && (!p.duplicateOfId || p.strategy !== "skip")).length}</div>
                <div className="text-emerald-700">A importar</div>
              </div>
              <div className="rounded border p-2 bg-amber-50 border-amber-200">
                <div className="text-lg font-bold text-amber-700">{preview.filter((p) => p.duplicateOfId).length}</div>
                <div className="text-amber-700">Duplicadas</div>
              </div>
              <div className="rounded border p-2 bg-rose-50 border-rose-200">
                <div className="text-lg font-bold text-rose-700">{importStats.errors.length}</div>
                <div className="text-rose-700">Con error</div>
              </div>
            </div>
          )}

          {importStats && (importStats.source === "ai" || importStats.source === "mixed") && (
            <p className="text-xs text-muted-foreground">
              Procesado por IA en {importStats.chunks ?? 1} bloque(s). Los nombres y datos personales fueron
              removidos automáticamente.
            </p>
          )}

          {(importWarnings.length > 0 || (importStats?.errors?.length ?? 0) > 0) && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs space-y-1 max-h-24 overflow-auto">
              {importWarnings.map((w, i) => (
                <div key={`w-${i}`} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" /><span>{w}</span></div>
              ))}
              {importStats?.errors?.slice(0, 20).map((e) => (
                <div key={`e-${e.index}`} className="flex gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                  <span><b>#{e.index}:</b> {e.reason} — <i className="opacity-70">{e.snippet}</i></span>
                </div>
              ))}
            </div>
          )}

          {/* Bulk duplicate strategy */}
          {preview.some((p) => p.duplicateOfId) && (
            <div className="flex flex-wrap items-center gap-2 text-xs border-t border-b py-2">
              <span className="font-medium">Duplicadas → aplicar a todas:</span>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyBulkDupStrategy("skip")}>Omitir</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyBulkDupStrategy("replace")}>Reemplazar</Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyBulkDupStrategy("keep-both")}>Conservar ambas</Button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 -mr-1">
            {preview.map((p, idx) => (
              <div key={idx} className={`rounded-lg border p-3 space-y-2 ${p.keep ? "bg-card" : "bg-muted/40 opacity-60"} ${p.duplicateOfId ? "border-amber-300" : ""}`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Checkbox checked={p.keep} onCheckedChange={(v) =>
                      setPreview((prev) => prev.map((x, i) => i === idx ? { ...x, keep: !!v } : x))
                    } />
                    <Label className="text-xs font-medium">#{idx + 1}</Label>
                    {p.duplicateOfId && (
                      <Badge variant="outline" className="text-[10px] py-0 h-4 border-amber-400 text-amber-700">Ya existe</Badge>
                    )}
                  </div>
                  {p.duplicateOfId && (
                    <Select value={p.strategy} onValueChange={(v) =>
                      setPreview((prev) => prev.map((x, i) => i === idx ? { ...x, strategy: v as DupStrategy, keep: v !== "skip" ? true : x.keep } : x))
                    }>
                      <SelectTrigger className="h-7 text-xs w-[160px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">Omitir</SelectItem>
                        <SelectItem value="replace">Reemplazar existente</SelectItem>
                        <SelectItem value="keep-both">Conservar ambas</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <Input
                  value={p.question}
                  onChange={(e) => setPreview((prev) => prev.map((x, i) => i === idx ? { ...x, question: e.target.value } : x))}
                  className="text-sm" disabled={!p.keep}
                />
                <Textarea
                  value={p.answer}
                  onChange={(e) => setPreview((prev) => prev.map((x, i) => i === idx ? { ...x, answer: e.target.value } : x))}
                  rows={3} className="text-sm" disabled={!p.keep}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>Cancelar</Button>
            <Button onClick={saveImported} disabled={importing}>
              {importing
                ? "Guardando…"
                : `Importar ${preview.filter((p) => p.keep && (!p.duplicateOfId || p.strategy !== "skip")).length}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== Edit dialog ==================== */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar pregunta</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Pregunta</Label>
                <Input value={editing.question} onChange={(e) => setEditing({ ...editing, question: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Respuesta</Label>
                <Textarea value={editing.answer} onChange={(e) => setEditing({ ...editing, answer: e.target.value })} rows={6} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                <Button onClick={saveEdit}>Guardar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm single delete */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta pregunta?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteId && removeOne(confirmDeleteId).then(() => setConfirmDeleteId(null))}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm bulk delete */}
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {selected.size} preguntas?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulkAction("delete")} className="bg-rose-600 hover:bg-rose-700">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
