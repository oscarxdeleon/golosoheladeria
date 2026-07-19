import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Users, CalendarDays, Clock, DollarSign, Download, Printer, Receipt, History, Wallet, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { format } from "date-fns";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/empleados")({
  head: () => ({ meta: [{ title: "Empleados y Nómina · Goloso POS" }] }),
  component: EmpleadosPage,
});

const DAYS = [
  { k: "lun", label: "Lunes" },
  { k: "mar", label: "Martes" },
  { k: "mie", label: "Miércoles" },
  { k: "jue", label: "Jueves" },
  { k: "vie", label: "Viernes" },
  { k: "sab", label: "Sábado" },
  { k: "dom", label: "Domingo" },
  { k: "festivo", label: "Festivos" },
] as const;

type DayKey = typeof DAYS[number]["k"];
type DayCfg = { works: boolean; in: string; out: string };
type WeeklySchedule = Record<DayKey, DayCfg>;

const emptySchedule = (): WeeklySchedule =>
  DAYS.reduce((acc, d) => {
    acc[d.k] = { works: false, in: "14:00", out: "22:00" };
    return acc;
  }, {} as WeeklySchedule);

type Employee = {
  id: string;
  full_name: string;
  document_id: string | null;
  phone: string | null;
  job_position: string | null;
  branch_id: string | null;
  active: boolean;
  weekly_schedule: WeeklySchedule | null;
  pay_mode: "weekly_fixed" | "per_shift";
  weekly_salary: number | null;
  shift_rates: { weekday?: number; weekend_holiday?: number; per_day?: Partial<Record<DayKey, number>> } | null;
  hours_per_shift: number;
  grace_minutes: number;
};

function normalizeSchedule(s: any): WeeklySchedule {
  const base = emptySchedule();
  if (s && typeof s === "object") {
    for (const d of DAYS) {
      const v = s[d.k];
      if (v && typeof v === "object") {
        base[d.k] = {
          works: !!v.works,
          in: typeof v.in === "string" ? v.in : "14:00",
          out: typeof v.out === "string" ? v.out : "22:00",
        };
      }
    }
  }
  return base;
}

