import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, QrCode, LogOut, RefreshCw, CheckCircle2, AlertCircle, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  getInstanceStatus,
  connectInstance,
  restartInstance,
  disconnectInstance,
  deleteInstance,
} from "@/lib/whatsapp-instance.functions";
import { useBranch } from "@/contexts/branch-context";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  no_instance: { label: "Sin instancia", variant: "secondary" },
  disconnected: { label: "Desconectado", variant: "secondary" },
  connecting: { label: "Conectando…", variant: "outline" },
  awaiting_qr: { label: "Escanea el QR", variant: "outline" },
  connected: { label: "Conectado", variant: "default" },
  error: { label: "Error", variant: "destructive" },
};

export function WhatsAppInstanceCard({ branchId: branchIdProp }: { branchId?: string | null } = {}) {
  const { branches, activeBranchId } = useBranch();
  const branchId = branchIdProp ?? activeBranchId;
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);
  const [localQr, setLocalQr] = useState<{ qr: string | null; code: string | null }>({ qr: null, code: null });

  const status$ = useServerFn(getInstanceStatus);
  const connect$ = useServerFn(connectInstance);
  const restart$ = useServerFn(restartInstance);
  const disconnect$ = useServerFn(disconnectInstance);
  const delete$ = useServerFn(deleteInstance);

  const branch = branches.find((b) => b.id === branchId);

  const { data: status, refetch, isFetching, error } = useQuery({
    queryKey: ["whatsapp-instance", branchId],
    queryFn: () => status$({ data: { branchId: branchId! } }),
    enabled: !!branchId,
    refetchInterval: polling ? 3000 : false,
    retry: false,
  });

  useEffect(() => {
    setPolling(status?.status === "awaiting_qr" || status?.status === "connecting");
  }, [status]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["whatsapp-instance", branchId] });
    setTimeout(() => refetch(), 1000);
  };

  const connectMut = useMutation({
    mutationFn: (force: boolean) => connect$({ data: { branchId: branchId!, force } }),
    onSuccess: (r: any) => {
      setPolling(true);
      setLocalQr({ qr: r?.qr ?? null, code: r?.code ?? null });
      if (r?.qr || r?.code) toast.success("QR generado — escanéalo desde el teléfono de la sede");
      else toast.info("Conectando… el QR aparecerá en unos segundos");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo generar el QR"),
  });

  const restartMut = useMutation({
    mutationFn: () => restart$({ data: { branchId: branchId! } }),
    onSuccess: () => { setPolling(true); toast.success("Instancia reiniciada"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "No se pudo reiniciar"),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnect$({ data: { branchId: branchId! } }),
    onSuccess: () => { toast.success("Sesión cerrada"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "No se pudo desconectar"),
  });

  const deleteMut = useMutation({
    mutationFn: () => delete$({ data: { branchId: branchId! } }),
    onSuccess: () => { toast.success("Instancia eliminada"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "No se pudo eliminar"),
  });

  if (!branchId) return null;
  const s = status?.status || "no_instance";
  const meta = STATUS_LABELS[s] || STATUS_LABELS.disconnected;
  const busy = connectMut.isPending || restartMut.isPending || disconnectMut.isPending || deleteMut.isPending;
  const qrImage = (status as any)?.qr || localQr.qr || null;
  const qrCode = (status as any)?.code || localQr.code || null;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              WhatsApp de la sede
            </CardTitle>
            <CardDescription>
              Instancia administrada por API: genera el QR aquí y escanéalo desde el teléfono de la sede.
              El celular sigue funcionando normal (llamadas y chats).
              {branch && <> Sede: <b>{branch.name}</b></>}
            </CardDescription>
          </div>
          <Badge variant={meta.variant} className="flex items-center gap-1">
            {s === "connected" ? <CheckCircle2 className="h-3 w-3" /> :
             s === "error" ? <AlertCircle className="h-3 w-3" /> :
             polling ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {meta.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">
            {(error as Error)?.message}
          </div>
        )}

        {status?.phone && s === "connected" && (
          <div className="text-sm text-muted-foreground">
            Número conectado: <span className="font-mono font-semibold">+{status.phone}</span>
          </div>
        )}

        {(qrImage || qrCode) && s !== "connected" && (
          <div className="flex flex-col items-center gap-3 p-4 bg-muted/30 rounded-lg">
            {qrImage ? (
              <img src={qrImage} alt="QR WhatsApp" className="w-64 h-64 rounded bg-white p-2" />
            ) : (
              <div className="rounded bg-white p-3">
                <QRCodeCanvas value={qrCode!} size={240} level="L" includeMargin />
              </div>
            )}
            <p className="text-xs text-center text-muted-foreground max-w-sm">
              En el teléfono: WhatsApp → <b>Ajustes → Dispositivos vinculados → Vincular un dispositivo</b> → escanea este QR.
            </p>
          </div>
        )}

        {!qrImage && !qrCode && s !== "connected" && polling && (
          <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Generando QR…
          </div>
        )}


        {status?.pairingCode && s !== "connected" && (
          <div className="flex flex-col items-center gap-2 p-3 bg-primary/5 border border-primary/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Código de vinculación:</p>
            <p className="text-2xl font-mono font-bold tracking-widest">{status.pairingCode}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {s !== "connected" && (
            <Button onClick={() => connectMut.mutate(false)} disabled={busy}>
              {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
              Generar nuevo QR
            </Button>
          )}
          <Button variant="secondary" onClick={() => restartMut.mutate()} disabled={busy || s === "no_instance"}>
            {restartMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
            Reconectar
          </Button>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar estado
          </Button>
          {s !== "no_instance" && (
            <Button variant="destructive" onClick={() => disconnectMut.mutate()} disabled={busy}>
              <LogOut className="h-4 w-4 mr-2" />
              Desconectar
            </Button>
          )}
          {s !== "no_instance" && (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                if (confirm("¿Eliminar la instancia de esta sede? Tendrás que escanear el QR de nuevo.")) deleteMut.mutate();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Eliminar instancia
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          Si el QR expira, presiona <b>Generar nuevo QR</b>. Si la sesión se cae, usa <b>Reconectar</b>.
          Solo si nada funciona, <b>Eliminar instancia</b> y vuelve a vincular desde cero.
        </p>
      </CardContent>
    </Card>
  );
}
