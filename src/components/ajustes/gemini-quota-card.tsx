import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";

interface QuotaSettings {
  gemini_daily_limit: number;
  gemini_alert_emails: string[];
}

interface QuotaRow {
  usage_date: string;
  call_count: number;
  alert_80_sent: boolean;
  alert_95_sent: boolean;
}

export function GeminiQuotaCard() {
  const qc = useQueryClient();
  const [limitInput, setLimitInput] = useState<string>("1500");
  const [emailsInput, setEmailsInput] = useState<string>("");

  const { data: settings } = useQuery({
    queryKey: ["gemini-quota-settings"],
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("gemini_daily_limit,gemini_alert_emails")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { gemini_daily_limit: 1500, gemini_alert_emails: [] }) as QuotaSettings;
    },
  });

  const { data: today } = useQuery({
    queryKey: ["gemini-quota-today"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const iso = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("gemini_quota_daily")
        .select("*")
        .eq("usage_date", iso)
        .maybeSingle();
      return (data ?? { usage_date: iso, call_count: 0, alert_80_sent: false, alert_95_sent: false }) as QuotaRow;
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["gemini-quota-history"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("gemini_quota_daily")
        .select("usage_date,call_count")
        .order("usage_date", { ascending: false })
        .limit(7);
      return (data ?? []) as Array<{ usage_date: string; call_count: number }>;
    },
  });

  useEffect(() => {
    if (settings) {
      setLimitInput(String(settings.gemini_daily_limit ?? 1500));
      setEmailsInput((settings.gemini_alert_emails ?? []).join(", "));
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const limit = Math.max(1, Math.floor(Number(limitInput) || 1500));
      const emails = emailsInput
        .split(/[,\n;]+/)
        .map((e) => e.trim())
        .filter((e) => e.includes("@"));
      const { error } = await supabase
        .from("settings")
        .update({ gemini_daily_limit: limit, gemini_alert_emails: emails })
        .eq("id", 1);
      if (error) throw error;
      return { limit, emails };
    },
    onSuccess: () => {
      toast.success("Configuración de cuota Gemini guardada");
      qc.invalidateQueries({ queryKey: ["gemini-quota-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const limit = settings?.gemini_daily_limit ?? 1500;
  const count = today?.call_count ?? 0;
  const pct = Math.min(100, Math.round((count / Math.max(limit, 1)) * 100));
  const critical = pct >= 95;
  const warn = pct >= 80 && !critical;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="w-4 h-4" /> Cuota Gemini (Google AI Studio)
        </CardTitle>
        <CardDescription>
          El bot y demás módulos de IA usan tu cuota gratuita de Google (0 créditos Lovable). Configura una alerta por correo cuando se acerque al límite diario.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">Consumo de hoy</span>
            <span className={critical ? "text-red-600 font-semibold" : warn ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
              {count} / {limit} ({pct}%)
            </span>
          </div>
          <Progress value={pct} className={critical ? "[&>div]:bg-red-500" : warn ? "[&>div]:bg-amber-500" : ""} />
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            {critical ? (
              <><AlertTriangle className="w-3.5 h-3.5 text-red-500" /> Cuota casi agotada — el bot podría caer al respaldo.</>
            ) : warn ? (
              <><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Cerca del límite diario.</>
            ) : (
              <><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Consumo dentro del rango normal.</>
            )}
          </div>
        </div>

        {history.length > 1 && (
          <div className="grid grid-cols-7 gap-1 text-center">
            {history.slice().reverse().map((h) => {
              const p = Math.min(100, Math.round((h.call_count / Math.max(limit, 1)) * 100));
              return (
                <div key={h.usage_date} className="flex flex-col items-center gap-1">
                  <div className="w-full h-14 bg-muted rounded flex items-end overflow-hidden">
                    <div
                      className={`w-full ${p >= 95 ? "bg-red-500" : p >= 80 ? "bg-amber-500" : "bg-primary/60"}`}
                      style={{ height: `${p}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{h.usage_date.slice(5)}</span>
                  <span className="text-[10px] font-medium">{h.call_count}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gemini-limit">Límite diario</Label>
            <Input
              id="gemini-limit"
              type="number"
              min={1}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Google ofrece ~1500 req/día gratis para gemini-2.5-flash.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gemini-emails">Correos para alertas</Label>
            <Input
              id="gemini-emails"
              placeholder="admin@heladeriagoloso.com, otro@correo.com"
              value={emailsInput}
              onChange={(e) => setEmailsInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Se envía aviso al llegar al 80% y otro al 95% (una vez cada uno por día).</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Guardando…" : "Guardar configuración"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
