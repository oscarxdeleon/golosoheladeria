import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Search, Star, Users, TrendingUp, Phone, MapPin, FileDown, Upload } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { z } from "zod";
import * as XLSX from "xlsx";
import { useRef } from "react";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({ meta: [{ title: "Clientes · Goloso POS" }] }),
  component: ClientesPage,
});

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  neighborhood: string | null;
  email: string | null;
  points: number;
  total_spent: number;
  visits: number;
  notes: string | null;
}

const customerSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(100),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  neighborhood: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().email("Email inválido").max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

function ClientesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [adjust, setAdjust] = useState<Customer | null>(null);
  const [adjustPts, setAdjustPts] = useState(0);

  const { data = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
  });

  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.neighborhood ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  const stats = useMemo(() => {
    const total = data.length;
    const points = data.reduce((s, c) => s + (c.points || 0), 0);
    const spent = data.reduce((s, c) => s + Number(c.total_spent || 0), 0);
    return { total, points, spent };
  }, [data]);

  async function save() {
    if (!edit) return;
    const parsed = customerSchema.safeParse({
      name: edit.name ?? "",
      phone: edit.phone ?? "",
      address: edit.address ?? "",
      neighborhood: edit.neighborhood ?? "",
      email: edit.email ?? "",
      notes: edit.notes ?? "",
    });
    if (!parsed.success) {
      return toast.error(parsed.error.issues[0]?.message ?? "Datos inválidos");
    }
    const payload = {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      address: parsed.data.address || null,
      neighborhood: parsed.data.neighborhood || null,
      email: parsed.data.email || null,
      notes: parsed.data.notes || null,
    };
    const { error } = edit.id
      ? await supabase.from("customers").update(payload).eq("id", edit.id)
      : await supabase.from("customers").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(edit.id ? "Cliente actualizado" : "Cliente creado");
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este cliente?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Cliente eliminado");
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  async function saveAdjust() {
    if (!adjust) return;
    const newPts = Math.max(0, (adjust.points || 0) + adjustPts);
    const { error } = await supabase.from("customers").update({ points: newPts }).eq("id", adjust.id);
    if (error) return toast.error(error.message);
    toast.success(adjustPts >= 0 ? `+${adjustPts} puntos` : `${adjustPts} puntos`);
    setAdjust(null);
    setAdjustPts(0);
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["NOMBRE", "DIRECCION", "TELEFONO"],
      ["JUAN PEREZ", "CALLE 10 # 5-20", "3001234567"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    XLSX.writeFile(wb, "plantilla-clientes.xlsx");
  }

  async function importFromExcel(file: File) {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const norm = (s: unknown) => String(s ?? "").trim().toUpperCase();
      const normPhone = (s: unknown) => String(s ?? "").replace(/[^0-9]/g, "");

      const existingPhones = new Set(
        (data ?? []).map((c) => (c.phone ?? "").replace(/[^0-9]/g, "")).filter(Boolean),
      );
      const existingNames = new Set((data ?? []).map((c) => c.name.toUpperCase()));

      const toInsert: { name: string; address: string | null; phone: string | null }[] = [];
      let skipped = 0;
      for (const r of rows) {
        const name = norm(r["NOMBRE"] ?? r["nombre"] ?? r["Nombre"]);
        const address = norm(r["DIRECCION"] ?? r["DIRECCIÓN"] ?? r["direccion"] ?? r["Direccion"]);
        const phone = normPhone(r["TELEFONO"] ?? r["TELÉFONO"] ?? r["telefono"] ?? r["Telefono"]);
        if (!name) { skipped++; continue; }
        if ((phone && existingPhones.has(phone)) || existingNames.has(name)) { skipped++; continue; }
        toInsert.push({ name, address: address || null, phone: phone || null });
        if (phone) existingPhones.add(phone);
        existingNames.add(name);
      }

      if (toInsert.length === 0) {
        toast.info(`Sin clientes nuevos. Omitidos: ${skipped}`);
      } else {
        const { error } = await supabase.from("customers").insert(toInsert);
        if (error) throw error;
        toast.success(`${toInsert.length} clientes importados · Omitidos: ${skipped}`);
        qc.invalidateQueries({ queryKey: ["customers"] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al importar");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4 premium-scope">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Clientes y fidelización</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <FileDown className="h-4 w-4 mr-1" /> Plantilla Excel
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importFromExcel(e.target.files[0])}
          />
          <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> {importing ? "Importando…" : "Importar Excel"}
          </Button>
          <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
            <DialogTrigger asChild>
              <Button onClick={() => setEdit({})}>
                <Plus className="h-4 w-4 mr-1" /> Nuevo cliente
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{edit?.id ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Nombre *</Label>
                <Input value={edit?.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input value={edit?.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              </div>
              <div>
                <Label>Barrio</Label>
                <Input value={edit?.neighborhood ?? ""} onChange={(e) => setEdit({ ...edit, neighborhood: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Dirección</Label>
                <Input value={edit?.address ?? ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Email (opcional)</Label>
                <Input type="email" value={edit?.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Notas</Label>
                <Textarea rows={2} value={edit?.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={save}>Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Users className="h-5 w-5 text-primary" /></div>
          <div><div className="text-xs text-muted-foreground">Clientes</div><div className="font-display text-2xl">{stats.total}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-amber-100 dark:bg-amber-900/30 p-2"><Star className="h-5 w-5 text-amber-500" /></div>
          <div><div className="text-xs text-muted-foreground">Puntos acumulados</div><div className="font-display text-2xl">{stats.points}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="rounded-lg bg-success/10 p-2"><TrendingUp className="h-5 w-5 text-success" /></div>
          <div><div className="text-xs text-muted-foreground">Ventas a clientes</div><div className="font-display text-2xl">{formatMoney(stats.spent)}</div></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <CardTitle className="flex-1">Listado</CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nombre, teléfono o barrio…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead className="text-right">Visitas</TableHead>
                <TableHead className="text-right">Gastado</TableHead>
                <TableHead className="text-right">Puntos</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.name}</div>
                    {c.email && <div className="text-xs text-muted-foreground">{c.email}</div>}
                  </TableCell>
                  <TableCell>
                    {c.phone && <div className="flex items-center gap-1 text-sm"><Phone className="h-3 w-3" />{c.phone}</div>}
                  </TableCell>
                  <TableCell>
                    {(c.address || c.neighborhood) && (
                      <div className="text-sm flex items-start gap-1">
                        <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                        <div>
                          {c.address}
                          {c.neighborhood && <div className="text-xs text-muted-foreground">{c.neighborhood}</div>}
                        </div>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{c.visits}</TableCell>
                  <TableCell className="text-right">{formatMoney(c.total_spent)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="gap-1">
                      <Star className="h-3 w-3 text-amber-500 fill-amber-500" /> {c.points}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline" onClick={() => { setAdjust(c); setAdjustPts(0); }}>
                      Puntos
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">Sin clientes registrados</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Fidelización: cada venta asociada a un cliente suma <b>1 punto por cada $1.000</b> gastados, además de actualizar visitas y total gastado automáticamente.
      </p>

      <Dialog open={!!adjust} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajustar puntos · {adjust?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Puntos actuales: <b className="text-foreground">{adjust?.points ?? 0}</b></div>
            <div>
              <Label>Sumar / restar puntos</Label>
              <Input type="number" value={adjustPts} onChange={(e) => setAdjustPts(Number(e.target.value))} placeholder="Ej: 10 para sumar, -5 para restar" />
            </div>
            <div className="text-sm">Resultado: <b>{Math.max(0, (adjust?.points ?? 0) + adjustPts)}</b> puntos</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjust(null)}>Cancelar</Button>
            <Button onClick={saveAdjust} disabled={adjustPts === 0}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
