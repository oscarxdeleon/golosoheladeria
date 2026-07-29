import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, QrCode, LogOut, RefreshCw, CheckCircle2, AlertCircle, RotateCcw, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { requestBranchHubQr, getBranchHubStatus, logoutBranchHub, resetBranchHub, pairBranchHub } from "@/lib/whatsapp-hub.functions";
import { useBranch } from "@/contexts/branch-context";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  disconnected: { label: "Desconectado", variant: "secondary" },
  connecting: { label: "Conectando...", variant: "outline" },
  awaiting_qr: { label: "Escanea el QR", variant: "outline" },
  connected: { label: "Conectado", variant: "default" },
  needs_qr: { label: "Sesión expirada", variant: "destructive" },
  error: { label: "Error", variant: "destructive" },
};

export function WhatsAppHubCard({ branchId: branchIdProp }: { branchId?: string | null } = {}) {
  const { branches, activeBranchId } = useBranch();
  const branchId = branchIdProp ?? activeBranchId;
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);
  const [pairPhone, setPairPhone] = useState("");
  const [showPair, setShowPair] = useState(false);

  const getStatus = useServerFn(getBranchHubStatus);
  const requestQr = useServerFn(requestBranchHubQr);
  const logout = useServerFn(logoutBranchHub);
  const reset = useServerFn(resetBranchHub);
  const pair = useServerFn(pairBranchHub);

  const branch = branches.find((b) => b.id === branchId);


  const { data: status, refetch } = useQuery({
    queryKey: ["whatsapp-hub-status", branchId],
    queryFn: () => getStatus({ data: { branchId: branchId! } }),
    enabled: !!branchId,
    refetchInterval: polling ? 2500 : false,
  });

  useEffect(() => {
    if (!status) return;
    if (status.status === "awaiting_qr" || status.status === "connecting") setPolling(true);
    else setPolling(false);
  }, [status]);

  const connectMut = useMutation({
    mutationFn: (reset?: boolean) => requestQr({ data: { branchId: branchId!, reset: reset === true } }),
    onSuccess: () => {
      setPolling(true);
      toast.success("Generando QR nuevo...");
      qc.invalidateQueries({ queryKey: ["whatsapp-hub-status", branchId] });
      setTimeout(() => refetch(), 1200);
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo conectar al Hub"),
  });

  const resetMut = useMutation({
    mutationFn: () => reset({ data: { branchId: branchId! } }),
    onSuccess: () => {
      setPolling(true);
      toast.success("Sesión reiniciada — escanea el nuevo QR");
      qc.invalidateQueries({ queryKey: ["whatsapp-hub-status", branchId] });
      setTimeout(() => refetch(), 1200);
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo reiniciar"),
  });

  const logoutMut = useMutation({
    mutationFn: () => logout({ data: { branchId: branchId! } }),
    onSuccess: () => {
      toast.success("Sesión cerrada");
      qc.invalidateQueries({ queryKey: ["whatsapp-hub-status", branchId] });
    },
    onError: (e: any) => toast.error(e?.message || "Error al cerrar sesión"),
  });

  const pairMut = useMutation({
    mutationFn: () => pair({ data: { branchId: branchId!, phone: pairPhone } }),
    onSuccess: (r) => {
      setPolling(true);
      toast.success(`Código generado: ${r.code}`);
      qc.invalidateQueries({ queryKey: ["whatsapp-hub-status", branchId] });
      setTimeout(() => refetch(), 1200);
    },
    onError: (e: any) => toast.error(e?.message || "No se pudo generar el código"),
  });

  if (!branchId) return null;
  const s = status?.status || "disconnected";
  const meta = STATUS_LABELS[s] || STATUS_LABELS.disconnected;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              WhatsApp Hub Centralizado
              <Badge variant="outline" className="text-xs">Nuevo</Badge>
            </CardTitle>
            <CardDescription>
              Vincula WhatsApp por QR directamente desde el POS — sin instalar nada en las sedes.
              {branch && <> Sede: <b>{branch.name}</b></>}
            </CardDescription>
          </div>
          <Badge variant={meta.variant} className="flex items-center gap-1">
            {s === "connected" ? <CheckCircle2 className="h-3 w-3" /> :
             s === "needs_qr" || s === "error" ? <AlertCircle className="h-3 w-3" /> :
             polling ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {meta.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.phone && s === "connected" && (
          <div className="text-sm text-muted-foreground">
            Número conectado: <span className="font-mono font-semibold">+{status.phone}</span>
          </div>
        )}

        {status?.qr && (s === "awaiting_qr" || s === "connecting") && (
          <div className="flex flex-col items-center gap-3 p-4 bg-muted/30 rounded-lg">
            <img src={status.qr} alt="QR WhatsApp" className="w-64 h-64 rounded bg-white p-2" />
            <p className="text-xs text-center text-muted-foreground max-w-sm">
              Abre WhatsApp en el teléfono de la sede → <b>Ajustes → Dispositivos vinculados → Vincular un dispositivo</b> → escanea este QR.
            </p>
          </div>
        )}

        {status?.pairingCode && s !== "connected" && (
          <div className="flex flex-col items-center gap-2 p-4 bg-primary/5 border border-primary/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Código de vinculación (válido ~60s):</p>
            <p className="text-3xl font-mono font-bold tracking-widest">{status.pairingCode}</p>
            <p className="text-xs text-center text-muted-foreground max-w-sm">
              En el teléfono: WhatsApp → <b>Ajustes → Dispositivos vinculados → Vincular un dispositivo → Vincular con número de teléfono</b> → escribe este código.
            </p>
          </div>
        )}

        {s !== "connected" && (
          <div className="border-t pt-3">
            <button
              type="button"
              className="text-xs text-primary underline"
              onClick={() => setShowPair((v) => !v)}
            >
              {showPair ? "Ocultar" : "¿El QR no funciona? Usar código de 8 dígitos"}
            </button>
            {showPair && (
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <Label htmlFor="pair-phone" className="text-xs">Número con código de país (ej: 573001234567)</Label>
                  <Input
                    id="pair-phone"
                    value={pairPhone}
                    onChange={(e) => setPairPhone(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="573001234567"
                    inputMode="numeric"
                  />
                </div>
                <Button
                  className="self-end"
                  onClick={() => pairMut.mutate()}
                  disabled={pairMut.isPending || pairPhone.length < 10}
                >
                  {pairMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />}
                  Generar código
                </Button>
              </div>
            )}
          </div>
        )}


        {status?.lastError && (
          <div className="text-xs text-destructive p-2 bg-destructive/10 rounded">
            {status.lastError}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {s !== "connected" && (
            <Button onClick={() => connectMut.mutate(true)} disabled={connectMut.isPending}>
              {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
              {s === "awaiting_qr" ? "Generar QR nuevo" : "Generar QR nuevo y vincular"}
            </Button>
          )}
          {s !== "connected" && (status?.lastError || s === "needs_qr" || s === "error" || s === "disconnected") && (
            <Button variant="secondary" onClick={() => resetMut.mutate()} disabled={resetMut.isPending}>
              {resetMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              Reiniciar sesión (borrar y re-vincular)
            </Button>
          )}
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualizar estado
          </Button>
          {s === "connected" && (
            <Button variant="destructive" onClick={() => logoutMut.mutate()} disabled={logoutMut.isPending}>
              <LogOut className="h-4 w-4 mr-2" />
              Cerrar sesión
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground border-t pt-3">
          El Hub corre en tu servidor y mantiene la sesión abierta. Si WhatsApp la cierra
          (algo poco frecuente), aquí mismo generas un nuevo QR — nunca tienes que ir a la sede.
        </p>
      </CardContent>
    </Card>
  );
}