function EmpleadosPage() {
  return (
    <div className="container space-y-6 py-6">
      <div>
        <h1 className="text-3xl font-display font-semibold">Empleados y Nómina</h1>
        <p className="text-sm text-muted-foreground">
          Registro de personal, horarios detallados por día, festivos, cálculo automático de retrasos y descuentos.
        </p>
      </div>

      <Tabs defaultValue="empleados" className="w-full">
        <TabsList className="grid w-full grid-cols-6 max-w-4xl">
          <TabsTrigger value="empleados"><Users className="mr-2 h-4 w-4" />Empleados</TabsTrigger>
          <TabsTrigger value="horarios"><Clock className="mr-2 h-4 w-4" />Horarios</TabsTrigger>
          <TabsTrigger value="festivos"><CalendarDays className="mr-2 h-4 w-4" />Festivos</TabsTrigger>
          <TabsTrigger value="nomina"><DollarSign className="mr-2 h-4 w-4" />Nómina</TabsTrigger>
          <TabsTrigger value="descuentos"><Wallet className="mr-2 h-4 w-4" />Descuentos</TabsTrigger>
          <TabsTrigger value="historial"><History className="mr-2 h-4 w-4" />Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="empleados"><EmpleadosTab /></TabsContent>
        <TabsContent value="horarios"><HorariosTab /></TabsContent>
        <TabsContent value="festivos"><FestivosTab /></TabsContent>
        <TabsContent value="nomina"><NominaTab /></TabsContent>
        <TabsContent value="descuentos"><DescuentosTab /></TabsContent>
        <TabsContent value="historial"><HistorialTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Empleados ---------------- */

function useBranches() {
  return useQuery({
    queryKey: ["branches-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useEmployees() {
  return useQuery({
    queryKey: ["empleados-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_employees")
        .select("id,full_name,document_id,phone,job_position,branch_id,active,weekly_schedule,pay_mode,weekly_salary,shift_rates,hours_per_shift,grace_minutes")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as unknown as Employee[];
    },
  });
}

function EmpleadosTab() {
  const qc = useQueryClient();
  const { data: employees = [], isLoading } = useEmployees();
  const { data: branches = [] } = useBranches();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar empleado?")) return;
    const { error } = await supabase.from("attendance_employees").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Empleado eliminado");
    qc.invalidateQueries({ queryKey: ["empleados-full"] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Empleados</CardTitle>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />Nuevo empleado
            </Button>
          </DialogTrigger>
          <EmployeeDialog
            open={open}
            employee={editing}
            branches={branches}
            onClose={() => { setOpen(false); setEditing(null); }}
            onSaved={() => qc.invalidateQueries({ queryKey: ["empleados-full"] })}
          />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Cargando…</p>
        ) : employees.length === 0 ? (
          <p className="text-muted-foreground text-sm">Sin empleados registrados.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Cédula</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Sede</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.full_name}</TableCell>
                  <TableCell>{e.document_id ?? "—"}</TableCell>
                  <TableCell>{e.phone ?? "—"}</TableCell>
                  <TableCell>{e.job_position ?? "—"}</TableCell>
                  <TableCell>{branchName(e.branch_id)}</TableCell>
                  <TableCell>
                    {e.pay_mode === "weekly_fixed"
                      ? <Badge variant="secondary">Semanal {formatMoney(e.weekly_salary ?? 0)}</Badge>
                      : <Badge variant="secondary">Por turno</Badge>}
                  </TableCell>
                  <TableCell>
                    {e.active
                      ? <Badge className="bg-emerald-500 hover:bg-emerald-500">Activo</Badge>
                      : <Badge variant="outline">Inactivo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(e); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* -------- Employee dialog -------- */

function EmployeeDialog({
  open, employee, branches, onClose, onSaved,
}: {
  open: boolean;
  employee: Employee | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => makeInitial(employee));
  const [saving, setSaving] = useState(false);

  // Reset when opening with a different employee
  useMemo(() => setForm(makeInitial(employee)), [employee?.id, open]);

  function makeInitial(e: Employee | null) {
    return {
      full_name: e?.full_name ?? "",
      document_id: e?.document_id ?? "",
      phone: e?.phone ?? "",
      job_position: e?.job_position ?? "",
      branch_id: e?.branch_id ?? "",
      active: e?.active ?? true,
      weekly_schedule: normalizeSchedule(e?.weekly_schedule),
      pay_mode: (e?.pay_mode ?? "weekly_fixed") as Employee["pay_mode"],
      weekly_salary: e?.weekly_salary ?? 0,
      shift_weekday: e?.shift_rates?.weekday ?? 0,
      shift_weekend: e?.shift_rates?.weekend_holiday ?? 0,
      hours_per_shift: e?.hours_per_shift ?? 8,
      grace_minutes: e?.grace_minutes ?? 0,
    };
  }

  const setDay = (k: DayKey, patch: Partial<DayCfg>) =>
    setForm((f) => ({ ...f, weekly_schedule: { ...f.weekly_schedule, [k]: { ...f.weekly_schedule[k], ...patch } } }));

  const save = async () => {
    if (!form.full_name.trim()) return toast.error("Nombre requerido");
    setSaving(true);
    const payload = {
      full_name: form.full_name.trim(),
      document_id: form.document_id.trim() || null,
      phone: form.phone.trim() || null,
      job_position: form.job_position.trim() || null,
      branch_id: form.branch_id || null,
      active: form.active,
      weekly_schedule: form.weekly_schedule,
      pay_mode: form.pay_mode,
      weekly_salary: form.pay_mode === "weekly_fixed" ? Number(form.weekly_salary) || 0 : null,
      shift_rates: form.pay_mode === "per_shift"
        ? { weekday: Number(form.shift_weekday) || 0, weekend_holiday: Number(form.shift_weekend) || 0 }
        : null,
      hours_per_shift: Number(form.hours_per_shift) || 8,
      grace_minutes: Number(form.grace_minutes) || 0,
    };
    const { error } = employee
      ? await supabase.from("attendance_employees").update(payload).eq("id", employee.id)
      : await supabase.from("attendance_employees").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(employee ? "Empleado actualizado" : "Empleado creado");
    onSaved(); onClose();
  };

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{employee ? "Editar empleado" : "Nuevo empleado"}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Nombre completo *</Label>
          <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div>
          <Label>Cédula</Label>
          <Input value={form.document_id} onChange={(e) => setForm({ ...form, document_id: e.target.value })} />
        </div>
        <div>
          <Label>Teléfono</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div>
          <Label>Cargo</Label>
          <Input value={form.job_position} onChange={(e) => setForm({ ...form, job_position: e.target.value })} />
        </div>
        <div>
          <Label>Sede</Label>
          <Select value={form.branch_id || undefined} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
            <SelectTrigger><SelectValue placeholder="Selecciona sede" /></SelectTrigger>
            <SelectContent>
              {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label>Estado</Label>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <span className="text-sm">{form.active ? "Activo" : "Inactivo"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <h3 className="font-semibold">Horario por día</h3>
        <p className="text-xs text-muted-foreground">
          Marca los días que trabaja. Solo la hora de <b>entrada</b> se usa para calcular retrasos; la salida es informativa.
        </p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead>Trabaja</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Salida</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DAYS.map((d) => {
                const cfg = form.weekly_schedule[d.k];
                return (
                  <TableRow key={d.k}>
                    <TableCell className="font-medium">{d.label}</TableCell>
                    <TableCell>
                      <Switch checked={cfg.works} onCheckedChange={(v) => setDay(d.k, { works: v })} />
                    </TableCell>
                    <TableCell>
                      <Input type="time" value={cfg.in} disabled={!cfg.works} onChange={(e) => setDay(d.k, { in: e.target.value })} className="w-32" />
                    </TableCell>
                    <TableCell>
                      <Input type="time" value={cfg.out} disabled={!cfg.works} onChange={(e) => setDay(d.k, { out: e.target.value })} className="w-32" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <h3 className="font-semibold">Configuración de pago</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Modalidad</Label>
            <Select value={form.pay_mode} onValueChange={(v: any) => setForm({ ...form, pay_mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly_fixed">Salario semanal fijo</SelectItem>
                <SelectItem value="per_shift">Pago por turno</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Horas por turno</Label>
            <Input type="number" value={form.hours_per_shift} onChange={(e) => setForm({ ...form, hours_per_shift: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Tolerancia (minutos)</Label>
            <Input type="number" value={form.grace_minutes} onChange={(e) => setForm({ ...form, grace_minutes: Number(e.target.value) })} />
          </div>

          {form.pay_mode === "weekly_fixed" && (
            <div>
              <Label>Salario semanal (COP)</Label>
              <Input type="number" value={form.weekly_salary} onChange={(e) => setForm({ ...form, weekly_salary: Number(e.target.value) })} />
            </div>
          )}

          {form.pay_mode === "per_shift" && (
            <>
              <div>
                <Label>Tarifa entre semana (COP)</Label>
                <Input type="number" value={form.shift_weekday} onChange={(e) => setForm({ ...form, shift_weekday: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Tarifa sábado/domingo/festivo (COP)</Label>
                <Input type="number" value={form.shift_weekend} onChange={(e) => setForm({ ...form, shift_weekend: Number(e.target.value) })} />
              </div>
            </>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ---------------- Horarios ---------------- */

function HorariosTab() {
  const { data: employees = [] } = useEmployees();
  const { data: branches = [] } = useBranches();
  const [branchId, setBranchId] = useState<string>("all");

  const list = employees.filter((e) => branchId === "all" || e.branch_id === branchId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Horarios semanales</CardTitle>
        <Select value={branchId} onValueChange={setBranchId}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sedes</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empleado</TableHead>
              {DAYS.map((d) => <TableHead key={d.k} className="text-center">{d.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((e) => {
              const s = normalizeSchedule(e.weekly_schedule);
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium whitespace-nowrap">{e.full_name}</TableCell>
                  {DAYS.map((d) => {
                    const c = s[d.k];
                    return (
                      <TableCell key={d.k} className="text-center text-xs">
                        {c.works ? <span>{c.in} - {c.out}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            {list.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Sin empleados</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ---------------- Festivos ---------------- */

type Holiday = { id: string; date: string; name: string; branch_id: string | null };

function FestivosTab() {
  const qc = useQueryClient();
  const { data: branches = [] } = useBranches();
  const { data = [], isLoading } = useQuery({
    queryKey: ["company-holidays"],
    queryFn: async () => {
      const { data, error } = await supabase.from("company_holidays").select("*").order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Holiday[];
    },
  });
  const [date, setDate] = useState(""); const [name, setName] = useState(""); const [branchId, setBranchId] = useState<string>("all");

  const add = async () => {
    if (!date || !name.trim()) return toast.error("Fecha y nombre requeridos");
    const { error } = await supabase.from("company_holidays").insert({
      date, name: name.trim(), branch_id: branchId === "all" ? null : branchId,
    });
    if (error) return toast.error(error.message);
    setDate(""); setName(""); setBranchId("all");
    toast.success("Festivo agregado");
    qc.invalidateQueries({ queryKey: ["company-holidays"] });
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar festivo?")) return;
    const { error } = await supabase.from("company_holidays").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["company-holidays"] });
  };

  return (
    <Card>
      <CardHeader><CardTitle>Días festivos</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[160px_1fr_240px_auto] items-end">
          <div><Label>Fecha</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>Nombre</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Día de la Independencia" /></div>
          <div>
            <Label>Sede</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sedes</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={add}><Plus className="mr-2 h-4 w-4" />Agregar</Button>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead><TableHead>Nombre</TableHead><TableHead>Sede</TableHead><TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{format(new Date(h.date + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                  <TableCell>{h.name}</TableCell>
                  <TableCell>{h.branch_id ? branches.find((b) => b.id === h.branch_id)?.name : "Todas"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => remove(h.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Sin festivos</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Nómina ---------------- */

type SummaryRow = {
  employee_id: string;
  full_name: string;
  branch_id: string | null;
  pay_mode: string;
  days_worked: number;
  days_scheduled: number;
  late_minutes: number;
  deductions: number;
  gross_pay: number;
  net_pay: number;
};

type LateRow = {
  id: string;
  employee_id: string;
  date: string;
  scheduled_in: string | null;
  actual_in: string | null;
  late_minutes: number;
  deduction_amount: number;
  is_holiday: boolean;
};

function NominaTab() {
  const qc = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const { data: branches = [] } = useBranches();
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const [from, setFrom] = useState(format(monday, "yyyy-MM-dd"));
  const [to, setTo] = useState(format(sunday, "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState<string>("all");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<{ id: string; name: string } | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const { data: rows = [], isFetching, refetch } = useQuery({
    queryKey: ["payroll-summary", from, to, branchId, employeeId],
    queryFn: async () => {
      const args: Record<string, unknown> = { _from: from, _to: to };
      if (employeeId !== "all") args._employee_id = employeeId;
      if (branchId !== "all") args._branch_id = branchId;
      const { data, error } = await supabase.rpc("payroll_period_summary", args as never);
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
  });

  const { data: lateDetail = [] } = useQuery({
    queryKey: ["late-detail", expanded, from, to],
    enabled: !!expanded,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_late_records")
        .select("id,employee_id,date,scheduled_in,actual_in,late_minutes,deduction_amount,is_holiday")
        .eq("employee_id", expanded!)
        .gte("date", from).lte("date", to)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LateRow[];
    },
  });

  const totals = useMemo(() => rows.reduce(
    (acc, r) => {
      acc.deductions += Number(r.deductions);
      acc.gross += Number(r.gross_pay);
      acc.net += Number(r.net_pay);
      acc.late += Number(r.late_minutes);
      return acc;
    }, { deductions: 0, gross: 0, net: 0, late: 0 },
  ), [rows]);

  const exportCsv = () => {
    const header = ["Empleado", "Sede", "Modalidad", "Días programados", "Días trabajados", "Minutos retraso", "Descuentos", "Pago bruto", "Pago neto"];
    const lines = rows.map((r) => [
      r.full_name,
      branches.find((b) => b.id === r.branch_id)?.name ?? "",
      r.pay_mode, r.days_scheduled, r.days_worked, r.late_minutes,
      r.deductions, r.gross_pay, r.net_pay,
    ].join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `nomina_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Nómina, liquidación y pagos</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}>
          <Settings2 className="mr-2 h-4 w-4" />Reglas de tardanza
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5 items-end">
          <div><Label>Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <Label>Sede</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Empleado</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => refetch()} className="flex-1">Recalcular</Button>
            <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Retraso total (min)" value={String(totals.late)} />
          <StatCard label="Descuentos" value={formatMoney(totals.deductions)} />
          <StatCard label="Pago bruto" value={formatMoney(totals.gross)} />
          <StatCard label="Pago neto" value={formatMoney(totals.net)} className="border-primary" />
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empleado</TableHead>
                <TableHead>Sede</TableHead>
                <TableHead>Modalidad</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead className="text-right">Retraso (min)</TableHead>
                <TableHead className="text-right">Descuentos</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Neto</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Calculando…</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <>
                  <TableRow key={r.employee_id}>
                    <TableCell className="font-medium">{r.full_name}</TableCell>
                    <TableCell>{branches.find((b) => b.id === r.branch_id)?.name ?? "—"}</TableCell>
                    <TableCell>{r.pay_mode === "weekly_fixed" ? "Semanal" : "Por turno"}</TableCell>
                    <TableCell className="text-right">{r.days_worked}/{r.days_scheduled}</TableCell>
                    <TableCell className="text-right">{r.late_minutes}</TableCell>
                    <TableCell className="text-right text-rose-600">{formatMoney(r.deductions)}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.gross_pay)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(r.net_pay)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === r.employee_id ? null : r.employee_id)}>
                        {expanded === r.employee_id ? "Ocultar" : "Detalle"}
                      </Button>
                      <Button size="sm" onClick={() => setPayFor({ id: r.employee_id, name: r.full_name })}>
                        <Receipt className="mr-1 h-4 w-4" />Liquidar y pagar
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded === r.employee_id && (
                    <TableRow>
                      <TableCell colSpan={9} className="bg-muted/40">
                        {lateDetail.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Sin registros en el período.</p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Programada</TableHead>
                                <TableHead>Real</TableHead>
                                <TableHead className="text-right">Minutos</TableHead>
                                <TableHead className="text-right">Descuento</TableHead>
                                <TableHead>Notas</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {lateDetail.map((d) => (
                                <TableRow key={d.id}>
                                  <TableCell>{format(new Date(d.date + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                                  <TableCell>{d.scheduled_in ?? "—"}</TableCell>
                                  <TableCell>{d.actual_in ? format(new Date(d.actual_in), "HH:mm:ss") : "Ausencia"}</TableCell>
                                  <TableCell className="text-right">{d.late_minutes}</TableCell>
                                  <TableCell className="text-right text-rose-600">{formatMoney(d.deduction_amount)}</TableCell>
                                  <TableCell>{d.is_holiday ? <Badge variant="outline">Festivo</Badge> : null}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {rows.length === 0 && !isFetching && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Sin datos</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {payFor && (
        <PaymentDialog
          employeeId={payFor.id}
          employeeName={payFor.name}
          defaultFrom={from}
          defaultTo={to}
          onClose={() => setPayFor(null)}
          onPaid={() => {
            qc.invalidateQueries({ queryKey: ["payroll-summary"] });
            qc.invalidateQueries({ queryKey: ["payroll-payments"] });
            qc.invalidateQueries({ queryKey: ["manual-deductions"] });
            setPayFor(null);
          }}
        />
      )}

      <LateRulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} branches={branches} />
    </Card>
  );
}

function StatCard({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-lg border bg-card p-4 ${className}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

/* ============================================================
 * Descuentos manuales
 * ============================================================ */

type ManualDeduction = {
  id: string;
  employee_id: string;
  amount: number;
  concept: string;
  notes: string | null;
  deduction_date: string;
  applied_to_payment_id: string | null;
  branch_id: string | null;
  created_at: string;
};

const CONCEPTS = ["Préstamo", "Adelanto", "Uniforme", "Daño de implementos", "Otro"] as const;

function DescuentosTab() {
  const qc = useQueryClient();
  const { data: employees = [] } = useEmployees();
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "applied">("pending");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ManualDeduction | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["manual-deductions", employeeFilter, statusFilter],
    queryFn: async () => {
      let q = supabase.from("payroll_manual_deductions").select("*").order("deduction_date", { ascending: false });
      if (employeeFilter !== "all") q = q.eq("employee_id", employeeFilter);
      if (statusFilter === "pending") q = q.is("applied_to_payment_id", null);
      if (statusFilter === "applied") q = q.not("applied_to_payment_id", "is", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ManualDeduction[];
    },
  });

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "—";

  const remove = async (row: ManualDeduction) => {
    if (row.applied_to_payment_id) return toast.error("Ya aplicado a un pago, no se puede eliminar");
    if (!confirm("¿Eliminar descuento?")) return;
    const { error } = await supabase.from("payroll_manual_deductions").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["manual-deductions"] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Descuentos manuales</CardTitle>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />Agregar descuento
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Empleado</Label>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estado</Label>
            <Select value={statusFilter} onValueChange={(v: "all" | "pending" | "applied") => setStatusFilter(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendientes de aplicar</SelectItem>
                <SelectItem value="applied">Aplicados a un pago</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Empleado</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Sin descuentos</TableCell></TableRow>
              )}
              {data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{format(new Date(r.deduction_date + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                  <TableCell className="font-medium">{empName(r.employee_id)}</TableCell>
                  <TableCell>{r.concept}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate">{r.notes ?? "—"}</TableCell>
                  <TableCell className="text-right text-rose-600 font-medium">{formatMoney(r.amount)}</TableCell>
                  <TableCell>
                    {r.applied_to_payment_id
                      ? <Badge variant="outline">Aplicado</Badge>
                      : <Badge className="bg-amber-500 hover:bg-amber-500">Pendiente</Badge>}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {!r.applied_to_payment_id && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(r); setOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(r)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {open && (
        <DeductionDialog
          employees={employees}
          editing={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["manual-deductions"] })}
        />
      )}
    </Card>
  );
}

function DeductionDialog({
  employees, editing, onClose, onSaved,
}: {
  employees: Employee[];
  editing: ManualDeduction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    employee_id: editing?.employee_id ?? "",
    amount: editing?.amount ?? 0,
    concept: editing?.concept ?? "Préstamo",
    notes: editing?.notes ?? "",
    deduction_date: editing?.deduction_date ?? format(new Date(), "yyyy-MM-dd"),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.employee_id) return toast.error("Selecciona un empleado");
    if (!(Number(form.amount) > 0)) return toast.error("Valor inválido");
    setSaving(true);
    const emp = employees.find((e) => e.id === form.employee_id);
    const payload = {
      employee_id: form.employee_id,
      branch_id: emp?.branch_id ?? null,
      amount: Number(form.amount),
      concept: form.concept,
      notes: form.notes.trim() || null,
      deduction_date: form.deduction_date,
    };
    const { error } = editing
      ? await supabase.from("payroll_manual_deductions").update(payload).eq("id", editing.id)
      : await supabase.from("payroll_manual_deductions").insert({ ...payload, created_by: (await supabase.auth.getUser()).data.user?.id ?? null });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Descuento actualizado" : "Descuento registrado");
    onSaved(); onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar descuento" : "Nuevo descuento"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Empleado *</Label>
            <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecciona empleado" /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Valor *</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Fecha</Label>
              <Input type="date" value={form.deduction_date} onChange={(e) => setForm({ ...form, deduction_date: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Concepto</Label>
            <Select value={form.concept} onValueChange={(v) => setForm({ ...form, concept: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONCEPTS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notas (opcional)</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
 * Pago / Comprobante
 * ============================================================ */

type Liquidation = {
  employee_id: string;
  employee_name: string;
  document_id: string | null;
  job_position: string | null;
  branch_id: string | null;
  period_start: string;
  period_end: string;
  pay_mode: string;
  shifts_count: number;
  late_minutes: number;
  gross_amount: number;
  late_deduction: number;
  manual_deduction: number;
  net_amount: number;
  items: Array<{
    date: string; day_type: string; scheduled: boolean; worked: boolean;
    shift_rate: number; late_minutes: number; late_deduction: number;
  }>;
  manual_items: Array<{
    id: string; amount: number; concept: string; notes: string | null; deduction_date: string;
  }>;
};

function PaymentDialog({
  employeeId, employeeName, defaultFrom, defaultTo, onClose, onPaid,
}: {
  employeeId: string;
  employeeName: string;
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [method, setMethod] = useState<"Caja" | "Nequi" | "Bancolombia" | "Otro">("Caja");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<{ receipt_number: number; liquidation: Liquidation; paid_at: string; method: string; paid_by: string; notes: string; branch_name?: string } | null>(null);

  const { data: liq, isLoading } = useQuery({
    queryKey: ["liquidation", employeeId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payroll_weekly_liquidation", {
        _employee_id: employeeId, _period_start: from, _period_end: to,
      });
      if (error) throw error;
      return data as unknown as Liquidation;
    },
    enabled: !receipt,
  });

  const pay = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc("payroll_register_payment", {
      _employee_id: employeeId, _period_start: from, _period_end: to,
      _payment_method: method, _notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    const result = data as unknown as { receipt_number: number; liquidation: Liquidation };
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    let paidBy = userRes.user?.email ?? "—";
    if (uid) {
      const { data: prof } = await supabase.from("profiles").select("full_name,email").eq("id", uid).maybeSingle();
      paidBy = (prof?.full_name || prof?.email || paidBy) as string;
    }
    let branchName: string | undefined;
    if (result.liquidation.branch_id) {
      const { data: b } = await supabase.from("branches").select("name").eq("id", result.liquidation.branch_id).maybeSingle();
      branchName = b?.name as string | undefined;
    }
    setReceipt({
      receipt_number: result.receipt_number,
      liquidation: result.liquidation,
      paid_at: new Date().toISOString(),
      method,
      paid_by: paidBy,
      notes: notes.trim(),
      branch_name: branchName,
    });
    toast.success(`Pago registrado — Comprobante #${result.receipt_number}`);
  };

  const doPrint = () => window.print();

  const closeAll = () => {
    if (receipt) onPaid(); else onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && closeAll()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {!receipt ? (
          <>
            <DialogHeader>
              <DialogTitle>Liquidar y pagar — {employeeName}</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label>Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>

            {isLoading || !liq ? (
              <p className="text-sm text-muted-foreground py-4">Calculando liquidación…</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Turnos" value={String(liq.shifts_count)} />
                  <StatCard label="Total generado" value={formatMoney(liq.gross_amount)} />
                  <StatCard label="Descuentos" value={formatMoney(Number(liq.late_deduction) + Number(liq.manual_deduction))} />
                  <StatCard label="Neto a pagar" value={formatMoney(liq.net_amount)} className="border-primary" />
                </div>

                <details className="rounded border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Ver detalle día por día</summary>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead><TableHead>Tipo</TableHead><TableHead>Trabajó</TableHead>
                        <TableHead className="text-right">Tarifa</TableHead>
                        <TableHead className="text-right">Retraso</TableHead>
                        <TableHead className="text-right">Descuento</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {liq.items.map((it) => (
                        <TableRow key={it.date}>
                          <TableCell>{format(new Date(it.date + "T00:00:00"), "EEE dd/MM")}</TableCell>
                          <TableCell className="text-xs">{it.day_type === "holiday" ? "Festivo" : it.day_type === "weekend" ? "Fin de semana" : "Semana"}</TableCell>
                          <TableCell>{it.worked ? "Sí" : it.scheduled ? "Ausencia" : "—"}</TableCell>
                          <TableCell className="text-right">{formatMoney(it.shift_rate)}</TableCell>
                          <TableCell className="text-right">{it.late_minutes} min</TableCell>
                          <TableCell className="text-right text-rose-600">{formatMoney(it.late_deduction)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </details>

                {liq.manual_items.length > 0 && (
                  <details className="rounded border p-3" open>
                    <summary className="cursor-pointer text-sm font-medium">Descuentos manuales pendientes ({liq.manual_items.length})</summary>
                    <ul className="mt-2 space-y-1 text-sm">
                      {liq.manual_items.map((m) => (
                        <li key={m.id} className="flex justify-between">
                          <span>{format(new Date(m.deduction_date + "T00:00:00"), "dd/MM")} · {m.concept}{m.notes ? ` — ${m.notes}` : ""}</span>
                          <span className="text-rose-600">{formatMoney(m.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Método de pago *</Label>
                    <Select value={method} onValueChange={(v: "Caja" | "Nequi" | "Bancolombia" | "Otro") => setMethod(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Caja">Caja</SelectItem>
                        <SelectItem value="Nequi">Nequi</SelectItem>
                        <SelectItem value="Bancolombia">Bancolombia</SelectItem>
                        <SelectItem value="Otro">Otro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Notas</Label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={pay} disabled={saving || !liq || liq.net_amount <= 0}>
                {saving ? "Registrando…" : `Confirmar pago (${formatMoney(liq?.net_amount ?? 0)})`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="print:hidden">Comprobante #{receipt.receipt_number}</DialogTitle>
            </DialogHeader>
            <PayrollReceipt {...receipt} />
            <DialogFooter className="print:hidden">
              <Button variant="outline" onClick={closeAll}>Cerrar</Button>
              <Button onClick={doPrint}><Printer className="mr-2 h-4 w-4" />Imprimir</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayrollReceipt({
  receipt_number, liquidation, paid_at, method, paid_by, notes, branch_name,
}: {
  receipt_number: number;
  liquidation: Liquidation;
  paid_at: string;
  method: string;
  paid_by: string;
  notes: string;
  branch_name?: string;
}) {
  return (
    <div className="print-area bg-white text-black mx-auto p-6" style={{ maxWidth: 380, fontFamily: '"Helvetica Neue", Arial, sans-serif' }}>
      <h1 className="text-center font-extrabold text-xl uppercase tracking-wide">HELADERÍA GOLOSO</h1>
      {branch_name && <p className="text-center text-sm">Sede: {branch_name}</p>}
      <div className="my-2 border-t border-dashed border-black" />
      <p className="text-center font-bold uppercase text-sm">Comprobante de Pago #{receipt_number}</p>
      <div className="my-2 border-t border-dashed border-black" />

      <div className="text-sm space-y-1">
        <div><b>Empleado:</b> {liquidation.employee_name}</div>
        {liquidation.document_id && <div><b>Cédula:</b> {liquidation.document_id}</div>}
        {liquidation.job_position && <div><b>Cargo:</b> {liquidation.job_position}</div>}
        <div><b>Concepto:</b> Pago de turnos</div>
        <div><b>Período:</b> {format(new Date(liquidation.period_start + "T00:00:00"), "dd/MM/yyyy")} al {format(new Date(liquidation.period_end + "T00:00:00"), "dd/MM/yyyy")}</div>
        <div><b>Turnos trabajados:</b> {liquidation.shifts_count}</div>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="text-sm space-y-1">
        <div className="flex justify-between"><span>Total generado</span><span>{formatMoney(liquidation.gross_amount)}</span></div>
        <div className="flex justify-between"><span>Descuento por tardanza ({liquidation.late_minutes} min)</span><span className="text-rose-700">-{formatMoney(liquidation.late_deduction)}</span></div>
        <div className="flex justify-between"><span>Descuentos manuales</span><span className="text-rose-700">-{formatMoney(liquidation.manual_deduction)}</span></div>
        {liquidation.manual_items.length > 0 && (
          <ul className="pl-4 text-xs list-disc">
            {liquidation.manual_items.map((m) => (
              <li key={m.id}>{m.concept}: {formatMoney(m.amount)}{m.notes ? ` — ${m.notes}` : ""}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="flex justify-between items-baseline">
        <span className="font-black text-lg">NETO PAGADO:</span>
        <span className="font-black text-2xl">{formatMoney(liquidation.net_amount)}</span>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="text-sm space-y-1">
        <div><b>Método de pago:</b> {method}</div>
        <div><b>Fecha:</b> {format(new Date(paid_at), "dd/MM/yyyy HH:mm")}</div>
        <div><b>Registrado por:</b> {paid_by}</div>
        {notes && <div><b>Notas:</b> {notes}</div>}
      </div>

      <div className="mt-8 text-xs">
        <div className="border-t border-black pt-1 text-center">Firma del empleado</div>
      </div>
    </div>
  );
}

/* ============================================================
 * Reglas de tardanza
 * ============================================================ */

type Bracket = { min: number; max: number | null; deduct_minutes: number };
type LateRule = { id: string; branch_id: string | null; brackets: Bracket[]; active: boolean };

function LateRulesDialog({ open, onClose, branches }: {
  open: boolean; onClose: () => void; branches: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState<string>("global");

  const { data: rule } = useQuery({
    queryKey: ["late-rule", branchId],
    enabled: open,
    queryFn: async () => {
      const q = supabase.from("payroll_late_rules").select("*");
      const { data, error } = branchId === "global"
        ? await q.is("branch_id", null).maybeSingle()
        : await q.eq("branch_id", branchId).maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as unknown as LateRule | null);
    },
  });

  const [brackets, setBrackets] = useState<Bracket[]>([]);
  useMemo(() => {
    setBrackets(rule?.brackets ?? [
      { min: 5, max: 15, deduct_minutes: 30 },
      { min: 30, max: 45, deduct_minutes: 60 },
      { min: 60, max: null, deduct_minutes: 120 },
    ]);
  }, [rule?.id, open, branchId]);

  const save = async () => {
    const payload = {
      branch_id: branchId === "global" ? null : branchId,
      brackets: brackets as unknown as object,
      active: true,
      updated_at: new Date().toISOString(),
    };
    const { error } = rule
      ? await supabase.from("payroll_late_rules").update(payload).eq("id", rule.id)
      : await supabase.from("payroll_late_rules").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Reglas actualizadas");
    qc.invalidateQueries({ queryKey: ["late-rule"] });
    qc.invalidateQueries({ queryKey: ["payroll-summary"] });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Reglas de descuento por tardanza</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Aplica a</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global (todas las sedes)</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Si el retraso cae dentro de un rango, se descuenta el equivalente en <b>minutos de trabajo</b>.
            Deja <b>Máx</b> vacío para "en adelante". Ejemplo por defecto: 5-15 min → 30 min · 30-45 min → 60 min · 60+ min → 120 min.
          </p>
          <div className="space-y-2">
            {brackets.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <div><Label className="text-xs">Mín (min)</Label><Input type="number" value={b.min} onChange={(e) => { const c = [...brackets]; c[i] = { ...c[i], min: Number(e.target.value) }; setBrackets(c); }} /></div>
                <div><Label className="text-xs">Máx (min)</Label><Input type="number" value={b.max ?? ""} placeholder="∞" onChange={(e) => { const c = [...brackets]; c[i] = { ...c[i], max: e.target.value === "" ? null : Number(e.target.value) }; setBrackets(c); }} /></div>
                <div><Label className="text-xs">Descontar (min de trabajo)</Label><Input type="number" value={b.deduct_minutes} onChange={(e) => { const c = [...brackets]; c[i] = { ...c[i], deduct_minutes: Number(e.target.value) }; setBrackets(c); }} /></div>
                <Button variant="ghost" size="icon" onClick={() => setBrackets(brackets.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setBrackets([...brackets, { min: 0, max: null, deduct_minutes: 0 }])}>
              <Plus className="mr-2 h-4 w-4" />Agregar rango
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================
 * Historial / Reportes
 * ============================================================ */

type PaymentRow = {
  id: string; receipt_number: number; employee_id: string; branch_id: string | null;
  period_start: string; period_end: string; shifts_count: number;
  gross_amount: number; late_deduction: number; manual_deduction: number; net_amount: number;
  payment_method: string; paid_by_name: string | null; paid_at: string; notes: string | null;
};

function HistorialTab() {
  const { data: employees = [] } = useEmployees();
  const { data: branches = [] } = useBranches();
  const today = new Date();
  const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);
  const [from, setFrom] = useState(format(monthAgo, "yyyy-MM-dd"));
  const [to, setTo] = useState(format(today, "yyyy-MM-dd"));
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [branchId, setBranchId] = useState<string>("all");

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "—";
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";

  const commonFilters = <div className="grid gap-3 md:grid-cols-5 items-end">
    <div><Label>Desde</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
    <div><Label>Hasta</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
    <div>
      <Label>Empleado</Label>
      <Select value={employeeId} onValueChange={setEmployeeId}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos</SelectItem>
          {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div>
      <Label>Sede</Label>
      <Select value={branchId} onValueChange={setBranchId}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas</SelectItem>
          {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  </div>;

  const { data: payments = [] } = useQuery({
    queryKey: ["payroll-payments", from, to, employeeId, branchId],
    queryFn: async () => {
      let q = supabase.from("payroll_payments").select("*").gte("paid_at", from + "T00:00:00").lte("paid_at", to + "T23:59:59").order("paid_at", { ascending: false });
      if (employeeId !== "all") q = q.eq("employee_id", employeeId);
      if (branchId !== "all") q = q.eq("branch_id", branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PaymentRow[];
    },
  });

  const { data: deductions = [] } = useQuery({
    queryKey: ["hist-deductions", from, to, employeeId],
    queryFn: async () => {
      let q = supabase.from("payroll_manual_deductions").select("*").gte("deduction_date", from).lte("deduction_date", to).order("deduction_date", { ascending: false });
      if (employeeId !== "all") q = q.eq("employee_id", employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ManualDeduction[];
    },
  });

  const { data: lates = [] } = useQuery({
    queryKey: ["hist-lates", from, to, employeeId],
    queryFn: async () => {
      let q = supabase.from("attendance_late_records").select("*").gte("date", from).lte("date", to).gt("late_minutes", 0).order("date", { ascending: false });
      if (employeeId !== "all") q = q.eq("employee_id", employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LateRow[];
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle>Historial y reportes</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {commonFilters}
        <Tabs defaultValue="pagos">
          <TabsList>
            <TabsTrigger value="pagos">Pagos ({payments.length})</TabsTrigger>
            <TabsTrigger value="descuentos">Descuentos ({deductions.length})</TabsTrigger>
            <TabsTrigger value="tardanzas">Tardanzas ({lates.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pagos">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Fecha</TableHead><TableHead>Empleado</TableHead><TableHead>Sede</TableHead>
                  <TableHead>Período</TableHead><TableHead className="text-right">Turnos</TableHead>
                  <TableHead className="text-right">Bruto</TableHead><TableHead className="text-right">Desc.</TableHead>
                  <TableHead className="text-right">Neto</TableHead><TableHead>Método</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">Sin pagos</TableCell></TableRow>}
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>#{p.receipt_number}</TableCell>
                    <TableCell>{format(new Date(p.paid_at), "dd/MM/yyyy HH:mm")}</TableCell>
                    <TableCell className="font-medium">{empName(p.employee_id)}</TableCell>
                    <TableCell>{branchName(p.branch_id)}</TableCell>
                    <TableCell className="text-xs">{format(new Date(p.period_start + "T00:00:00"), "dd/MM")} → {format(new Date(p.period_end + "T00:00:00"), "dd/MM")}</TableCell>
                    <TableCell className="text-right">{p.shifts_count}</TableCell>
                    <TableCell className="text-right">{formatMoney(p.gross_amount)}</TableCell>
                    <TableCell className="text-right text-rose-600">{formatMoney(Number(p.late_deduction) + Number(p.manual_deduction))}</TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(p.net_amount)}</TableCell>
                    <TableCell><Badge variant="secondary">{p.payment_method}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="descuentos">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Fecha</TableHead><TableHead>Empleado</TableHead><TableHead>Concepto</TableHead>
                <TableHead>Notas</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Estado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {deductions.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sin descuentos</TableCell></TableRow>}
                {deductions.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{format(new Date(d.deduction_date + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                    <TableCell className="font-medium">{empName(d.employee_id)}</TableCell>
                    <TableCell>{d.concept}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">{d.notes ?? "—"}</TableCell>
                    <TableCell className="text-right text-rose-600">{formatMoney(d.amount)}</TableCell>
                    <TableCell>{d.applied_to_payment_id ? <Badge variant="outline">Aplicado</Badge> : <Badge className="bg-amber-500 hover:bg-amber-500">Pendiente</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="tardanzas">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Fecha</TableHead><TableHead>Empleado</TableHead>
                <TableHead>Programada</TableHead><TableHead>Real</TableHead>
                <TableHead className="text-right">Minutos</TableHead><TableHead className="text-right">Descuento</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {lates.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sin tardanzas</TableCell></TableRow>}
                {lates.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{format(new Date(d.date + "T00:00:00"), "dd/MM/yyyy")}</TableCell>
                    <TableCell className="font-medium">{empName(d.employee_id)}</TableCell>
                    <TableCell>{d.scheduled_in ?? "—"}</TableCell>
                    <TableCell>{d.actual_in ? format(new Date(d.actual_in), "HH:mm:ss") : "Ausencia"}</TableCell>
                    <TableCell className="text-right">{d.late_minutes}</TableCell>
                    <TableCell className="text-right text-rose-600">{formatMoney(d.deduction_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
