import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Copy, ExternalLink, Plus, Trash2, Building2, Star } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ajustes")({
  head: () => ({ meta: [{ title: "Ajustes · Goloso POS" }] }),
  component: AjustesPage,
});

const DAYS: Array<{ key: string; label: string }> = [
  { key: "lun", label: "Lunes" }, { key: "mar", label: "Martes" }, { key: "mie", label: "Miércoles" },
  { key: "jue", label: "Jueves" }, { key: "vie", label: "Viernes" }, { key: "sab", label: "Sábado" }, { key: "dom", label: "Domingo" },
];

interface Schedule { open: boolean; from: string; to: string; }
interface Settings {
  id: number; business_name: string; nit: string | null; address: string | null; city: string | null;
  phone: string | null; logo_url: string | null; menu_link: string | null;
  schedules: Record<string, Schedule>; delivery_fee: number;
}

function AjustesPage() {
  const { isAdmin } = useAuth();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">Ajustes</h1>
      <Tabs defaultValue="estab">
        <TabsList>
          <TabsTrigger value="estab">Establecimiento</TabsTrigger>
          <TabsTrigger value="suc">Sucursales</TabsTrigger>
          <TabsTrigger value="impr">Impresoras</TabsTrigger>
          <TabsTrigger value="pagos">Medios de pago</TabsTrigger>
          <TabsTrigger value="domi">Domicilio</TabsTrigger>
        </TabsList>
        <TabsContent value="estab"><EstablecimientoTab disabled={!isAdmin} /></TabsContent>
        <TabsContent value="suc"><SucursalesTab disabled={!isAdmin} /></TabsContent>
        <TabsContent value="impr"><ImpresorasTab disabled={!isAdmin} /></TabsContent>
        <TabsContent value="pagos"><PagosTab disabled={!isAdmin} /></TabsContent>
        <TabsContent value="domi"><DomicilioTab disabled={!isAdmin} /></TabsContent>
      </Tabs>
    </div>
  );
}

function EstablecimientoTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").eq("id", 1).single()).data as unknown as Settings,
  });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (settings) setS(settings); }, [settings]);
  if (!s) return null;

  const setSched = (day: string, patch: Partial<Schedule>) => setS({ ...s, schedules: { ...s.schedules, [day]: { ...s.schedules[day], ...patch } } });

  async function save() {
    if (!s) return;
    const { error } = await supabase.from("settings").update({
      business_name: s.business_name, nit: s.nit, address: s.address, city: s.city,
      phone: s.phone, logo_url: s.logo_url, menu_link: s.menu_link,
      schedules: s.schedules as unknown as never,
    }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Guardado");
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div><Label>Nombre</Label><Input disabled={disabled} value={s.business_name} onChange={(e) => setS({ ...s, business_name: e.target.value })} /></div>
          <div><Label>NIT</Label><Input disabled={disabled} value={s.nit ?? ""} onChange={(e) => setS({ ...s, nit: e.target.value })} /></div>
          <div><Label>Dirección</Label><Input disabled={disabled} value={s.address ?? ""} onChange={(e) => setS({ ...s, address: e.target.value })} /></div>
          <div><Label>Ciudad</Label><Input disabled={disabled} value={s.city ?? ""} onChange={(e) => setS({ ...s, city: e.target.value })} /></div>
          <div><Label>Teléfono</Label><Input disabled={disabled} value={s.phone ?? ""} onChange={(e) => setS({ ...s, phone: e.target.value })} /></div>
          <div className="md:col-span-2">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              {s.logo_url && (
                <img src={s.logo_url} alt="logo" className="h-16 w-16 rounded-lg border object-contain bg-white" />
              )}
              <Input
                disabled={disabled}
                type="file"
                accept="image/png,image/bmp,image/jpeg,image/webp,.png,.bmp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
                  const path = `logo-${Date.now()}.${ext}`;
                  const up = await supabase.storage.from("logos").upload(path, file, { upsert: true, contentType: file.type || `image/${ext}` });
                  if (up.error) return toast.error(up.error.message);
                  const { data: signed } = await supabase.storage.from("logos").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
                  if (signed?.signedUrl) setS({ ...s, logo_url: signed.signedUrl });
                  toast.success("Logo subido");
                }}
              />
              {s.logo_url && (
                <Button type="button" variant="outline" size="sm" onClick={() => setS({ ...s, logo_url: null })}>
                  Quitar
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">PNG o BMP recomendado. Se guarda al pulsar "Guardar cambios".</p>
          </div>
        </div>



        <div>
          <Label>Link del menú en línea</Label>
          <div className="flex gap-2">
            <Input disabled={disabled} value={s.menu_link ?? ""} onChange={(e) => setS({ ...s, menu_link: e.target.value })} placeholder="https://…" />
            <Button type="button" variant="outline" size="icon" onClick={() => { if (s.menu_link) { navigator.clipboard.writeText(s.menu_link); toast.success("Copiado"); } }}><Copy className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon" onClick={() => s.menu_link && window.open(s.menu_link, "_blank")}><ExternalLink className="h-4 w-4" /></Button>
          </div>
        </div>

        <div>
          <h3 className="font-medium mb-2">Horarios</h3>
          <div className="space-y-2">
            {DAYS.map((d) => {
              const sc = s.schedules[d.key] ?? { open: false, from: "10:00", to: "21:00" };
              return (
                <div key={d.key} className="grid grid-cols-[auto,1fr,auto,auto] items-center gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2 w-28"><Switch disabled={disabled} checked={sc.open} onCheckedChange={(v) => setSched(d.key, { open: v })} /><span className="text-sm">{d.label}</span></div>
                  <div className="text-xs text-muted-foreground">{sc.open ? "Abierto" : "Cerrado"}</div>
                  <Input disabled={disabled || !sc.open} type="time" className="w-32" value={sc.from} onChange={(e) => setSched(d.key, { from: e.target.value })} />
                  <Input disabled={disabled || !sc.open} type="time" className="w-32" value={sc.to} onChange={(e) => setSched(d.key, { to: e.target.value })} />
                </div>
              );
            })}
          </div>
        </div>

        {!disabled && <div className="flex justify-end"><Button onClick={save}>Guardar cambios</Button></div>}
      </CardContent>
    </Card>
  );
}

