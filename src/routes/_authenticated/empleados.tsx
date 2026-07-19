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
import { Plus, Pencil, Trash2, Users, CalendarDays, Clock, DollarSign, Download } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { format } from "date-fns";

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
        <TabsList className="grid w-full grid-cols-4 max-w-2xl">
          <TabsTrigger value="empleados"><Users className="mr-2 h-4 w-4" />Empleados</TabsTrigger>
          <TabsTrigger value="horarios"><Clock className="mr-2 h-4 w-4" />Horarios</TabsTrigger>
          <TabsTrigger value="festivos"><CalendarDays className="mr-2 h-4 w-4" />Festivos</TabsTrigger>
          <TabsTrigger value="nomina"><DollarSign className="mr-2 h-4 w-4" />Nómina</TabsTrigger>
        </TabsList>

        <TabsContent value="empleados"><EmpleadosTab /></TabsContent>
        <TabsContent value="horarios"><HorariosTab /></TabsContent>
        <TabsContent value="festivos"><FestivosTab /></TabsContent>
        <TabsContent value="nomina"><NominaTab /></TabsContent>
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
  const { data: employees = [] } = useEmployees();
  const { data: branches = [] } = useBranches();
  const today = new Date();
  const firstOfWeek = new Date(today);
  firstOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const [from, setFrom] = useState(format(firstOfWeek, "yyyy-MM-dd"));
  const [to, setTo] = useState(format(today, "yyyy-MM-dd"));
  const [branchId, setBranchId] = useState<string>("all");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: rows = [], isFetching, refetch } = useQuery({
    queryKey: ["payroll-summary", from, to, branchId, employeeId],
    queryFn: async () => {
      const args: any = { _from: from, _to: to };
      if (employeeId !== "all") args._employee_id = employeeId;
      if (branchId !== "all") args._branch_id = branchId;
      const { data, error } = await supabase.rpc("payroll_period_summary", args);
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
      <CardHeader><CardTitle>Nómina y retrasos</CardTitle></CardHeader>
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
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === r.employee_id ? null : r.employee_id)}>
                        {expanded === r.employee_id ? "Ocultar" : "Ver detalle"}
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
