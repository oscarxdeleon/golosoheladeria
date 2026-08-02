import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Rocket, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { deployToVercel } from "@/lib/vercel-deploy.functions";

export function VercelDeployCard() {
  const run = useServerFn(deployToVercel);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);

  const deploy = async () => {
    setBusy(true);
    setLastResult(null);
    try {
      await run({ data: {} as never });
      setLastResult({ ok: true, message: "Despliegue iniciado en Vercel. En unos minutos los cambios estarán en línea." });
      toast.success("Despliegue iniciado en Vercel");
    } catch (e) {
      const message = String(e).slice(0, 200);
      setLastResult({ ok: false, message });
      toast.error("No se pudo desplegar en Vercel", { description: message });
    } finally {
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
          Lanza un nuevo build en Vercel con los últimos cambios guardados en Lovable. El proceso
          toma 1–3 minutos y no afecta las sesiones de WhatsApp ni las tablets de meseros.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="px-3 py-1 text-sm font-medium">
            {busy ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Solicitando despliegue…
              </>
            ) : lastResult?.ok ? (
              <>
                <CheckCircle2 className="mr-1 h-4 w-4 text-emerald-600" /> Solicitud enviada
              </>
            ) : lastResult?.ok === false ? (
              <>
                <XCircle className="mr-1 h-4 w-4 text-rose-600" /> Error al enviar
              </>
            ) : (
              <>
                <Rocket className="mr-1 h-4 w-4" /> Listo para desplegar
              </>
            )}
          </Badge>
        </div>

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

        {lastResult && (
          <div
            className={`rounded-xl border p-3 text-sm ${
              lastResult.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            <p className="font-medium">{lastResult.ok ? "✅ " : "❌ "}{lastResult.message}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
