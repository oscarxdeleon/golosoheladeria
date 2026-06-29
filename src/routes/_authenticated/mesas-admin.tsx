import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/branch-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, QrCode, Download, Printer, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/mesas-admin")({
  head: () => ({ meta: [{ title: "Gestión de mesas · Goloso POS" }] }),
  component: MesasAdminPage,
});

type Room = { id: string; branch_id: string | null; name: string; sort_order: number; active: boolean };
type TableRow = {
  id: string; number: number; label: string | null; seats: number;
  room_id: string | null; branch_id: string | null; active: boolean;
};

function slug(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function MesasAdminPage() {
  const { activeBranchId, activeBranch, branches } = useBranch();
  const qc = useQueryClient();
  const [selectedRoomId, setSelectedRoomId] = useState<string | "all">("all");

  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", activeBranchId],
    queryFn: async () => {
      let q = supabase.from("rooms").select("*").order("sort_order").order("name");
      if (activeBranchId) q = q.or(`branch_id.eq.${activeBranchId},branch_id.is.null`);
      const { data } = await q;
      return (data ?? []) as Room[];
    },
  });

  const { data: tables = [] } = useQuery({
    queryKey: ["mesas-admin", activeBranchId],
    queryFn: async () => {
      let q = supabase.from("restaurant_tables").select("*").eq("active", true).order("number");
      if (activeBranchId) q = q.or(`branch_id.eq.${activeBranchId},branch_id.is.null`);
      const { data } = await q;
      return (data ?? []) as TableRow[];
    },
  });

  const visibleTables = useMemo(
    () => (selectedRoomId === "all" ? tables : tables.filter((t) => t.room_id === selectedRoomId)),
    [tables, selectedRoomId],
  );

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const branchSlug = activeBranch ? slug(activeBranch.name) : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2">
          <LayoutGrid className="h-7 w-7" /> Gestión de mesas
        </h1>
        <p className="text-sm text-muted-foreground">
          Organiza tus salas, mesas y descarga los códigos QR para cada una.
          {activeBranch && <> Sede activa: <strong>{activeBranch.name}</strong>.</>}
        </p>
      </div>

      {/* Salas */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Salas / Zonas</CardTitle>
            <CardDescription>Crea las áreas físicas de tu local (ej. Principal, Terraza).</CardDescription>
          </div>
          <RoomDialog branchId={activeBranchId} onSaved={() => qc.invalidateQueries({ queryKey: ["rooms"] })} />
        </CardHeader>
        <CardContent>
          {rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay salas. Crea la primera para empezar a organizar tus mesas.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {rooms.map((r) => (
                <div key={r.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {tables.filter((t) => t.room_id === r.id).length} mesas
                      {r.branch_id ? "" : " · Global"}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <RoomDialog room={r} branchId={activeBranchId} onSaved={() => qc.invalidateQueries({ queryKey: ["rooms"] })}>
                      <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
                    </RoomDialog>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        if (!confirm(`Eliminar la sala "${r.name}"? Las mesas asociadas quedarán sin sala.`)) return;
                        const { error } = await supabase.from("rooms").delete().eq("id", r.id);
                        if (error) return toast.error(error.message);
                        toast.success("Sala eliminada");
                        qc.invalidateQueries({ queryKey: ["rooms"] });
                        qc.invalidateQueries({ queryKey: ["mesas-admin"] });
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mesas + QR */}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle>Mesas y códigos QR</CardTitle>
            <CardDescription>Cada mesa genera un QR único que abre el menú con la mesa pre-seleccionada.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedRoomId} onValueChange={(v) => setSelectedRoomId(v as string)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filtrar por sala" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las salas</SelectItem>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TableDialog
              rooms={rooms}
              branches={branches}
              defaultBranchId={activeBranchId}
              onSaved={() => qc.invalidateQueries({ queryKey: ["mesas-admin"] })}
            />
          </div>
        </CardHeader>
        <CardContent>
          {visibleTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay mesas en este filtro.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {visibleTables.map((t) => {
                const room = rooms.find((r) => r.id === t.room_id);
                const params = new URLSearchParams();
                if (branchSlug) params.set("sede", branchSlug);
                if (room) params.set("sala", slug(room.name));
                params.set("mesa", String(t.number));
                const url = `${origin}/t/${t.number}?${params.toString()}`;
                return (
                  <TableQrCard
                    key={t.id}
                    table={t}
                    roomName={room?.name ?? "Sin sala"}
                    branchName={activeBranch?.name}
                    url={url}
                    rooms={rooms}
                    branches={branches}
                    onSaved={() => qc.invalidateQueries({ queryKey: ["mesas-admin"] })}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Sala (CRUD) ---------- */
function RoomDialog({
  room, branchId, onSaved, children,
}: {
  room?: Room; branchId: string | null; onSaved: () => void; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(room?.name ?? "");
  const [sort, setSort] = useState(String(room?.sort_order ?? 0));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return toast.error("Escribe un nombre para la sala");
    setSaving(true);
    const payload = { name: name.trim(), sort_order: Number(sort) || 0, branch_id: branchId };
    const op = room
      ? supabase.from("rooms").update(payload).eq("id", room.id)
      : supabase.from("rooms").insert(payload);
    const { error } = await op;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(room ? "Sala actualizada" : "Sala creada");
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? <Button size="sm"><Plus className="h-4 w-4" /> Nueva sala</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? "Editar sala" : "Nueva sala"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sala Principal" />
          </div>
          <div>
            <Label>Orden</Label>
            <Input type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Mesa (CRUD) ---------- */
function TableDialog({
  table, rooms, branches, defaultBranchId, onSaved, children,
}: {
  table?: TableRow; rooms: Room[];
  branches: { id: string; name: string }[];
  defaultBranchId: string | null;
  onSaved: () => void; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState(String(table?.number ?? ""));
  const [label, setLabel] = useState(table?.label ?? "");
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [roomId, setRoomId] = useState<string | "none">(table?.room_id ?? "none");
  const [branchId, setBranchId] = useState<string | "none">(table?.branch_id ?? defaultBranchId ?? "none");
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = Number(number);
    if (!n || n < 1) return toast.error("Número de mesa inválido");
    setSaving(true);
    const payload = {
      number: n,
      label: label.trim() || null,
      seats: Math.max(1, Number(seats) || 1),
      room_id: roomId === "none" ? null : roomId,
      branch_id: branchId === "none" ? null : branchId,
    };
    const op = table
      ? supabase.from("restaurant_tables").update(payload).eq("id", table.id)
      : supabase.from("restaurant_tables").insert(payload);
    const { error } = await op;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(table ? "Mesa actualizada" : "Mesa creada");
    setOpen(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? <Button size="sm"><Plus className="h-4 w-4" /> Nueva mesa</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{table ? `Editar mesa #${table.number}` : "Nueva mesa"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Número</Label>
            <Input type="number" value={number} onChange={(e) => setNumber(e.target.value)} />
          </div>
          <div>
            <Label>Capacidad (sillas)</Label>
            <Input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Nombre/Etiqueta (opcional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Mesa VIP, Barra 1…" />
          </div>
          <div>
            <Label>Sala</Label>
            <Select value={roomId} onValueChange={(v) => setRoomId(v as string)}>
              <SelectTrigger><SelectValue placeholder="Sin sala" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin sala</SelectItem>
                {rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sede</Label>
            <Select value={branchId} onValueChange={(v) => setBranchId(v as string)}>
              <SelectTrigger><SelectValue placeholder="Sin sede" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin sede</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Tarjeta QR ---------- */
function TableQrCard({
  table, roomName, branchName, url, rooms, branches, onSaved,
}: {
  table: TableRow; roomName: string; branchName?: string; url: string;
  rooms: Room[]; branches: { id: string; name: string }[]; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);

  function getCanvas(): HTMLCanvasElement | null {
    return canvasRef.current?.querySelector<HTMLCanvasElement>("canvas") ?? null;
  }

  function download() {
    const c = getCanvas();
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `mesa-${table.number}-${roomName.replace(/\s+/g, "-").toLowerCase()}.png`;
    a.click();
  }

  function print() {
    const c = getCanvas();
    if (!c) return;
    const dataUrl = c.toDataURL("image/png");
    const w = window.open("", "_blank", "width=420,height=600");
    if (!w) return;
    w.document.write(`
      <html><head><title>QR Mesa ${table.number}</title>
      <style>
        @page { size: 80mm auto; margin: 6mm; }
        body { font-family: system-ui, -apple-system, sans-serif; text-align: center; margin: 0; padding: 12px; color: #000; }
        h1 { font-size: 26px; margin: 4px 0; }
        h2 { font-size: 16px; margin: 2px 0; font-weight: 500; color: #444; }
        img { width: 80%; max-width: 280px; margin: 10px auto; display: block; }
        p { font-size: 12px; color: #555; margin: 4px 0; }
      </style></head>
      <body>
        ${branchName ? `<h2>${branchName}</h2>` : ""}
        <h1>${roomName} · Mesa ${table.number}</h1>
        <img src="${dataUrl}" alt="QR" />
        <p>Escanea para ver el menú y pedir desde tu mesa</p>
        <script>window.onload=()=>{setTimeout(()=>{window.print();},150);};</script>
      </body></html>
    `);
    w.document.close();
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-1">
              <QrCode className="h-4 w-4" /> Mesa {table.number}
            </CardTitle>
            <CardDescription className="text-xs">
              {roomName} · {table.seats} sillas{table.label ? ` · ${table.label}` : ""}
            </CardDescription>
          </div>
          <div className="flex gap-1">
            <TableDialog
              table={table}
              rooms={rooms}
              branches={branches}
              defaultBranchId={table.branch_id}
              onSaved={onSaved}
            >
              <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
            </TableDialog>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                if (!confirm(`Eliminar mesa ${table.number}?`)) return;
                const { error } = await supabase.from("restaurant_tables").update({ active: false }).eq("id", table.id);
                if (error) return toast.error(error.message);
                toast.success("Mesa eliminada");
                qc.invalidateQueries({ queryKey: ["mesas-admin"] });
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        <div ref={canvasRef} className="rounded-lg border bg-white p-3">
          <QRCodeCanvas value={url} size={160} level="M" includeMargin />
        </div>
        <p className="text-[10px] text-muted-foreground break-all text-center max-w-full">{url}</p>
        <div className="flex gap-2 w-full">
          <Button variant="outline" size="sm" className="flex-1" onClick={download}>
            <Download className="h-4 w-4" /> PNG
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={print}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