interface Printer { id: string; name: string; ip: string; port: number; platform: string; area: string; active: boolean; }
function ImpresorasTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Printer> | null>(null);
  const { data = [] } = useQuery<Printer[]>({
    queryKey: ["printers"],
    queryFn: async () => (await supabase.from("printers").select("*").order("name")).data ?? [],
  });
  async function save() {
    if (!edit?.name?.trim() || !edit.ip) return toast.error("Nombre e IP requeridos");
    const payload = { name: edit.name.trim(), ip: edit.ip, port: Number(edit.port ?? 9100), platform: edit.platform ?? "Windows", area: edit.area ?? "caja", active: edit.active ?? true };
    const { error } = edit.id ? await supabase.from("printers").update(payload).eq("id", edit.id) : await supabase.from("printers").insert(payload);
    if (error) return toast.error(error.message);
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["printers"] });
  }
  async function remove(id: string) { await supabase.from("printers").delete().eq("id", id); qc.invalidateQueries({ queryKey: ["printers"] }); }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Impresoras térmicas</CardTitle>
        {!disabled && (
          <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
            <DialogTrigger asChild><Button onClick={() => setEdit({ port: 9100, platform: "Windows", area: "caja", active: true })}><Plus className="h-4 w-4 mr-1" /> Agregar</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{edit?.id ? "Editar" : "Nueva"} impresora</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Nombre</Label><Input value={edit?.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>IP</Label><Input value={edit?.ip ?? ""} onChange={(e) => setEdit({ ...edit, ip: e.target.value })} placeholder="192.168.1.50" /></div>
                  <div><Label>Puerto</Label><Input type="number" value={edit?.port ?? 9100} onChange={(e) => setEdit({ ...edit, port: Number(e.target.value) })} /></div>
                  <div>
                    <Label>Plataforma</Label>
                    <Select value={edit?.platform ?? "Windows"} onValueChange={(v) => setEdit({ ...edit, platform: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="Windows">Windows</SelectItem><SelectItem value="Android">Android</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Área</Label>
                    <Select value={edit?.area ?? "caja"} onValueChange={(v) => setEdit({ ...edit, area: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="caja">Caja</SelectItem><SelectItem value="cocina">Cocina</SelectItem><SelectItem value="barra">Barra</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>IP:Puerto</TableHead><TableHead>Plataforma</TableHead><TableHead>Área</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell className="font-mono text-sm">{p.ip}:{p.port}</TableCell>
                <TableCell>{p.platform}</TableCell>
                <TableCell className="capitalize">{p.area}</TableCell>
                <TableCell className="text-right">
                  {!disabled && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin impresoras</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PagosTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["payment_methods-all"],
    queryFn: async () => (await supabase.from("payment_methods").select("*").order("sort_order")).data ?? [],
  });
  async function toggle(id: string, active: boolean) {
    await supabase.from("payment_methods").update({ active }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["payment_methods-all"] });
    qc.invalidateQueries({ queryKey: ["payment_methods"] });
  }
  return (
    <Card>
      <CardHeader><CardTitle>Medios de pago</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {data.map((m: { id: string; name: string; active: boolean }) => (
          <div key={m.id} className="flex items-center justify-between rounded-lg border p-3">
            <span className="font-medium">{m.name}</span>
            <Switch disabled={disabled} checked={m.active} onCheckedChange={(v) => toggle(m.id, v)} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DomicilioTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").eq("id", 1).single()).data as unknown as Settings,
  });
  const [fee, setFee] = useState<number>(0);
  useEffect(() => { if (data) setFee(Number(data.delivery_fee)); }, [data]);
  async function save() {
    const { error } = await supabase.from("settings").update({ delivery_fee: fee }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Guardado");
    qc.invalidateQueries({ queryKey: ["settings"] });
  }
  return (
    <Card>
      <CardHeader><CardTitle>Tarifa de domicilio</CardTitle></CardHeader>
      <CardContent className="space-y-3 max-w-md">
        <Label>Tarifa fija (COP)</Label>
        <Input type="number" disabled={disabled} value={fee} onChange={(e) => setFee(Number(e.target.value))} />
        {!disabled && <Button onClick={save}>Guardar</Button>}
      </CardContent>
    </Card>
  );
}

interface Branch {
  id: string; name: string; address: string | null; phone: string | null; city: string | null;
  is_main: boolean; inherits_main_catalog: boolean;
}

function SucursalesTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Branch> | null>(null);
  const [copyCatalog, setCopyCatalog] = useState(true);
  const { data = [] } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: async () => (await supabase.from("branches").select("*").order("is_main", { ascending: false }).order("name")).data as unknown as Branch[] ?? [],
  });

  async function save() {
    if (!edit?.name?.trim()) return toast.error("Nombre requerido");
    const payload = {
      name: edit.name.trim(),
      address: edit.address ?? null,
      phone: edit.phone ?? null,
      city: edit.city ?? null,
      inherits_main_catalog: copyCatalog,
    };
    const { error } = edit.id
      ? await supabase.from("branches").update(payload).eq("id", edit.id)
      : await supabase.from("branches").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(copyCatalog ? "Sucursal creada con catálogo de la sede principal" : "Sucursal creada");
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["branches"] });
  }
  async function remove(b: Branch) {
    if (b.is_main) return toast.error("No se puede eliminar la sede principal");
    if (!confirm(`¿Eliminar sucursal "${b.name}"?`)) return;
    const { error } = await supabase.from("branches").delete().eq("id", b.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["branches"] });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Sucursales</CardTitle>
        {!disabled && (
          <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => { setEdit({}); setCopyCatalog(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Agregar sucursal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{edit?.id ? "Editar" : "Nueva"} sucursal</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Nombre</Label><Input value={edit?.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Goloso Norte" /></div>
                <div><Label>Dirección</Label><Input value={edit?.address ?? ""} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Ciudad</Label><Input value={edit?.city ?? ""} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></div>
                  <div><Label>Teléfono</Label><Input value={edit?.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
                </div>
                {!edit?.id && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <div className="font-medium text-sm">Copiar productos de la sede principal</div>
                      <div className="text-xs text-muted-foreground">La sucursal usará el mismo catálogo, categorías y precios.</div>
                    </div>
                    <Switch checked={copyCatalog} onCheckedChange={setCopyCatalog} />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
                <Button onClick={save}>Guardar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Sucursal</TableHead><TableHead>Ciudad</TableHead><TableHead>Teléfono</TableHead><TableHead>Catálogo</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {data.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {b.name}
                  {b.is_main && <Badge className="ml-1"><Star className="h-3 w-3 mr-1" /> Principal</Badge>}
                </TableCell>
                <TableCell>{b.city ?? "—"}</TableCell>
                <TableCell>{b.phone ?? "—"}</TableCell>
                <TableCell>{b.inherits_main_catalog ? "Sede principal" : "Independiente"}</TableCell>
                <TableCell className="text-right">
                  {!disabled && !b.is_main && (
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(b)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin sucursales</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

