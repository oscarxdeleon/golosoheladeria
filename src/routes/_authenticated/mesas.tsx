import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, QrCode, Copy, Download, LogOut, ArrowRightLeft, ShoppingBag, Bike, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/branch-context";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import tableFree from "@/assets/mesa_libre.png";
import tableOccupied from "@/assets/mesa_ocupada.png";

export const Route = createFileRoute("/_authenticated/mesas")({
  head: () => ({ meta: [{ title: "Mesas · Goloso POS" }] }),
  component: MesasPage,
});

type Status = "free" | "occupied" | "reserved";
interface Mesa {
  id: string;
  number: number;
  label: string | null;
  seats: number;
  status: Status;
  current_guests: number | null;
  occupied_at: string | null;
  notes: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  free: "Libre",
  occupied: "Ocupada",
  reserved: "Reservada",
};

function MesasPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const [createOpen, setCreateOpen] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newSeats, setNewSeats] = useState("4");
  const [qrMesa, setQrMesa] = useState<Mesa | null>(null);
  const [releaseMesa, setReleaseMesa] = useState<Mesa | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [moveFrom, setMoveFrom] = useState<Mesa | null>(null);
  const [moveTarget, setMoveTarget] = useState<Mesa | null>(null);
  const [moving, setMoving] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const { data: mesas = [] } = useQuery({
    queryKey: ["restaurant_tables", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("restaurant_tables")
        .select("*")
        .eq("active", true)
        .eq("branch_id", activeBranchId!)
        .order("number");
      return (data ?? []) as Mesa[];
    },
  });

  const counts = mesas.reduce(
    (acc, m) => {
      acc[m.status] += 1;
      return acc;
    },
    { free: 0, occupied: 0, reserved: 0 } as Record<Status, number>,
  );

  async function openMesa(m: Mesa) {
    // La mesa solo cambia a "ocupada" cuando se guarda un pedido con al menos un producto
    // (lo gestiona el trigger de DB sobre sale_items).
    navigate({ to: "/pos", search: { type: "mesa", tableId: m.id } });
  }


  async function confirmRelease() {
    if (!releaseMesa) return;
    if (releaseReason.trim().length < 3) {
      return toast.error("Ingresa un motivo (mínimo 3 caracteres)");
    }
    setReleasing(true);
    const { error } = await supabase.rpc("release_table", {
      _table_id: releaseMesa.id,
      _reason: releaseReason.trim(),
    });
    setReleasing(false);
    if (error) return toast.error(error.message);
    toast.success(`Mesa ${releaseMesa.number} liberada`);
    setReleaseMesa(null);
    setReleaseReason("");
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  async function doMove(force = false) {
    if (!moveFrom || !moveTarget) return;
    setMoving(true);
    const { error } = await supabase.rpc("move_table", {
      _from_table_id: moveFrom.id,
      _to_table_id: moveTarget.id,
      _reason: undefined,
      _force: force,
    });
    setMoving(false);
    if (error) {
      if (error.message.includes("destination_occupied")) {
        if (confirm(`La mesa ${moveTarget.number} ya tiene un pedido activo. ¿Deseas continuar y fusionar?`)) {
          return doMove(true);
        }
        return;
      }
      return toast.error(error.message);
    }
    toast.success(`Pedido movido a Mesa ${moveTarget.number}`);
    setMoveFrom(null);
    setMoveTarget(null);
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  async function eliminar(m: Mesa, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar Mesa ${m.number}?`)) return;
    await supabase.from("restaurant_tables").update({ active: false }).eq("id", m.id);
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
    toast.success("Mesa eliminada");
  }

  async function createMesa() {
    const n = Number(newNumber);
    if (!n) return toast.error("Número de mesa requerido");
    if (!activeBranchId) return toast.error("Selecciona una sede primero");
    const { error } = await supabase.from("restaurant_tables").insert({
      number: n,
      label: `Mesa ${n}`,
      seats: Number(newSeats) || 4,
      pos_x: mesas.length % 4,
      pos_y: Math.floor(mesas.length / 4),
      branch_id: activeBranchId,
    });
    if (error) return toast.error(error.message);
    toast.success("Mesa creada");
    setCreateOpen(false);
    setNewNumber("");
    setNewSeats("4");
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  return (
    <BranchCashGuard>
    <div className="space-y-6">
      {/* Accesos rápidos a otros canales de venta */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Button
          onClick={() => navigate({ to: "/llevar" })}
          className="h-28 text-2xl font-extrabold uppercase tracking-wide shadow-md hover:shadow-lg transition bg-amber-500 hover:bg-amber-600 text-white [&_svg]:size-10"
        >
          <ShoppingBag className="mr-3" />
          Para llevar
        </Button>
        <Button
          onClick={() => navigate({ to: "/domicilio" })}
          className="h-28 text-2xl font-extrabold uppercase tracking-wide shadow-md hover:shadow-lg transition bg-sky-600 hover:bg-sky-700 text-white [&_svg]:size-10"
        >
          <Bike className="mr-3" />
          A domicilio
        </Button>
        <Button
          onClick={() => navigate({ to: "/kiosko" })}
          className="h-28 text-2xl font-extrabold uppercase tracking-wide shadow-md hover:shadow-lg transition bg-emerald-600 hover:bg-emerald-700 text-white [&_svg]:size-10"
        >
          <Smartphone className="mr-3" />
          Autopedido
        </Button>
      </div>


      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Mapa de mesas</h1>
          <p className="text-sm text-muted-foreground">
            {activeBranch ? `${activeBranch.name} · ` : ""}Toca una mesa para abrir el menú y tomar el pedido
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Libres: {counts.free}</Badge>
          <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Ocupadas: {counts.occupied}
          </Badge>
          <Badge variant="outline">Reservadas: {counts.reserved}</Badge>
          {isAdmin && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Nueva mesa
            </Button>
          )}
        </div>
      </div>


      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {mesas.map((m) => {
              const occupied = m.status === "occupied";
              const reserved = m.status === "reserved";
              return (
                <button
                  key={m.id}
                  onClick={() => openMesa(m)}
                  className={`group relative flex flex-col items-center rounded-2xl border-2 p-3 transition hover:shadow-lg active:scale-[0.98] ${
                    occupied
                      ? "border-destructive/60 bg-destructive/5"
                      : reserved
                        ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20"
                        : "border-success/50 bg-success/5"
                  }`}
                >
                  <img
                    src={occupied ? tableOccupied : tableFree}
                    alt={occupied ? "Mesa ocupada" : "Mesa libre"}
                    loading="lazy"
                    width={512}
                    height={512}
                    className="h-24 w-24 object-contain"
                  />
                  <div className="mt-2 font-display text-4xl font-bold leading-none">{m.number}</div>
                  <Badge
                    variant={occupied ? "destructive" : reserved ? "outline" : "secondary"}
                    className="mt-2"
                  >
                    {STATUS_LABEL[m.status]}
                  </Badge>
                  {occupied && (
                    <div className="absolute top-2 right-2 flex gap-1">
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); setMoveFrom(m); }}
                        className="rounded-md bg-background/90 px-2 py-0.5 text-[10px] font-medium hover:bg-background flex items-center gap-1"
                        title="Mover mesa"
                      >
                        <ArrowRightLeft className="h-3 w-3" /> Mover
                      </span>
                      <span
                        role="button"
                        onClick={(e) => { e.stopPropagation(); setReleaseMesa(m); setReleaseReason(""); }}
                        className="rounded-md bg-background/90 px-2 py-0.5 text-[10px] font-medium hover:bg-background flex items-center gap-1"
                        title="Liberar mesa"
                      >
                        <LogOut className="h-3 w-3" /> Liberar
                      </span>
                    </div>
                  )}
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); setQrMesa(m); }}
                    className="absolute bottom-2 right-2 rounded-md bg-background/80 p-1 text-foreground hover:bg-background"
                    aria-label="QR de la mesa"
                    title="QR para pedir desde el teléfono"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                  </span>
                  {isAdmin && (
                    <span
                      role="button"
                      onClick={(e) => eliminar(m, e)}
                      className="absolute top-2 left-2 rounded-md bg-background/80 p-1 text-destructive opacity-0 group-hover:opacity-100"
                      aria-label="Eliminar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
            {mesas.length === 0 && (
              <div className="col-span-full text-center text-sm text-muted-foreground py-12">
                Sin mesas. {isAdmin ? "Crea la primera." : "Pide a un admin que cree mesas."}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva mesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Número</label>
              <Input
                type="number"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Puestos</label>
              <Input
                type="number"
                value={newSeats}
                onChange={(e) => setNewSeats(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createMesa}>Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrMesa} onOpenChange={(o) => !o && setQrMesa(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>QR · {qrMesa?.label ?? `Mesa ${qrMesa?.number}`}</DialogTitle>
            <DialogDescription>
              El cliente escanea con su teléfono y pide directamente desde la mesa.
            </DialogDescription>
          </DialogHeader>
          {qrMesa && (
            <div className="flex flex-col items-center gap-3">
              <div id={`mesa-qr-${qrMesa.number}`} className="rounded-xl border bg-white p-4">
                <QRCodeCanvas value={`${origin}/t/${qrMesa.number}`} size={220} level="M" />
              </div>
              <div className="text-xs text-muted-foreground break-all text-center font-mono">
                {origin}/t/{qrMesa.number}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(`${origin}/t/${qrMesa.number}`);
                    toast.success("Link copiado");
                  }}
                >
                  <Copy className="h-4 w-4" /> Copiar link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const canvas = document.querySelector<HTMLCanvasElement>(`#mesa-qr-${qrMesa.number} canvas`);
                    if (!canvas) return;
                    const a = document.createElement("a");
                    a.href = canvas.toDataURL("image/png");
                    a.download = `mesa-${qrMesa.number}-qr.png`;
                    a.click();
                  }}
                >
                  <Download className="h-4 w-4" /> Descargar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center px-2">
                Imprime el QR y pégalo sobre la mesa. Imprime una etiqueta resistente al agua.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Release with mandatory reason */}
      <Dialog open={!!releaseMesa} onOpenChange={(o) => { if (!o) { setReleaseMesa(null); setReleaseReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar Mesa {releaseMesa?.number}</DialogTitle>
            <DialogDescription>
              Ingrese el motivo por el cual desea liberar o cancelar esta mesa. El pedido pendiente se cancelará.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo <span className="text-destructive">*</span></label>
            <Textarea
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              placeholder="Ej: Cliente se retiró sin consumir, error de mesera, mesa marcada por error..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseMesa(null)} disabled={releasing}>
              Cancelar acción
            </Button>
            <Button variant="destructive" onClick={confirmRelease} disabled={releasing || releaseReason.trim().length < 3}>
              Confirmar liberación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move table */}
      <Dialog open={!!moveFrom} onOpenChange={(o) => { if (!o) { setMoveFrom(null); setMoveTarget(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mover Mesa {moveFrom?.number}</DialogTitle>
            <DialogDescription>
              Selecciona la mesa destino. El pedido, productos y tiempo de ocupación se trasladarán automáticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-[50vh] overflow-y-auto p-1">
            {mesas.filter((m) => m.id !== moveFrom?.id).map((m) => {
              const isTarget = moveTarget?.id === m.id;
              const isOcc = m.status === "occupied";
              return (
                <button
                  key={m.id}
                  onClick={() => setMoveTarget(m)}
                  className={`rounded-xl border-2 p-3 text-center transition ${
                    isTarget ? "border-primary bg-primary/10 ring-2 ring-primary"
                      : isOcc ? "border-destructive/40 bg-destructive/5"
                      : "border-success/40 bg-success/5 hover:border-success"
                  }`}
                >
                  <div className="font-display text-2xl font-bold">{m.number}</div>
                  <div className="text-[10px] text-muted-foreground">{STATUS_LABEL[m.status]}</div>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMoveFrom(null); setMoveTarget(null); }} disabled={moving}>
              Cancelar
            </Button>
            <Button onClick={() => doMove(false)} disabled={!moveTarget || moving}>
              Confirmar traslado{moveTarget ? ` a Mesa ${moveTarget.number}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </BranchCashGuard>
  );
}
