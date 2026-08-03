import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Rocket, CheckCircle2, XCircle, Loader2, ExternalLink, Save, AlertTriangle } from "lucide-react";
import {
  deployToVercel,
  getDeployConfig,
  saveDeployHook,
  type DeployResult,
} from "@/lib/vercel-deploy.functions";

const STEPS = [
  "Validando configuración…",
  "Conectando con Vercel…",
  "Enviando solicitud…",
  "Esperando respuesta…",
  "Build iniciado…",
];

type LogRow = {
  id: string;
  created_at: string;
  status: string;
  message: string | null;
  http_status: number | null;
  duration_ms: number | null;
  job_id: string | null;
  build_url: string | null;
};

function fmt(value: string) {
  return new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

export function VercelDeployCard() {
  const qc = useQueryClient();
  const run = useServerFn(deployToVercel);
  const loadConfig = useServerFn(getDeployConfig);
  const saveHook = useServerFn(saveDeployHook);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [hookInput, setHookInput] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: config } = useQuery({
    queryKey: ["vercel-deploy-config"],
    queryFn: () => loadConfig({ data: {} as never }),
  });

  const { data: history } = useQuery({
    queryKey: ["vercel-deploy-log"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_deploy_log")
        .select("id, created_at, status, message, http_status, duration_ms, job_id, build_url")
        .order("created_at", { ascending: false })
        .limit(8);
      return (data ?? []) as LogRow[];
    },
  });

  const persistHook = async () => {
    setSaving(true);
    try {
      const res = await saveHook({ data: { hookUrl: hookInput.trim() } });
      toast.success("Deploy Hook guardado", { description: res.masked_url });
      setHookInput("");
      qc.invalidateQueries({ queryKey: ["vercel-deploy-config"] });
    } catch (e) {
      toast.error("No se pudo guardar el Deploy Hook", { description: String(e).slice(0, 200) });
    } finally {
      setSaving(false);
    }
  };

  const deploy = async () => {
    setBusy(true);
    setResult(null);
    let i = 0;
    setStep(STEPS[0]);
    const timer = setInterval(() => {
      i = Math.min(i + 1, STEPS.length - 2);
      setStep(STEPS[i]);
    }, 1200);
    try {
      const res = await run({ data: {} as never });
      setResult(res);
      if (res.ok) {
        setStep(STEPS[STEPS.length - 1]);
        toast.success("Despliegue iniciado en Vercel", { description: res.message });
      } else {
        setStep(null);
        toast.error(res.code.replace(/_/g, " "), { description: res.message });
      }
      qc.invalidateQueries({ queryKey: ["vercel-deploy-log"] });
    } catch (e) {
      setStep(null);
      const message = String(e).slice(0, 240);
      setResult({
        ok: false,
        status: "error",
        code: "ERROR_INESPERADO",
        message,
        http_status: null,
        job_id: null,
        build_url: null,
        duration_ms: 0,
        source: "database",
      });
      toast.error("No se pudo desplegar en Vercel", { description: message });
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" /> Desplegar en Vercel
        </CardTitle>
        <CardDescription>
          Lanza un nuevo build en Vercel con los últimos cambios guardados. El proceso toma 1–3
          minutos y no afecta las sesiones de WhatsApp ni las tablets de meseros.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="px-3 py-1 text-sm font-medium">
            {busy ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> {step ?? "Desplegando…"}
              </>
            ) : result?.ok ? (
              <>
                <CheckCircle2 className="mr-1 h-4 w-4 text-emerald-600" /> Despliegue iniciado
              </>
            ) : result ? (
              <>
                <XCircle className="mr-1 h-4 w-4 text-rose-600" /> {result.code.replace(/_/g, " ")}
              </>
            ) : (
              <>
                <Rocket className="mr-1 h-4 w-4" /> Listo para desplegar
              </>
            )}
          </Badge>
          <Badge variant={config?.configured ? "secondary" : "destructive"} className="px-3 py-1">
            {config?.configured
              ? `Hook configurado (${config.source === "database" ? "base de datos" : "variable de entorno"})`
              : "Sin Deploy Hook configurado"}
          </Badge>
        </div>

        {config?.masked_url && (
          <p className="text-xs text-muted-foreground break-all">
            Hook actual: {config.masked_url}
            {config.updated_at ? ` · actualizado ${fmt(config.updated_at)}` : ""}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button onClick={deploy} disabled={busy} size="lg">
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Desplegando…
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4" /> Desplegar ahora
              </>
            )}
          </Button>
          <Button variant="outline" asChild>
            <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> Ver Vercel
            </a>
          </Button>
        </div>

        {result && (
          <div
            className={`rounded-xl border p-3 text-sm ${
              result.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            <p className="font-medium">
              {result.ok ? "✅ " : "❌ "}
              {result.message}
            </p>
            <p className="mt-1 text-xs opacity-80">
              Código: {result.code}
              {result.http_status ? ` · HTTP ${result.http_status}` : ""}
              {result.job_id ? ` · Job ${result.job_id}` : ""} · {Math.round(result.duration_ms / 100) / 10}s
            </p>
          </div>
        )}

        <div className="space-y-2 rounded-xl border p-3">
          <Label htmlFor="vercel-hook" className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Deploy Hook de Vercel
          </Label>
          <p className="text-xs text-muted-foreground">
            Se guarda en la base de datos para que funcione tanto en Lovable como en Vercel. Genéralo
            en Vercel → Settings → Git → Deploy Hooks (rama <code>main</code>).
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="vercel-hook"
              value={hookInput}
              onChange={(e) => setHookInput(e.target.value)}
              placeholder="https://api.vercel.com/v1/integrations/deploy/prj_.../clave"
            />
            <Button onClick={persistHook} disabled={saving || hookInput.trim().length < 20} variant="secondary">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Historial de despliegues</p>
          {!history?.length ? (
            <p className="text-xs text-muted-foreground">Aún no hay despliegues registrados.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {history.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1">
                  {row.status === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-rose-600" />
                  )}
                  <span className="font-medium">{fmt(row.created_at)}</span>
                  <span className="text-muted-foreground">
                    {row.duration_ms ? `${Math.round(row.duration_ms / 100) / 10}s` : "—"}
                    {row.http_status ? ` · HTTP ${row.http_status}` : ""}
                  </span>
                  <span className="flex-1 truncate text-muted-foreground">{row.message}</span>
                  {row.build_url && (
                    <a className="underline" href={row.build_url} target="_blank" rel="noreferrer">
                      Ver build
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
