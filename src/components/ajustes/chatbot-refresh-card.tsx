import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { refreshChatbot, type ChatbotRefreshResult } from "@/lib/bot-refresh.functions";

type RuntimeState = {
  config_revision: number;
  updated_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
};

type SyncLogRow = {
  id: string;
  created_at: string;
  config_revision: number | null;
  status: string;
  targets: unknown;
};

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

/** Última fecha de cambio en cualquier recurso que use el chatbot. */
async function lastContentChange(): Promise<string | null> {
  const reads = await Promise.all([
    supabase.from("whatsapp_bot_config").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    supabase.from("whatsapp_bot_faqs").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    supabase.from("branches").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    supabase.from("products").select("created_at").order("created_at", { ascending: false }).limit(1),
    supabase.from("categories").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);
  const dates = reads
    .flatMap((r) => (r.data ?? []) as Array<Record<string, string>>)
    .map((row) => row.updated_at ?? row.created_at)
    .filter(Boolean)
    .map((d) => new Date(d).getTime());
  if (!dates.length) return null;
  return new Date(Math.max(...dates)).toISOString();
}

export function ChatbotRefreshCard() {
  const qc = useQueryClient();
  const run = useServerFn(refreshChatbot);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChatbotRefreshResult | null>(null);

  const { data: state } = useQuery({
    queryKey: ["bot-runtime-state"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("bot_runtime_state")
        .select("config_revision, updated_at, last_sync_at, last_sync_status")
        .eq("id", 1)
        .maybeSingle();
      return (data ?? null) as RuntimeState | null;
    },
  });

  const { data: history } = useQuery({
    queryKey: ["bot-sync-log"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bot_sync_log")
        .select("id, created_at, config_revision, status, targets")
        .order("created_at", { ascending: false })
        .limit(8);
      return (data ?? []) as SyncLogRow[];
    },
  });

  const { data: lastChange } = useQuery({
    queryKey: ["bot-content-last-change"],
    refetchInterval: 60_000,
    queryFn: lastContentChange,
  });

  const lastSync = state?.last_sync_at ?? null;
  const pending =
    !lastSync || (lastChange ? new Date(lastChange).getTime() > new Date(lastSync).getTime() : false);

  const status: { tone: string; label: string; icon: typeof CheckCircle2 } = busy
    ? { tone: "bg-blue-100 text-blue-800", label: "🔄 Sincronizando Lovable y Vercel…", icon: RefreshCw }
    : state?.last_sync_status === "error"
      ? { tone: "bg-red-100 text-red-800", label: "🔴 Error durante la sincronización", icon: XCircle }
      : state?.last_sync_status === "partial"
        ? { tone: "bg-amber-100 text-amber-900", label: "🟡 Sincronización incompleta", icon: AlertTriangle }
        : pending
          ? { tone: "bg-amber-100 text-amber-900", label: "🟡 Cambios pendientes por aplicar", icon: AlertTriangle }
          : { tone: "bg-emerald-100 text-emerald-800", label: "🟢 Chatbot actualizado", icon: CheckCircle2 };

  const StatusIcon = status.icon;

  const apply = async () => {
    setBusy(true);
    setResult(null);
    try {
      const out = await run({ data: {} as never });
      setResult(out);
      if (out.status === "ok") toast.success("Chatbot actualizado y verificado");
      else if (out.status === "partial") toast.warning("Sincronización incompleta", { description: out.message });
      else toast.error("No se pudo sincronizar", { description: out.message });
    } catch (e) {
      toast.error("No se pudo actualizar el chatbot", { description: String(e).slice(0, 200) });
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["bot-runtime-state"] });
      qc.invalidateQueries({ queryKey: ["bot-content-last-change"] });
      qc.invalidateQueries({ queryKey: ["bot-sync-log"] });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-primary" /> Actualizar chatbot
        </CardTitle>
        <CardDescription>
          Aplica de inmediato todos los cambios del chatbot (entrenamiento, preguntas y respuestas, prompts,
          bienvenidas, menú, productos, categorías, modificadores, horarios, domicilios y sedes) en Lovable y en
          Vercel, sincroniza la clave de IA y ejecuta pruebas funcionales reales. No desconecta WhatsApp ni pide
          volver a escanear el QR.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className={`${status.tone} border-0 px-3 py-1 text-sm font-medium`}>
            <StatusIcon className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {status.label}
          </Badge>
          <span className="text-xs text-muted-foreground">Versión de configuración #{state?.config_revision ?? 1}</span>
        </div>

        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <div>Último cambio del chatbot: <b className="text-foreground">{fmt(lastChange)}</b></div>
          <div>Última sincronización correcta: <b className="text-foreground">{fmt(lastSync)}</b></div>
        </div>

        <Button onClick={apply} disabled={busy} size="lg" className="w-full sm:w-auto">
          <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Aplicando cambios y verificando…" : "🔄 Actualizar chatbot"}
        </Button>

        {result && (
          <div
            className={`rounded-xl border p-3 text-sm ${
              result.status === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <p className="font-medium">
              {result.status === "ok" ? "✅ " : "⚠️ "}
              {result.message}
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {result.targets.map((t) => (
                <li key={t.url}>
                  {t.ok && t.revision === result.revision ? "🟢" : "🔴"} <b>{t.name}</b> — versión{" "}
                  {t.revision ?? "desconocida"}
                  {t.error ? ` · ${t.error}` : ""}
                </li>
              ))}
            </ul>
            {result.tests.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold">Pruebas funcionales</p>
                <ul className="mt-1 space-y-1 text-xs">
                  {result.tests.map((t, i) => (
                    <li key={`${t.target}-${i}`}>
                      {t.ok ? "🟢" : "🔴"} <b>{t.target}</b> · “{t.prompt}” →{" "}
                      <span className="text-muted-foreground">{t.reply.slice(0, 120)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Clave de IA sincronizada: {result.ai_key_synced ? "sí" : "no"} · Duración:{" "}
              {(result.duration_ms / 1000).toFixed(1)} s
            </p>
          </div>
        )}

        {history && history.length > 0 && (
          <div className="rounded-xl border p-3">
            <p className="text-sm font-medium">Historial de versiones</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {history.map((row) => {
                const meta = (row.targets ?? {}) as { duration_ms?: number; tests?: unknown[] };
                const tests = Array.isArray(meta.tests) ? meta.tests.length : 0;
                return (
                  <li key={row.id} className="flex flex-wrap gap-x-2">
                    <span>{row.status === "ok" ? "🟢" : row.status === "partial" ? "🟡" : "🔴"}</span>
                    <b className="text-foreground">v1.0.{row.config_revision ?? "?"}</b>
                    <span>{fmt(row.created_at)}</span>
                    {typeof meta.duration_ms === "number" && <span>· {(meta.duration_ms / 1000).toFixed(1)} s</span>}
                    {tests > 0 && <span>· {tests} pruebas</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
