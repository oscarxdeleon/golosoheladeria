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
import { Plus, Users, Trash2, QrCode, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import tableFree from "@/assets/table-free.png";
import tableOccupied from "@/assets/table-occupied.png";

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
  const [createOpen, setCreateOpen] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newSeats, setNewSeats] = useState("4");

  const { data: mesas = [] } = useQuery({
    queryKey: ["restaurant_tables"],
    queryFn: async () => {
      const { data } = await supabase
        .from("restaurant_tables")
        .select("*")
        .eq("active", true)
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
    // Marca como ocupada si está libre
    if (m.status === "free") {
      await supabase
        .from("restaurant_tables")
        .update({
          status: "occupied",
          current_guests: m.seats,
          occupied_at: new Date().toISOString(),
        })
        .eq("id", m.id);
      qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
    }
    navigate({ to: "/pos", search: { type: "mesa", tableId: m.id } });
  }

  async function liberar(m: Mesa, e: React.MouseEvent) {
    e.stopPropagation();
    await supabase
      .from("restaurant_tables")
      .update({ status: "free", current_guests: null, occupied_at: null })
      .eq("id", m.id);
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
    toast.success(`Mesa ${m.number} liberada`);
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
    const { error } = await supabase.from("restaurant_tables").insert({
      number: n,
      label: `Mesa ${n}`,
      seats: Number(newSeats) || 4,
      pos_x: mesas.length % 4,
      pos_y: Math.floor(mesas.length / 4),
    });
    if (error) return toast.error(error.message);
    toast.success("Mesa creada");
    setCreateOpen(false);
    setNewNumber("");
    setNewSeats("4");
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Mapa de mesas</h1>
          <p className="text-sm text-muted-foreground">
            Toca una mesa para abrir el menú y tomar el pedido
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
                  <div className="mt-2 font-display text-xl">{m.label ?? `Mesa ${m.number}`}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {occupied && m.current_guests
                      ? `${m.current_guests}/${m.seats}`
                      : `${m.seats} puestos`}
                  </div>
                  <Badge
                    variant={occupied ? "destructive" : reserved ? "outline" : "secondary"}
                    className="mt-2"
                  >
                    {STATUS_LABEL[m.status]}
                  </Badge>
                  {occupied && (
                    <span
                      role="button"
                      onClick={(e) => liberar(m, e)}
                      className="absolute top-2 right-2 rounded-md bg-background/80 px-2 py-0.5 text-[10px] font-medium hover:bg-background"
                    >
                      Liberar
                    </span>
                  )}
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
    </div>
  );
}
