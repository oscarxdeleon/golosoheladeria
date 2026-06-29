import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Plus, Pencil, Trash2, Users, CheckCircle2, XCircle, Clock, MapPin, Monitor, Copy, Camera, ScanFace, Link2,
} from "lucide-react";
import { toast } from "sonner";
import { CameraCapture } from "@/components/attendance/camera-capture";
import { loadFaceModels, getFaceDescriptor, descriptorToArray } from "@/lib/face-api-loader";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/asistencia")({
  head: () => ({ meta: [{ title: "Control de Asistencia · Goloso POS" }] }),
  component: AsistenciaPage,
});

type Employee = {
  id: string;
  full_name: string;
  document_id: string | null;
  job_position: string | null;
  email: string | null;
  phone: string | null;
  branch_id: string | null;
  photo_url: string | null;
  face_descriptor: number[] | null;
  active: boolean;
};

type Terminal = {
  id: string;
  name: string;
  slug: string;
  branch_id: string | null;
  authorized_lat: number | null;
  authorized_lng: number | null;
  authorized_radius_m: number | null;
  address: string | null;
  active: boolean;
};

type Record = {
  id: string;
  employee_id: string;
  terminal_id: string | null;
  record_type: string;
  recorded_at: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  photo_url: string | null;
  face_match_score: number | null;
};

const recordTypeLabel: Record_ = {
  entrada: "Entrada",
  salida: "Salida",
  pausa_inicio: "Inicio pausa",
  pausa_fin: "Fin pausa",
};
type Record_ = Record<string, string>;

