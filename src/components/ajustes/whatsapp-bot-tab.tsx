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
  Wifi, WifiOff, CircleAlert, Info, Smartphone,
} from "lucide-react";

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

const WHATSAPP_BOT_DOWNLOAD_URL = "/__l5e/assets-v1/38cf1cfb-76aa-4943-806c-cb08f5235652/whatsapp-bot.zip";

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
      <MenuTriggersCard cfg={cfg} branch={branches.find((b) => b.id === cfg.branch_id) as BranchRow | undefined} onSaved={() => qc.invalidateQueries({ queryKey: ["whatsapp-bot-config", branchId] })} />
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
            {cfg.connected_phone && <div className="text-xs text-muted-foreground">Número: {cfg.connected_phone}</div>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
              <QrCode className="mr-2 h-4 w-4" /> Ver QR
            </Button>
            <div className="flex items-center gap-2">
              <Switch id="bot-enabled" checked={cfg.enabled} onCheckedChange={toggleEnabled} />
              <Label htmlFor="bot-enabled" className="text-sm font-semibold">Bot activo</Label>
            </div>
          </div>
        </div>

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
        <CardDescription>Descarga el bot, instálalo una vez y arrancará solo con el PC.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">1</span> Descarga el bot para Windows y descomprímelo en una carpeta permanente del PC.</li>
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">2</span> Copia el <b>Token de esta sede</b> (abajo) y pégalo cuando el instalador te lo pida.</li>
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">3</span> Doble-click a <code>install-windows.bat</code>. Espera 1–2 min.</li>
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">4</span> Vuelve a este panel: verás <b>Esperando QR</b>. Toca <b>Ver QR</b> y escanea con el WhatsApp Business del celular de la sede.</li>
          <li className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary text-xs">5</span> Estado pasa a <b>Conectado</b>. ¡Listo! Al reiniciar el PC el bot se recupera solo, sin volver a escanear.</li>
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
                <Download className="mr-2 h-4 w-4" /> Descargar bot para Windows
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={rotateToken}>
              <RefreshCw className="mr-2 h-4 w-4" /> Regenerar token
            </Button>
          </div>
          <p className="text-xs text-muted-foreground flex gap-1.5 items-start">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Esta versión valida el token antes de iniciar y muestra el QR o el error exacto en http://localhost:8790 del PC donde corre el bot.
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

function MenuTriggersCard({ cfg, branch, onSaved }: { cfg: BotConfigRow; branch?: BranchRow; onSaved: () => void }) {
  const [triggers, setTriggers] = useState<string[]>(cfg.menu_triggers ?? []);
  const [message, setMessage] = useState(cfg.menu_message);
  const [newTrigger, setNewTrigger] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setTriggers(cfg.menu_triggers ?? []); setMessage(cfg.menu_message); }, [cfg.menu_triggers, cfg.menu_message]);

  const menuLink = branch?.slug ? `https://golosoheladeria.lovable.app/s/${branch.slug}/menu` : "(sin slug de sede)";
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