function AsistenciaPage() {
  return (
    <div className="container space-y-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-semibold">Control de Asistencia</h1>
          <p className="text-sm text-muted-foreground">Marcación de empleados con reconocimiento facial, GPS y reportes.</p>
        </div>
      </div>
      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="empleados">Empleados</TabsTrigger>
          <TabsTrigger value="terminales">Terminales</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard"><DashboardTab /></TabsContent>
        <TabsContent value="empleados"><EmployeesTab /></TabsContent>
        <TabsContent value="terminales"><TerminalsTab /></TabsContent>
        <TabsContent value="historial"><HistoryTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ DASHBOARD ============================ */

function DashboardTab() {
  const { data: employees = [] } = useQuery({
    queryKey: ["att-employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance_employees").select("*").eq("active", true);
      if (error) throw error;
      return data as Employee[];
    },
  });
  const today = new Date(); today.setHours(0,0,0,0);
  const { data: records = [] } = useQuery({
    queryKey: ["att-records-today"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records").select("*")
        .gte("recorded_at", today.toISOString())
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return data as Record[];
    },
    refetchInterval: 15000,
  });

  // current state per employee
  const stateMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of records) if (!m.has(r.employee_id)) m.set(r.employee_id, r.record_type);
    return m;
  }, [records]);

  const presentes = employees.filter(e => ["entrada","pausa_fin"].includes(stateMap.get(e.id) || "")).length;
  const ausentes = employees.length - employees.filter(e => stateMap.has(e.id)).length;
  const entradas = records.filter(r => r.record_type === "entrada").length;
  const salidas = records.filter(r => r.record_type === "salida").length;

  // Worked minutes today by pairing entradas/salidas per employee
  const horasTrabajadas = useMemo(() => {
    let totalMs = 0;
    const byEmp = new Map<string, Record[]>();
    for (const r of [...records].reverse()) {
      if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
      byEmp.get(r.employee_id)!.push(r);
    }
    for (const list of byEmp.values()) {
      let openTime: number | null = null;
      for (const r of list) {
        const t = new Date(r.recorded_at).getTime();
        if (r.record_type === "entrada" || r.record_type === "pausa_fin") openTime = openTime ?? t;
        else if (r.record_type === "salida" || r.record_type === "pausa_inicio") {
          if (openTime) { totalMs += t - openTime; openTime = null; }
        }
      }
    }
    return (totalMs / 3600000).toFixed(1);
  }, [records]);

  return (
    <div className="space-y-6 pt-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi title="Presentes" value={presentes} icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />} />
        <Kpi title="Ausentes" value={ausentes} icon={<XCircle className="h-5 w-5 text-rose-500" />} />
        <Kpi title="Entradas hoy" value={entradas} icon={<Clock className="h-5 w-5 text-primary" />} />
        <Kpi title="Salidas hoy" value={salidas} icon={<Clock className="h-5 w-5 text-amber-500" />} />
        <Kpi title="Horas trabajadas" value={`${horasTrabajadas} h`} icon={<Users className="h-5 w-5 text-primary" />} />
      </div>

      <Card>
        <CardHeader><CardTitle>Estado actual del personal</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {employees.map(e => {
              const st = stateMap.get(e.id);
              const present = st === "entrada" || st === "pausa_fin";
              const onPause = st === "pausa_inicio";
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="h-12 w-12 overflow-hidden rounded-full bg-muted">
                    {e.photo_url && <img src={e.photo_url} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{e.full_name}</div>
                    <div className="truncate text-xs text-muted-foreground">{e.job_position || "—"}</div>
                  </div>
                  <Badge variant={present ? "default" : onPause ? "secondary" : "outline"}>
                    {present ? "Presente" : onPause ? "En pausa" : st === "salida" ? "Salió" : "Ausente"}
                  </Badge>
                </div>
              );
            })}
            {employees.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay empleados registrados.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ title, value, icon }: { title: string; value: any; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}

/* ============================ EMPLEADOS ============================ */

function EmployeesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name")).data ?? [],
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["att-employees-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance_employees").select("*").order("full_name");
      if (error) throw error;
      return data as Employee[];
    },
  });

  async function remove(id: string) {
    if (!confirm("¿Eliminar empleado?")) return;
    const { error } = await supabase.from("attendance_employees").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Empleado eliminado");
    qc.invalidateQueries({ queryKey: ["att-employees-all"] });
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-end">
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditing(null)}><Plus className="mr-2 h-4 w-4" /> Nuevo empleado</Button>
          </DialogTrigger>
          <EmployeeDialog
            employee={editing}
            branches={branches as any}
            onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["att-employees-all"] }); }}
          />
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Sede</TableHead>
                <TableHead>Rostro</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map(e => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="h-10 w-10 overflow-hidden rounded-full bg-muted">
                      {e.photo_url && <img src={e.photo_url} alt="" className="h-full w-full object-cover" />}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{e.full_name}</TableCell>
                  <TableCell>{e.job_position || "—"}</TableCell>
                  <TableCell>{(branches as any[]).find(b => b.id === e.branch_id)?.name || "—"}</TableCell>
                  <TableCell>{e.face_descriptor ? <Badge>Registrado</Badge> : <Badge variant="outline">Sin registrar</Badge>}</TableCell>
                  <TableCell>{e.active ? <Badge>Activo</Badge> : <Badge variant="secondary">Inactivo</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {employees.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Sin empleados registrados</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function EmployeeDialog({ employee, branches, onSaved }: {
  employee: Employee | null;
  branches: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: employee?.full_name ?? "",
    document_id: employee?.document_id ?? "",
    job_position: employee?.job_position ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    branch_id: employee?.branch_id ?? "",
    active: employee?.active ?? true,
  });
  const [showCapture, setShowCapture] = useState(false);
  const [descriptor, setDescriptor] = useState<number[] | null>(employee?.face_descriptor ?? null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(employee?.photo_url ?? null);
  const [busy, setBusy] = useState(false);

  async function handleCapture(blob: Blob, _dataUrl: string, video: HTMLVideoElement) {
    setBusy(true);
    try {
      await loadFaceModels();
      const desc = await getFaceDescriptor(video);
      if (!desc) { toast.error("No se detectó un rostro. Acércate a la cámara."); return; }
      // upload to storage
      const path = `employees/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("attendance").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("attendance").createSignedUrl(path, 60 * 60 * 24 * 365);
      setDescriptor(descriptorToArray(desc));
      setPhotoUrl(signed?.signedUrl ?? null);
      setShowCapture(false);
      toast.success("Rostro registrado correctamente");
    } catch (e: any) {
      toast.error(e.message || "Error al capturar rostro");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!form.full_name.trim()) { toast.error("Nombre requerido"); return; }
    setBusy(true);
    const payload = {
      ...form,
      branch_id: form.branch_id || null,
      face_descriptor: descriptor as any,
      photo_url: photoUrl,
    };
    const { error } = employee
      ? await supabase.from("attendance_employees").update(payload).eq("id", employee.id)
      : await supabase.from("attendance_employees").insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Empleado guardado");
    onSaved();
  }

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>{employee ? "Editar empleado" : "Nuevo empleado"}</DialogTitle></DialogHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div><Label>Nombre completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label>Documento</Label><Input value={form.document_id} onChange={(e) => setForm({ ...form, document_id: e.target.value })} /></div>
          <div><Label>Cargo</Label><Input value={form.job_position} onChange={(e) => setForm({ ...form, job_position: e.target.value })} /></div>
          <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div>
            <Label>Sede</Label>
            <Select value={form.branch_id || "none"} onValueChange={(v) => setForm({ ...form, branch_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asignar</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /><Label>Activo</Label></div>
        </div>
        <div className="space-y-3">
          <Label>Reconocimiento facial</Label>
          <div className="rounded-lg border p-3">
            {photoUrl && !showCapture && (
              <div className="mb-3 flex items-center gap-3">
                <img src={photoUrl} className="h-16 w-16 rounded-full object-cover" />
                <div className="text-sm">
                  <p className="font-medium">Rostro registrado</p>
                  <p className="text-xs text-muted-foreground">{descriptor ? `${descriptor.length} dimensiones` : ""}</p>
                </div>
              </div>
            )}
            {showCapture ? (
              <CameraCapture onCapture={handleCapture} buttonLabel={busy ? "Procesando…" : "Capturar rostro"} />
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setShowCapture(true)} disabled={busy}>
                <ScanFace className="mr-2 h-4 w-4" /> {photoUrl ? "Volver a capturar" : "Capturar rostro"}
              </Button>
            )}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={busy}>Guardar</Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ============================ TERMINALES ============================ */

function TerminalsTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Terminal | null>(null);
  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name")).data ?? [],
  });
  const { data: terminals = [] } = useQuery({
    queryKey: ["att-terminals"],
    queryFn: async () => (await supabase.from("attendance_terminals").select("*").order("name")).data as Terminal[],
  });

  function terminalUrl(slug: string) {
    return `${window.location.origin}/asistencia/terminal/${slug}`;
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar terminal?")) return;
    const { error } = await supabase.from("attendance_terminals").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["att-terminals"] });
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-end">
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditing(null)}><Plus className="mr-2 h-4 w-4" /> Nueva terminal</Button>
          </DialogTrigger>
          <TerminalDialog terminal={editing} branches={branches as any} onSaved={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["att-terminals"] }); }} />
        </Dialog>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {terminals.map(t => (
          <Card key={t.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Monitor className="h-4 w-4" /> {t.name}</CardTitle>
              <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Activa" : "Inactiva"}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {t.address || "Sin dirección"}</p>
              <div className="rounded-md bg-muted p-2 font-mono text-xs break-all">{terminalUrl(t.slug)}</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(terminalUrl(t.slug)); toast.success("Link copiado"); }}>
                  <Copy className="mr-1 h-3 w-3" /> Copiar link
                </Button>
                <a href={terminalUrl(t.slug)} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline"><Link2 className="mr-1 h-3 w-3" /> Abrir terminal</Button>
                </a>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }}><Pencil className="h-3 w-3" /></Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {terminals.length === 0 && <p className="text-sm text-muted-foreground">Aún no has creado terminales.</p>}
      </div>
    </div>
  );
}

function TerminalDialog({ terminal, branches, onSaved }: { terminal: Terminal | null; branches: { id: string; name: string }[]; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: terminal?.name ?? "",
    slug: terminal?.slug ?? "",
    branch_id: terminal?.branch_id ?? "",
    address: terminal?.address ?? "",
    authorized_lat: terminal?.authorized_lat?.toString() ?? "",
    authorized_lng: terminal?.authorized_lng?.toString() ?? "",
    authorized_radius_m: terminal?.authorized_radius_m?.toString() ?? "200",
    active: terminal?.active ?? true,
  });
  const [busy, setBusy] = useState(false);

  function slugify(s: string) { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

  async function save() {
    if (!form.name.trim()) { toast.error("Nombre requerido"); return; }
    setBusy(true);
    const payload: any = {
      name: form.name.trim(),
      slug: (form.slug || slugify(form.name)) + (terminal ? "" : "-" + Math.random().toString(36).slice(2, 6)),
      branch_id: form.branch_id || null,
      address: form.address || null,
      authorized_lat: form.authorized_lat ? Number(form.authorized_lat) : null,
      authorized_lng: form.authorized_lng ? Number(form.authorized_lng) : null,
      authorized_radius_m: form.authorized_radius_m ? Number(form.authorized_radius_m) : null,
      active: form.active,
    };
    if (terminal) payload.slug = terminal.slug; // don't change slug on edit
    const { error } = terminal
      ? await supabase.from("attendance_terminals").update(payload).eq("id", terminal.id)
      : await supabase.from("attendance_terminals").insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Terminal guardada");
    onSaved();
  }

  async function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setForm(f => ({ ...f, authorized_lat: pos.coords.latitude.toString(), authorized_lng: pos.coords.longitude.toString() }));
      toast.success("Ubicación obtenida");
    }, () => toast.error("No se pudo obtener tu ubicación"));
  }

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{terminal ? "Editar terminal" : "Nueva terminal"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Nombre</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Terminal tienda principal" /></div>
        <div>
          <Label>Sede</Label>
          <Select value={form.branch_id || "none"} onValueChange={(v) => setForm({ ...form, branch_id: v === "none" ? "" : v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Todas</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Dirección</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label>Latitud</Label><Input value={form.authorized_lat} onChange={(e) => setForm({ ...form, authorized_lat: e.target.value })} /></div>
          <div><Label>Longitud</Label><Input value={form.authorized_lng} onChange={(e) => setForm({ ...form, authorized_lng: e.target.value })} /></div>
          <div><Label>Radio (m)</Label><Input value={form.authorized_radius_m} onChange={(e) => setForm({ ...form, authorized_radius_m: e.target.value })} /></div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={useMyLocation}><MapPin className="mr-2 h-3 w-3" /> Usar mi ubicación actual</Button>
        <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /><Label>Activa</Label></div>
      </div>
      <DialogFooter><Button onClick={save} disabled={busy}>Guardar</Button></DialogFooter>
    </DialogContent>
  );
}

/* ============================ HISTORIAL ============================ */

function HistoryTab() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0,10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0,10));
  const [empFilter, setEmpFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: employees = [] } = useQuery({
    queryKey: ["att-employees-list"],
    queryFn: async () => (await supabase.from("attendance_employees").select("id,full_name").order("full_name")).data ?? [],
  });

  const { data: records = [] } = useQuery({
    queryKey: ["att-history", from, to, empFilter, typeFilter],
    queryFn: async () => {
      let q = supabase.from("attendance_records").select("*, attendance_employees(full_name), attendance_terminals(name)")
        .gte("recorded_at", `${from}T00:00:00`)
        .lte("recorded_at", `${to}T23:59:59`)
        .order("recorded_at", { ascending: false });
      if (empFilter !== "all") q = q.eq("employee_id", empFilter);
      if (typeFilter !== "all") q = q.eq("record_type", typeFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
  });

  function exportCsv() {
    const headers = ["Fecha", "Hora", "Empleado", "Tipo", "Terminal", "Ubicación", "Dirección"];
    const rows = records.map((r: any) => [
      format(new Date(r.recorded_at), "yyyy-MM-dd"),
      format(new Date(r.recorded_at), "HH:mm:ss"),
      r.attendance_employees?.full_name ?? "",
      recordTypeLabel[r.record_type] ?? r.record_type,
      r.attendance_terminals?.name ?? "",
      r.lat && r.lng ? `${r.lat},${r.lng}` : "",
      r.address ?? "",
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `asistencia_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <div><Label>Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <Label>Empleado</Label>
            <Select value={empFilter} onValueChange={setEmpFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(employees as any[]).map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="entrada">Entrada</SelectItem>
                <SelectItem value="salida">Salida</SelectItem>
                <SelectItem value="pausa_inicio">Inicio pausa</SelectItem>
                <SelectItem value="pausa_fin">Fin pausa</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end"><Button onClick={exportCsv} className="w-full">Exportar CSV</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha / Hora</TableHead>
                <TableHead>Empleado</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Terminal</TableHead>
                <TableHead>Ubicación</TableHead>
                <TableHead>Foto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{format(new Date(r.recorded_at), "dd MMM yyyy HH:mm", { locale: es })}</TableCell>
                  <TableCell>{r.attendance_employees?.full_name ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{recordTypeLabel[r.record_type] ?? r.record_type}</Badge></TableCell>
                  <TableCell>{r.attendance_terminals?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.lat ? `${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}` : "—"}</TableCell>
                  <TableCell>{r.photo_url ? <a href={r.photo_url} target="_blank" rel="noreferrer"><img src={r.photo_url} className="h-8 w-8 rounded object-cover" /></a> : "—"}</TableCell>
                </TableRow>
              ))}
              {records.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Sin registros</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
