import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
// Tabs UI no longer used at page level (redesigned with cards + section view).
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Copy, ExternalLink, Plus, Trash2, Building2, Star, Upload, Receipt, Link as LinkIcon, QrCode, Download, Printer, AlertTriangle, RefreshCw, Pencil, Settings as SettingsIcon, Store, CreditCard, Bike, Award, ShieldCheck, Sparkles, ChefHat, Search, ArrowLeft, ChevronRight } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { RolesTab } from "@/components/ajustes/roles-tab";
import { FidelizacionTab } from "@/components/ajustes/fidelizacion-tab";
import { SectionErrorBoundary } from "@/components/error-boundary";

export const Route = createFileRoute("/_authenticated/ajustes")({
  head: () => ({ meta: [{ title: "Ajustes · Goloso POS" }] }),
  component: AjustesPage,
  errorComponent: AjustesErrorComponent,
});

function AjustesErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <div className="max-w-2xl rounded-2xl border border-destructive/40 bg-destructive/5 p-6 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-destructive text-lg">
          <AlertTriangle className="h-5 w-5" /> No se pudo cargar Ajustes
        </div>
        <p className="text-sm text-muted-foreground">
          Ocurrió un error al renderizar esta pantalla. Puedes reintentar sin perder tu sesión.
        </p>
        <pre className="text-xs whitespace-pre-wrap break-words text-muted-foreground max-h-48 overflow-auto bg-background/60 p-3 rounded-lg border">
          {error?.message || String(error)}
        </pre>
        <button
          onClick={() => reset()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" /> Reintentar
        </button>
      </div>
    </div>
  );
}

const DAYS: Array<{ key: string; label: string }> = [
  { key: "lun", label: "Lunes" }, { key: "mar", label: "Martes" }, { key: "mie", label: "Miércoles" },
  { key: "jue", label: "Jueves" }, { key: "vie", label: "Viernes" }, { key: "sab", label: "Sábado" }, { key: "dom", label: "Domingo" },
];

interface Schedule { open: boolean; from: string; to: string; }
interface TicketConfigForm {
  show_logo: boolean; show_business_name: boolean; show_nit: boolean; show_address: boolean;
  show_phone: boolean; show_email: boolean; show_ticket_number: boolean; show_date: boolean;
  show_customer: boolean; show_customer_address: boolean; show_customer_phone: boolean;
  show_payment_method: boolean; show_subtotal: boolean; show_tax: boolean; show_delivery_fee: boolean;
  show_cash_received: boolean; show_thanks: boolean; show_decorations: boolean;
  title_text: string; number_prefix: string; thanks_text: string; extra_footer: string;
}
const DEFAULT_TICKET_CFG: TicketConfigForm = {
  show_logo: true, show_business_name: true, show_nit: true, show_address: true,
  show_phone: true, show_email: true, show_ticket_number: true, show_date: true,
  show_customer: true, show_customer_address: true, show_customer_phone: true,
  show_payment_method: true, show_subtotal: true, show_tax: true, show_delivery_fee: true,
  show_cash_received: true, show_thanks: true, show_decorations: true,
  title_text: "TICKET DE VENTA", number_prefix: "TV-",
  thanks_text: "¡Gracias por Preferirnos!", extra_footer: "",
};
interface Settings {
  id: number; business_name: string; nit: string | null; address: string | null; city: string | null;
  phone: string | null; logo_url: string | null; menu_link: string | null;
  schedules: Record<string, Schedule>; delivery_fee: number;
  ticket_header: string | null; ticket_footer: string | null;
  nequi_number: string | null; bancolombia_account: string | null;
  ticket_config: Partial<TicketConfigForm> | null;
}


type TabDef = {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
  group: "negocio" | "ventas" | "operaciones" | "personal";
  accent: string;
  hidden?: boolean;
};

const TABS: TabDef[] = [
  { value: "estab",       label: "Establecimiento",   icon: Store,        hint: "Datos generales, horarios y marca del negocio",       group: "negocio",     accent: "from-indigo-500 to-violet-500" },
  { value: "suc",         label: "Sucursales",        icon: Building2,    hint: "Administra todas tus sedes y sus datos",              group: "negocio",     accent: "from-sky-500 to-blue-600" },
  { value: "sede-edit",   label: "Editar sede",       icon: Pencil,       hint: "Modificar información de una sede específica",         group: "negocio",     accent: "from-slate-500 to-slate-700", hidden: true },
  { value: "ticket",      label: "Ticket",            icon: Receipt,      hint: "Personaliza el diseño y contenido del recibo",         group: "ventas",      accent: "from-amber-500 to-orange-600" },
  { value: "pagos",       label: "Medios de pago",    icon: CreditCard,   hint: "Métodos aceptados y cuentas para transferencias",     group: "ventas",      accent: "from-emerald-500 to-teal-600" },
  { value: "domi",        label: "Domicilio",         icon: Bike,         hint: "Tarifas de entrega y zonas de reparto",               group: "ventas",      accent: "from-cyan-500 to-sky-600" },
  { value: "fidel",       label: "Fidelización",      icon: Award,        hint: "Sistema de puntos y recompensas para clientes",       group: "ventas",      accent: "from-pink-500 to-rose-600" },
  { value: "impr",        label: "Impresoras",        icon: Printer,      hint: "Configura impresoras térmicas por área",              group: "operaciones", accent: "from-fuchsia-500 to-purple-600" },
  { value: "kiosko-link", label: "Autopedido",        icon: QrCode,       hint: "Enlace y QR para el kiosco de autoservicio",          group: "operaciones", accent: "from-violet-500 to-indigo-600" },
  { value: "kds-link",    label: "KDS",               icon: ChefHat,      hint: "Pantalla de cocina para ver comandas en vivo",        group: "operaciones", accent: "from-orange-500 to-red-600" },
  { value: "roles",       label: "Roles",             icon: ShieldCheck,  hint: "Permisos, accesos y perfiles de usuario",             group: "personal",    accent: "from-lime-500 to-emerald-600" },
];

const GROUPS: Array<{ id: TabDef["group"]; label: string; description: string }> = [
  { id: "negocio",     label: "Negocio",          description: "Identidad, sucursales y marca" },
  { id: "ventas",      label: "Ventas y cobros",  description: "Ticket, pagos, domicilio y fidelización" },
  { id: "operaciones", label: "Operaciones",      description: "Impresoras, KDS y autopedido" },
  { id: "personal",    label: "Personal",         description: "Roles, permisos y accesos" },
];

function AjustesPage() {
  useAuth();
  const [tab, setTab] = useState<string | null>(null);
  const [editBranchId, setEditBranchId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const goEditBranch = (id: string) => { setEditBranchId(id); setTab("sede-edit"); };

  const activeTab = tab ? (TABS.find((t) => t.value === tab) ?? null) : null;
  const visibleTabs = TABS.filter((t) => !t.hidden);
  const q = query.trim().toLowerCase();
  const filtered = visibleTabs.filter((t) => !q || t.label.toLowerCase().includes(q) || t.hint.toLowerCase().includes(q));

  return (
    <div className="ajustes-scope min-h-full">
      {activeTab ? (
        <SectionView activeTab={activeTab} allTabs={visibleTabs} onBack={() => setTab(null)} onSelect={setTab}>
          {tab === "estab"       && <SectionErrorBoundary label="Establecimiento"><EstablecimientoTab disabled={false} /></SectionErrorBoundary>}
          {tab === "ticket"      && <SectionErrorBoundary label="Ticket"><TicketTab /></SectionErrorBoundary>}
          {tab === "suc"         && <SectionErrorBoundary label="Sucursales"><SucursalesTab disabled={false} onEditBranch={goEditBranch} /></SectionErrorBoundary>}
          {tab === "sede-edit"   && <SectionErrorBoundary label="Editar sede"><EditarSedeTab initialBranchId={editBranchId} /></SectionErrorBoundary>}
          {tab === "kiosko-link" && <SectionErrorBoundary label="Link de Autopedido"><AutopedidoLinkTab /></SectionErrorBoundary>}
          {tab === "kds-link"    && <SectionErrorBoundary label="Link de KDS"><KdsLinkTab /></SectionErrorBoundary>}
          {tab === "impr"        && <SectionErrorBoundary label="Impresoras"><ImpresorasTab disabled={false} /></SectionErrorBoundary>}
          {tab === "pagos"       && <SectionErrorBoundary label="Medios de pago"><PagosTab disabled={false} /></SectionErrorBoundary>}
          {tab === "domi"        && <SectionErrorBoundary label="Domicilio"><DomicilioTab disabled={false} /></SectionErrorBoundary>}
          {tab === "fidel"       && <SectionErrorBoundary label="Fidelización"><FidelizacionTab /></SectionErrorBoundary>}
          {tab === "roles"       && <SectionErrorBoundary label="Roles"><RolesTab /></SectionErrorBoundary>}
        </SectionView>
      ) : (
        <HubView query={query} setQuery={setQuery} filtered={filtered} allTabs={visibleTabs} onSelect={setTab} />
      )}
    </div>
  );
}

function HubView({
  query, setQuery, filtered, allTabs, onSelect,
}: {
  query: string;
  setQuery: (v: string) => void;
  filtered: TabDef[];
  allTabs: TabDef[];
  onSelect: (v: string) => void;
}) {
  return (
    <div className="space-y-8 pb-10">
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-hero p-[1px] shadow-2xl">
        <div className="relative rounded-[calc(1.5rem-1px)] bg-background/85 backdrop-blur-xl">
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{ backgroundImage: "radial-gradient(1100px 260px at 8% -20%, color-mix(in oklab, var(--color-primary) 24%, transparent), transparent 60%), radial-gradient(800px 260px at 100% 120%, color-mix(in oklab, var(--color-primary) 20%, transparent), transparent 60%)" }}
          />
          <div className="relative flex flex-col gap-6 p-6 sm:p-10">
            <div className="flex items-start gap-5">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-xl shadow-primary/30 ring-1 ring-white/20">
                <SettingsIcon className="h-8 w-8" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                  <Sparkles className="h-3 w-3" /> Panel de control
                </div>
                <h1 className="font-display mt-3 text-3xl sm:text-5xl font-extrabold tracking-tight leading-[1.05] bg-gradient-to-br from-foreground via-foreground to-primary/70 bg-clip-text text-transparent">
                  Ajustes del sistema
                </h1>
                <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-2xl">
                  Configura cada detalle de tu POS — identidad de marca, sucursales, tickets,
                  impresoras, pagos, fidelización y más — desde un único centro de control.
                </p>
              </div>
            </div>
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar ajuste… (p. ej. impresoras, ticket, roles)"
                className="h-12 w-full rounded-2xl border border-border/70 bg-card/70 pl-11 pr-4 text-sm font-medium shadow-sm outline-none backdrop-blur transition-all placeholder:text-muted-foreground/70 focus:border-primary/50 focus:bg-card focus:shadow-lg focus:shadow-primary/10"
              />
            </div>
          </div>
        </div>
      </div>

      {query.trim() ? (
        <div>
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 className="font-display text-lg font-bold tracking-tight">
              Resultados
              <span className="ml-2 text-sm font-medium text-muted-foreground">
                {filtered.length} de {allTabs.length}
              </span>
            </h2>
            <button onClick={() => setQuery("")} className="text-xs font-semibold text-primary hover:underline">Limpiar</button>
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No encontramos ningún ajuste con ese nombre.
            </div>
          ) : (
            <CardsGrid tabs={filtered} onSelect={onSelect} />
          )}
        </div>
      ) : (
        GROUPS.map((g) => {
          const items = allTabs.filter((t) => t.group === g.id);
          if (items.length === 0) return null;
          return (
            <section key={g.id} className="space-y-4">
              <div className="flex items-end justify-between gap-4 px-1">
                <div>
                  <h2 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight">{g.label}</h2>
                  <p className="text-xs sm:text-sm text-muted-foreground">{g.description}</p>
                </div>
                <div className="hidden sm:block h-px flex-1 bg-gradient-to-r from-border/80 via-border/40 to-transparent mb-2" />
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {items.length} {items.length === 1 ? "opción" : "opciones"}
                </span>
              </div>
              <CardsGrid tabs={items} onSelect={onSelect} />
            </section>
          );
        })
      )}
    </div>
  );
}

function CardsGrid({ tabs, onSelect }: { tabs: TabDef[]; onSelect: (v: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {tabs.map((t) => (
        <SettingCard key={t.value} tab={t} onClick={() => onSelect(t.value)} />
      ))}
    </div>
  );
}

function SettingCard({ tab, onClick }: { tab: TabDef; onClick: () => void }) {
  const Icon = tab.icon;
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <div className={`pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br ${tab.accent} opacity-10 blur-2xl transition-opacity duration-300 group-hover:opacity-25`} />
      <div className="relative flex items-start gap-4">
        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${tab.accent} text-white shadow-lg ring-1 ring-white/20 transition-transform duration-300 group-hover:scale-105`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-bold tracking-tight leading-tight">{tab.label}</h3>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{tab.hint}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60 transition-all duration-300 group-hover:translate-x-1 group-hover:text-primary" />
      </div>
    </button>
  );
}

function SectionView({
  activeTab, allTabs, onBack, onSelect, children,
}: {
  activeTab: TabDef;
  allTabs: TabDef[];
  onBack: () => void;
  onSelect: (v: string) => void;
  children: React.ReactNode;
}) {
  const Icon = activeTab.icon;
  return (
    <div className="space-y-6 pb-10">
      <div className="sticky top-0 z-20 -mx-4 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Ajustes
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-bold shadow-sm">
            <Icon className="h-3.5 w-3.5 text-primary" />
            <span className="font-display">{activeTab.label}</span>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
        <div className={`pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-gradient-to-br ${activeTab.accent} opacity-10 blur-3xl`} />
        <div className="relative flex items-center gap-4">
          <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${activeTab.accent} text-white shadow-lg ring-1 ring-white/20`}>
            <Icon className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight">{activeTab.label}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{activeTab.hint}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card/60 p-2 shadow-sm backdrop-blur">
        <div className="flex w-full gap-1.5 overflow-x-auto scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {allTabs.map((t) => {
            const TIcon = t.icon;
            const active = t.value === activeTab.value;
            return (
              <button
                key={t.value}
                onClick={() => onSelect(t.value)}
                title={t.hint}
                className={`group relative flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all ${
                  active
                    ? "border-primary/30 bg-gradient-primary text-primary-foreground shadow-lg shadow-primary/25"
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                <TIcon className="h-4 w-4" />
                <span className="font-display font-semibold tracking-tight">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>{children}</div>
    </div>
  );
}


function TicketTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").eq("id", 1).maybeSingle()).data as unknown as Settings,
  });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (settings) setS(settings); }, [settings]);
  if (!s) return null;

  const cfg: TicketConfigForm = { ...DEFAULT_TICKET_CFG, ...(s.ticket_config ?? {}) };
  const setCfg = (patch: Partial<TicketConfigForm>) =>
    setS({ ...s, ticket_config: { ...cfg, ...patch } });

  async function save() {
    if (!s) return;
    const { error } = await supabase.from("settings").update({
      logo_url: s.logo_url,
      ticket_header: s.ticket_header,
      ticket_footer: s.ticket_footer,
      ticket_config: (s.ticket_config ?? cfg) as unknown as never,
    } as never).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Personalización del ticket guardada");
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  async function handleLogoFile(file: File) {
    if (!s) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `logo-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("logos").upload(path, file, { upsert: true, contentType: file.type || `image/${ext}` });
      if (up.error) { toast.error(up.error.message); return; }
      const { data: signed } = await supabase.storage.from("logos").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      if (signed?.signedUrl) setS({ ...s, logo_url: signed.signedUrl });
      toast.success("Logo subido — recuerda guardar cambios");
    } finally {
      setUploading(false);
    }
  }

  const Toggle = ({ k, label, hint }: { k: keyof TicketConfigForm; label: string; hint?: string }) => (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={Boolean(cfg[k])} onCheckedChange={(v) => setCfg({ [k]: v } as Partial<TicketConfigForm>)} />
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> Personalización del Ticket de Venta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 p-6 pt-0">
          <div>
            <Label>Logo del ticket</Label>
            <p className="text-xs text-muted-foreground mb-2">Aparece centrado en la parte superior del ticket impreso. PNG, BMP, JPG o WEBP.</p>
            <div className="flex items-center gap-3">
              {s.logo_url ? (
                <img src={s.logo_url} alt="logo" className="h-24 w-24 rounded-lg border object-contain bg-white" />
              ) : (
                <div className="h-24 w-24 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground text-center px-2">Sin logo</div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/bmp,image/jpeg,image/webp,.png,.bmp,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = ""; }}
              />
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Upload className="h-4 w-4 mr-1" />{uploading ? "Subiendo…" : (s.logo_url ? "Cambiar logo" : "Subir logo")}
                </Button>
                {s.logo_url && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setS({ ...s, logo_url: null })}>Quitar logo</Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Textos del ticket</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 p-6 pt-0">
          <div>
            <Label>Título del ticket</Label>
            <Input value={cfg.title_text} onChange={(e) => setCfg({ title_text: e.target.value })} placeholder="TICKET DE VENTA" />
          </div>
          <div>
            <Label>Prefijo de número</Label>
            <Input value={cfg.number_prefix} onChange={(e) => setCfg({ number_prefix: e.target.value })} placeholder="TV-" />
            <p className="text-xs text-muted-foreground mt-1">Se antepone al número: {cfg.number_prefix}000001</p>
          </div>
          <div className="sm:col-span-2">
            <Label>Mensaje de agradecimiento</Label>
            <Input value={cfg.thanks_text} onChange={(e) => setCfg({ thanks_text: e.target.value })} placeholder="¡Gracias por Preferirnos!" />
          </div>
          <div className="sm:col-span-2">
            <Label>Líneas adicionales al pie</Label>
            <Textarea rows={3} value={cfg.extra_footer} onChange={(e) => setCfg({ extra_footer: e.target.value })} placeholder="Síguenos: @heladeriagoloso&#10;Domicilios: 311 448 6300" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Elementos visibles en el ticket</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 p-6 pt-0">
          <Toggle k="show_logo" label="Logo" hint="Imagen del negocio en la parte superior" />
          <Toggle k="show_business_name" label="Nombre del negocio" />
          <Toggle k="show_nit" label="NIT / RUT" />
          <Toggle k="show_address" label="Dirección del negocio" />
          <Toggle k="show_phone" label="Teléfono del negocio" />
          <Toggle k="show_email" label="Email del negocio" />
          <Toggle k="show_ticket_number" label="Título + número de ticket" />
          <Toggle k="show_date" label="Fecha y hora" />
          <Toggle k="show_customer" label="Cliente" />
          <Toggle k="show_customer_address" label="Dirección del cliente" hint="Solo si aplica al pedido" />
          <Toggle k="show_customer_phone" label="Teléfono del cliente" />
          <Toggle k="show_payment_method" label="Forma de pago" />
          <Toggle k="show_subtotal" label="Subtotal" />
          <Toggle k="show_tax" label="Impuestos" />
          <Toggle k="show_delivery_fee" label="Domicilio" />
          <Toggle k="show_cash_received" label="Recibido / Cambio" />
          <Toggle k="show_thanks" label="Mensaje de agradecimiento" />
          <Toggle k="show_decorations" label="Decoraciones (♥ · 🍦 · ♥)" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Encabezado y pie personalizados (opcional)</CardTitle></CardHeader>
        <CardContent className="space-y-4 p-6 pt-0">
          <div>
            <Label>Encabezado extra</Label>
            <p className="text-xs text-muted-foreground mb-2">Se agrega debajo del logo. Déjalo vacío para usar los datos del establecimiento.</p>
            <Textarea rows={3} placeholder="" value={s.ticket_header ?? ""} onChange={(e) => setS({ ...s, ticket_header: e.target.value })} />
          </div>
          <div>
            <Label>Pie de página clásico</Label>
            <p className="text-xs text-muted-foreground mb-2">Se usa si el mensaje de agradecimiento está vacío.</p>
            <Textarea rows={3} value={s.ticket_footer ?? ""} onChange={(e) => setS({ ...s, ticket_footer: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" onClick={save}>Guardar cambios</Button>
      </div>
    </div>
  );
}




function EstablecimientoTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").eq("id", 1).maybeSingle()).data as unknown as Settings,
  });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (settings) setS({ ...settings, schedules: settings.schedules ?? {} });
  }, [settings]);
  if (!s) return null;
  const schedules = s.schedules ?? {};
  const setSched = (day: string, patch: Partial<Schedule>) =>
    setS({ ...s, schedules: { ...schedules, [day]: { ...(schedules[day] ?? { open: false, from: "10:00", to: "21:00" }), ...patch } } });

  async function save() {
    if (!s) return;
    const { error } = await supabase.from("settings").update({
      business_name: s.business_name, nit: s.nit, address: s.address, city: s.city,
      phone: s.phone, logo_url: s.logo_url, menu_link: s.menu_link,
      schedules: s.schedules as unknown as never,
      nequi_number: s.nequi_number, bancolombia_account: s.bancolombia_account,
    }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Cambios guardados");
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  async function handleLogoFile(file: File) {
    if (!s) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `logo-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("logos").upload(path, file, { upsert: true, contentType: file.type || `image/${ext}` });
      if (up.error) { toast.error(up.error.message); return; }
      const { data: signed } = await supabase.storage.from("logos").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      if (signed?.signedUrl) setS({ ...s, logo_url: signed.signedUrl });
      toast.success("Logo subido — recuerda guardar cambios");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div><Label>Nombre</Label><Input value={s.business_name ?? ""} onChange={(e) => setS({ ...s, business_name: e.target.value })} /></div>
          <div><Label>NIT</Label><Input value={s.nit ?? ""} onChange={(e) => setS({ ...s, nit: e.target.value })} /></div>
          <div><Label>Dirección</Label><Input value={s.address ?? ""} onChange={(e) => setS({ ...s, address: e.target.value })} /></div>
          <div><Label>Ciudad</Label><Input value={s.city ?? ""} onChange={(e) => setS({ ...s, city: e.target.value })} /></div>
          <div><Label>Teléfono (WhatsApp sede)</Label><Input value={s.phone ?? ""} onChange={(e) => setS({ ...s, phone: e.target.value })} /></div>
          <div><Label>Número Nequi</Label><Input value={s.nequi_number ?? ""} onChange={(e) => setS({ ...s, nequi_number: e.target.value })} placeholder="3001234567" /></div>
          <div><Label>Cuenta Bancolombia</Label><Input value={s.bancolombia_account ?? ""} onChange={(e) => setS({ ...s, bancolombia_account: e.target.value })} placeholder="123-456789-00" /></div>
          <div className="md:col-span-2">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              {s.logo_url ? (
                <img src={s.logo_url} alt="logo" className="h-16 w-16 rounded-lg border object-contain bg-white" />
              ) : (
                <div className="h-16 w-16 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground">Sin logo</div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/bmp,image/jpeg,image/webp,.png,.bmp,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = ""; }}
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Upload className="h-4 w-4 mr-1" />{uploading ? "Subiendo…" : (s.logo_url ? "Cambiar logo" : "Subir logo")}
              </Button>
              {s.logo_url && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setS({ ...s, logo_url: null })}>
                  Quitar
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Formatos: PNG, BMP, JPG o WEBP. Recuerda pulsar "Guardar cambios".</p>
          </div>
        </div>



        <div>
          <Label>Link del menú en línea</Label>
          <div className="flex gap-2">
            <Input
              disabled={false}
              value={s.menu_link ?? (typeof window !== "undefined" ? `${window.location.origin}/menu` : "")}
              onChange={(e) => setS({ ...s, menu_link: e.target.value })}
              placeholder="https://…"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                const url = s.menu_link || (typeof window !== "undefined" ? `${window.location.origin}/menu` : "");
                if (url) { navigator.clipboard.writeText(url); toast.success("Copiado"); }
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                const url = s.menu_link || (typeof window !== "undefined" ? `${window.location.origin}/menu` : "");
                if (url) window.open(url, "_blank");
              }}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Por defecto usa <span className="font-mono">/menu</span> de tu sitio publicado. Comparte este link en redes o WhatsApp.
          </p>
        </div>

        <div>
          <h3 className="font-medium mb-2">Horarios</h3>
          <div className="space-y-2">
            {DAYS.map((d) => {
              const sc = schedules[d.key] ?? { open: false, from: "10:00", to: "21:00" };
              return (
                <div key={d.key} className="grid grid-cols-[auto,1fr,auto,auto] items-center gap-3 rounded-lg border p-3">
                  <div className="flex items-center gap-2 w-28"><Switch disabled={false} checked={sc.open} onCheckedChange={(v) => setSched(d.key, { open: v })} /><span className="text-sm">{d.label}</span></div>
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

interface Printer { id: string; name: string; ip: string | null; port: number; platform: string; area: string; active: boolean; open_drawer_on_print?: boolean; }
function ImpresorasTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Printer> | null>(null);
  const { data = [] } = useQuery<Printer[]>({
    queryKey: ["printers"],
    queryFn: async () => (await supabase.from("printers").select("*").order("name")).data ?? [],
  });
  async function save() {
    const name = edit?.name?.trim();
    if (!name) return toast.error("El nombre es obligatorio");
    const ip = edit?.ip?.trim() || null;
    const payload = {
      name,
      ip,
      port: Number.isFinite(Number(edit?.port)) ? Number(edit?.port) : 9100,
      platform: edit?.platform ?? "Windows",
      area: edit?.area ?? "caja",
      active: edit?.active ?? true,
      open_drawer_on_print: edit?.open_drawer_on_print ?? false,
    };

    try {
      const res = edit?.id
        ? await supabase.from("printers").update(payload).eq("id", edit.id).select().single()
        : await supabase.from("printers").insert(payload).select().single();
      if (res.error) {
        console.error("printers save error", res.error);
        return toast.error(res.error.message ?? "No se pudo guardar la impresora");
      }
      toast.success(edit?.id ? "Impresora actualizada" : "Impresora agregada");
      setEdit(null);
      await qc.invalidateQueries({ queryKey: ["printers"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error inesperado";
      console.error(e);
      toast.error(msg);
    }
  }
  async function remove(id: string) { await supabase.from("printers").delete().eq("id", id); qc.invalidateQueries({ queryKey: ["printers"] }); }
  const [localUrl, setLocalUrl] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return window.localStorage.getItem("LOCAL_PRINT_URL") ?? ""; } catch { return ""; }
  });
  // Carga la URL persistida en la BD (settings.local_print_url) al montar,
  // así sobrevive a que se borre localStorage o se abra en otro navegador.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("settings")
        .select("id, local_print_url")
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const url = (data as { local_print_url?: string | null } | null)?.local_print_url ?? "";
      if (url) {
        setLocalUrl(url);
        try { window.localStorage.setItem("LOCAL_PRINT_URL", url); } catch { /* noop */ }
      }
    })();
    return () => { cancelled = true; };
  }, []);
  async function saveLocalUrl() {
    const value = localUrl.trim();
    try {
      if (value) window.localStorage.setItem("LOCAL_PRINT_URL", value);
      else window.localStorage.removeItem("LOCAL_PRINT_URL");
    } catch { /* noop */ }
    // Persistimos también en la BD para que no se pierda al cerrar el navegador.
    try {
      const { data: row } = await supabase.from("settings").select("id").limit(1).maybeSingle();
      if (row?.id) {
        const { error } = await supabase.from("settings").update({ local_print_url: value || null }).eq("id", row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("settings").insert({ local_print_url: value || null });
        if (error) throw error;
      }
      toast.success(value ? "Impresión silenciosa guardada" : "Impresión silenciosa desactivada");
    } catch (e) {
      console.error(e);
      toast.error("Guardado local, pero no se pudo sincronizar con la base de datos");
    }
  }

  async function testLocal() {
    const url = localUrl.trim();
    if (!url) return toast.error("Ingresa la URL primero");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "comanda", header: "PRUEBA", items: [{ name: "Test", qty: 1 }] }),
      });
      if (res.ok) toast.success("Servidor de impresión OK");
      else toast.error(`Servidor respondió ${res.status}`);
    } catch (e) {
      toast.error("No se pudo conectar al servidor local");
    }
  }
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
                <div className="rounded-md bg-muted/50 border p-2 text-xs text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">Compatibilidad de impresión</div>
                  <div>• <b>Windows:</b> instala el driver de la térmica como impresora predeterminada del navegador y los tickets se envían por diálogo de impresión.</div>
                  <div>• <b>Android:</b> usa una app puente (p.ej. RawBT) o asigna la térmica como impresora predeterminada del sistema; los tickets se envían vía hoja de impresión del navegador.</div>
                  <div>• La IP/puerto se guarda para impresoras de red ESC/POS.</div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={edit?.active ?? true} onCheckedChange={(v) => setEdit({ ...edit, active: v })} />
                  <Label>Activa</Label>
                </div>
                <div className="rounded-md border p-3 flex items-start justify-between gap-3">
                  <div>
                    <Label className="font-medium">Activar Apertura de Cajón Monedero</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Al imprimir un ticket de venta en esta impresora, se enviará el pulso ESC/POS para abrir la gaveta.
                      Las comandas de cocina <b>nunca</b> abrirán el cajón.
                    </p>
                  </div>
                  <Switch
                    checked={edit?.open_drawer_on_print ?? false}
                    onCheckedChange={(v) => setEdit({ ...edit, open_drawer_on_print: v })}
                  />
                </div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button><Button onClick={save}>Guardar</Button></DialogFooter>

            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-b p-4 space-y-3 bg-muted/30">
          <div className="font-medium text-sm">Impresión silenciosa (sin diálogo del navegador)</div>
          <p className="text-xs text-muted-foreground">
            Para evitar que aparezca la ventana de impresión de Chrome, ejecuta el servidor local <code className="bg-background px-1 rounded">print-server</code> en la PC con la térmica e ingresa su URL aquí. Si lo dejas vacío, el sistema usa el diálogo del navegador como respaldo.
          </p>
          <div className="flex gap-2">
            <Input value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder="http://localhost:3001/print" />
            <Button variant="outline" onClick={testLocal}>Probar</Button>
            <Button onClick={saveLocalUrl}>Guardar</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Alternativa sin servidor: abre Chrome con <code className="bg-background px-1 rounded">--kiosk-printing</code> y configura la térmica como impresora predeterminada del sistema.
          </p>
        </div>
        <CashierIpPrinterCard />
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
  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").eq("id", 1).maybeSingle()).data as unknown as Settings,
  });
  const [nequi, setNequi] = useState("");
  const [banco, setBanco] = useState("");
  useEffect(() => {
    const s = settings as unknown as { nequi_number?: string | null; bancolombia_account?: string | null } | null;
    setNequi(s?.nequi_number ?? "");
    setBanco(s?.bancolombia_account ?? "");
  }, [settings]);

  async function toggle(id: string, active: boolean) {
    await supabase.from("payment_methods").update({ active }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["payment_methods-all"] });
    qc.invalidateQueries({ queryKey: ["payment_methods"] });
  }

  async function saveNequi() {
    const clean = nequi.replace(/[^\d]/g, "").slice(0, 15);
    if (clean && clean.length < 7) return toast.error("Número Nequi inválido");
    const { error } = await supabase.from("settings").update({ nequi_number: clean || null }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Número Nequi guardado");
    setNequi(clean);
    qc.invalidateQueries({ queryKey: ["settings"] });
  }
  async function saveBanco() {
    const clean = banco.replace(/[^\d-]/g, "").slice(0, 25);
    if (clean && clean.replace(/\D/g, "").length < 6) return toast.error("Número de cuenta inválido");
    const { error } = await supabase.from("settings").update({ bancolombia_account: clean || null }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Cuenta Bancolombia guardada");
    setBanco(clean);
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Medios de pago</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {data.map((m: { id: string; name: string; active: boolean }) => {
          const isNequi = m.name.toLowerCase() === "nequi";
          const isBanco = m.name.toLowerCase() === "bancolombia";
          return (
            <div key={m.id} className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{m.name}</div>
                  {isBanco && <div className="text-xs text-muted-foreground">Ahorros</div>}
                </div>
                <Switch disabled={disabled} checked={m.active} onCheckedChange={(v) => toggle(m.id, v)} />
              </div>

              {isNequi && (
                <div className="space-y-1">
                  <Label className="text-xs">Número de Nequi</Label>
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder="Ej: 3001234567"
                      value={nequi}
                      onChange={(e) => setNequi(e.target.value.replace(/[^\d]/g, "").slice(0, 15))}
                      disabled={disabled}
                    />
                    <Button onClick={saveNequi} disabled={disabled}>Guardar</Button>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Se mostrará a los clientes en el Menú en Línea y en Modo Autopedido.
                  </div>
                </div>
              )}

              {isBanco && (
                <div className="space-y-1">
                  <Label className="text-xs">Número de cuenta Bancolombia</Label>
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder="Ej: 12345678901"
                      value={banco}
                      onChange={(e) => setBanco(e.target.value.replace(/[^\d-]/g, "").slice(0, 25))}
                      disabled={disabled}
                    />
                    <Button onClick={saveBanco} disabled={disabled}>Guardar</Button>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Cuenta de Ahorros · visible para clientes en el Menú en Línea y Modo Autopedido.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function DomicilioTab({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await supabase.from("settings").select("*").eq("id", 1).maybeSingle()).data as unknown as Settings,
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
        <Input type="number" disabled={false} value={fee} onChange={(e) => setFee(Number(e.target.value))} />
        {!disabled && <Button onClick={save}>Guardar</Button>}
      </CardContent>
    </Card>
  );
}

interface Branch {
  id: string; name: string; slug?: string | null; address: string | null; phone: string | null; city: string | null;
  is_main: boolean; inherits_main_catalog: boolean;
  neighborhood?: string | null; nit?: string | null;
  ticket_header?: string | null; ticket_footer?: string | null;
  report_email?: string | null;
  online_menu_url?: string | null;
  logo_url?: string | null;
  email?: string | null;
}


function SucursalesTab({ disabled, onEditBranch }: { disabled: boolean; onEditBranch?: (id: string) => void }) {
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
                  <div className="flex items-center justify-end gap-1">
                    {onEditBranch && (
                      <Button size="sm" variant="outline" onClick={() => onEditBranch(b.id)} className="gap-1">
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </Button>
                    )}
                    {!disabled && !b.is_main && (
                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(b)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Sin sucursales</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      <BranchLinksCard branches={data} />
    </Card>
  );
}

function BranchLinksCard({ branches }: { branches: Branch[] }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  function copy(url: string, label: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => toast.success(`${label} copiado`));
    }
  }
  if (branches.length === 0) return null;
  return (
    <div className="border-t p-4 space-y-4">
      <div>
        <div className="font-display text-lg flex items-center gap-2"><LinkIcon className="h-5 w-5" /> Enlaces independientes por sede</div>
        <p className="text-xs text-muted-foreground">Cada sede tiene sus propios links de menú en línea, kiosko y QRs de mesa. Los pedidos llegan únicamente al POS de esa sede.</p>
      </div>
      {branches.map((b) => {
        const sl = b.slug ?? "";
        const menu = `${origin}/menu?sede=${sl}`;
        const kiosk = `${origin}/kiosk?sede=${sl}`;
        return (
          <div key={b.id} className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <Building2 className="h-4 w-4 text-primary" /> {b.name}
              {b.is_main && <Badge variant="secondary"><Star className="h-3 w-3 mr-1" />Principal</Badge>}
              {!sl && <Badge variant="destructive" className="text-xs">Falta slug — guarda la sede</Badge>}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <Label className="text-xs">Menú en línea</Label>
                <div className="flex gap-1">
                  <Input readOnly value={menu} className="font-mono text-xs h-8" />
                  <Button size="sm" variant="outline" onClick={() => copy(menu, "Link de menú")}>Copiar</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs">Tablet Autopedido</Label>
                <div className="flex gap-1">
                  <Input readOnly value={kiosk} className="font-mono text-xs h-8" />
                  <Button size="sm" variant="outline" onClick={() => copy(kiosk, "Link de kiosko")}>Copiar</Button>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">QR de mesas: genéralos en <span className="font-mono">Mesas → Administrar</span> con la sede seleccionada.</p>
          </div>
        );
      })}
    </div>
  );
}


function EditarSedeTab({ initialBranchId }: { initialBranchId?: string | null } = {}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>(initialBranchId ?? "");
  const [form, setForm] = useState<Partial<Branch>>({});
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  async function handleLogoFile(file: File) {
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `branch-${selectedId || "new"}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("logos").upload(path, file, { upsert: true, contentType: file.type || `image/${ext}` });
      if (up.error) { toast.error(up.error.message); return; }
      const { data: signed } = await supabase.storage.from("logos").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      if (signed?.signedUrl) {
        setForm((f) => ({ ...f, logo_url: signed.signedUrl }));
        toast.success("Logo cargado — recuerda guardar cambios");
      }
    } finally {
      setUploadingLogo(false);
    }
  }

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: async () =>
      ((await supabase.from("branches").select("*").order("is_main", { ascending: false }).order("name")).data ?? []) as unknown as Branch[],
  });

  useEffect(() => {
    if (initialBranchId) setSelectedId(initialBranchId);
  }, [initialBranchId]);

  useEffect(() => {
    if (!selectedId && branches.length) {
      const main = branches.find((b) => b.is_main) ?? branches[0];
      setSelectedId(main.id);
    }
  }, [branches, selectedId]);

  useEffect(() => {
    const b = branches.find((x) => x.id === selectedId);
    if (b) setForm(b);
  }, [selectedId, branches]);

  async function save() {
    if (!selectedId) return;
    if (!form.name?.trim()) return toast.error("El nombre de la sede es obligatorio");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address ?? null,
        neighborhood: form.neighborhood ?? null,
        city: form.city ?? null,
        phone: form.phone ?? null,
        nit: form.nit ?? null,
        ticket_header: form.ticket_header ?? null,
        ticket_footer: form.ticket_footer ?? null,
        report_email: form.report_email ?? null,
        online_menu_url: form.online_menu_url?.trim() ? form.online_menu_url.trim() : null,
        logo_url: form.logo_url ?? null,
        email: form.email?.trim() ? form.email.trim() : null,
      };
      const { error } = await supabase.from("branches").update(payload as never).eq("id", selectedId);
      if (error) {
        toast.error(`Error al guardar: ${error.message}`);
        return;
      }
      toast.success("Información de la sede actualizada correctamente");
      await qc.invalidateQueries({ queryKey: ["branches"] });
      await qc.invalidateQueries({ queryKey: ["branches-all"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error inesperado";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Editar información de la Sede</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 p-6 pt-0">
        <div className="max-w-md">
          <Label>Seleccionar sede</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger><SelectValue placeholder="Selecciona una sede…" /></SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}{b.is_main ? " · Principal" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedId && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Nombre de la Sede</Label>
                <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sede Santa" />
              </div>
              <div>
                <Label>NIT / RUT</Label>
                <Input value={form.nit ?? ""} onChange={(e) => setForm({ ...form, nit: e.target.value })} placeholder="900123456-7" />
              </div>
              <div className="md:col-span-2">
                <Label>Dirección completa</Label>
                <Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Calle 6 # 10-46" />
              </div>
              <div>
                <Label>Barrio / Zona</Label>
                <Input value={form.neighborhood ?? ""} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} placeholder="Centro" />
              </div>
              <div>
                <Label>Ciudad</Label>
                <Input value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Cali" />
              </div>
              <div className="md:col-span-2">
                <Label>Teléfono / Celular</Label>
                <Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="311 448 6300" />
            </div>

            <div>
              <Label>Correo Electrónico para Reportes</Label>
              <p className="text-xs text-muted-foreground mb-2">A esta dirección se enviará automáticamente el reporte de cada cierre de caja de esta sede.</p>
              <Input type="email" value={form.report_email ?? ""} onChange={(e) => setForm({ ...form, report_email: e.target.value })} placeholder="reportes@goloso.com" />
            </div>

            <div>
              <Label>Correo Electrónico (ticket)</Label>
              <p className="text-xs text-muted-foreground mb-2">Aparecerá impreso como dato de contacto en los tickets emitidos por esta sede.</p>
              <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contacto@goloso.com" />
            </div>

            </div>

            <div>
              <Label>Logo de la Sede</Label>
              <p className="text-xs text-muted-foreground mb-2">Aparece centrado en la parte superior de los tickets impresos por esta sede. PNG, BMP, JPG o WEBP.</p>
              <div className="flex items-center gap-3">
                {form.logo_url ? (
                  <img src={form.logo_url} alt="logo sede" className="h-24 w-24 rounded-lg border object-contain bg-white" />
                ) : (
                  <div className="h-24 w-24 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground text-center px-2">Sin logo (se usa el global)</div>
                )}
                <input
                  ref={logoFileRef}
                  type="file"
                  accept="image/png,image/bmp,image/jpeg,image/webp,.png,.bmp,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = ""; }}
                />
                <div className="flex flex-col gap-2">
                  <Button type="button" variant="outline" onClick={() => logoFileRef.current?.click()} disabled={uploadingLogo}>
                    <Upload className="h-4 w-4 mr-1" />{uploadingLogo ? "Subiendo…" : (form.logo_url ? "Cambiar logo" : "Subir logo")}
                  </Button>
                  {form.logo_url && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, logo_url: null })}>
                      Quitar logo
                    </Button>
                  )}
                </div>
              </div>
            </div>


            <div>
              <Label className="flex items-center gap-2"><LinkIcon className="h-4 w-4" /> Enlace del Menú en Línea</Label>
              <p className="text-xs text-muted-foreground mb-2">URL pública e independiente del menú en línea de esta sede. Cada sucursal opera con su propio link.</p>
              <div className="flex gap-2">
                <Input
                  value={form.online_menu_url ?? ""}
                  onChange={(e) => setForm({ ...form, online_menu_url: e.target.value })}
                  placeholder="https://golosoheladeria.lovable.app/menu?sede=santa"
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const v = (form.online_menu_url ?? "").trim();
                    if (!v) return toast.error("No hay link para copiar");
                    if (typeof navigator !== "undefined" && navigator.clipboard) {
                      navigator.clipboard.writeText(v).then(() => toast.success("Link copiado al portapapeles"));
                    }
                  }}
                  className="gap-2 shrink-0"
                >
                  <LinkIcon className="h-4 w-4" /> Copiar Link
                </Button>
              </div>
            </div>
            <div>
              <Label>Encabezado del ticket (esta sede)</Label>
              <p className="text-xs text-muted-foreground mb-2">Líneas extra que se imprimirán en el encabezado del ticket para esta sucursal.</p>
              <Textarea rows={3} value={form.ticket_header ?? ""} onChange={(e) => setForm({ ...form, ticket_header: e.target.value })} placeholder="¡Bienvenido a Sede Santa!" />
            </div>


            <div>
              <Label>Pie de página del ticket (esta sede)</Label>
              <p className="text-xs text-muted-foreground mb-2">Mensaje final del ticket impreso para esta sucursal.</p>
              <Textarea rows={3} value={form.ticket_footer ?? ""} onChange={(e) => setForm({ ...form, ticket_footer: e.target.value })} placeholder="¡Gracias por visitarnos!&#10;@heladeriagoloso" />
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CashierIpPrinterCard() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings-cashier-printer"],
    queryFn: async () =>
      (await supabase.from("settings").select("cashier_printer_ip, cashier_printer_port").eq("id", 1).maybeSingle()).data as
        | { cashier_printer_ip: string | null; cashier_printer_port: number | null }
        | null,
  });
  const [ip, setIp] = useState("");
  const [port, setPort] = useState<number>(9100);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (data) {
      setIp(data.cashier_printer_ip ?? "");
      setPort(Number(data.cashier_printer_port ?? 9100));
    }
  }, [data]);

  async function save() {
    const { error } = await supabase
      .from("settings")
      .update({ cashier_printer_ip: ip.trim() || null, cashier_printer_port: Number(port) || 9100 } as never)
      .eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Impresora de caja guardada");
    qc.invalidateQueries({ queryKey: ["settings-cashier-printer"] });
  }

  async function testPrint() {
    if (!ip.trim()) return toast.error("Ingresa la IP primero");
    setTesting(true);
    try {
      const url = (typeof window !== "undefined" && window.localStorage.getItem("LOCAL_PRINT_URL")) || "";
      if (!url) {
        toast.error("Configura primero el servidor local de impresión arriba");
        return;
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "comprobante",
          ticket: 999,
          header: "PRUEBA IMPRESORA CAJA",
          items: [{ name: "Helado de prueba", qty: 1, unit_price: 5000 }],
          subtotal: 5000,
          total: 5000,
          printer_ip: ip.trim(),
          printer_port: Number(port) || 9100,
          cashierMessage: "Prueba de impresora de caja.",
        }),
      });
      if (res.ok) toast.success("Ticket de prueba enviado");
      else toast.error(`Error del servidor (${res.status})`);
    } catch {
      toast.error("No se pudo conectar al servidor local");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="border-b p-4 space-y-3 bg-muted/10">
      <div className="font-medium text-sm">Impresora de Caja (Red IP)</div>
      <p className="text-xs text-muted-foreground">
        Segunda impresora térmica de red para imprimir el <b>comprobante de pago</b> de los pedidos del Autopedido.
        Cuando un cliente envía un pedido desde la tablet, se imprime aquí un ticket con el detalle y el mensaje
        "Favor pasar a caja a cancelar antes de recibir su pedido". Requiere el servidor local de impresión configurado arriba.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-2">
          <Label className="text-xs">Dirección IP</Label>
          <Input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.60" />
        </div>
        <div>
          <Label className="text-xs">Puerto</Label>
          <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} placeholder="9100" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={testPrint} disabled={testing}>{testing ? "Enviando..." : "Probar"}</Button>
        <Button onClick={save}>Guardar</Button>
      </div>
    </div>
  );
}




function AutopedidoLinkTab() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [size, setSize] = useState(320);
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: async () =>
      ((await supabase.from("branches").select("*").order("is_main", { ascending: false }).order("name")).data ?? []) as unknown as Branch[],
  });

  useEffect(() => {
    if (!selectedId && branches.length) {
      const main = branches.find((b) => b.is_main) ?? branches[0];
      setSelectedId(main.id);
    }
  }, [branches, selectedId]);

  const branch = branches.find((b) => b.id === selectedId);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const slug = branch?.slug ?? "";
  const url = branch
    ? slug
      ? `${origin}/kiosk?sede=${encodeURIComponent(slug)}`
      : `${origin}/kiosk`
    : "";


  function copyLink() {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado al portapapeles");
  }

  function downloadQR() {
    const canvas = document.getElementById("kiosko-qr-canvas") as HTMLCanvasElement | null;
    if (!canvas) return toast.error("QR no disponible");
    const link = document.createElement("a");
    link.download = `kiosko-${branch?.slug ?? branch?.name ?? "qr"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function printQR() {
    const canvas = document.getElementById("kiosko-qr-canvas") as HTMLCanvasElement | null;
    if (!canvas) return toast.error("QR no disponible");
    const dataUrl = canvas.toDataURL("image/png");
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return toast.error("Permite ventanas emergentes para imprimir");
    w.document.write(`<!doctype html><html><head><title>QR Autopedido ${branch?.name ?? ""}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body { font-family: Arial, sans-serif; text-align: center; margin: 0; padding: 8px; }
        h2 { font-size: 16px; margin: 4px 0; }
        p { font-size: 11px; margin: 4px 0; word-break: break-all; }
        img { width: 70mm; height: 70mm; }
        .ftr { font-size: 12px; font-weight: bold; margin-top: 8px; }
      </style></head><body>
      <h2>${branch?.name ?? "Autopedido Autoservicio"}</h2>
      <p>Escanea para hacer tu pedido</p>
      <img src="${dataUrl}" />
      <p>${url}</p>
      <div class="ftr">— Heladería Goloso —</div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500);}</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Link de Autopedido (Autoservicio)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 p-6 pt-0">
        <div className="max-w-md">
          <Label>Sede</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger><SelectValue placeholder="Selecciona una sede…" /></SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " · Principal" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {branch && !branch.slug && (
            <p className="mt-2 text-xs text-amber-600">
              Esta sede no tiene "slug" definido. Se usará el enlace genérico. Define un slug en "Sucursales" para personalizarlo.
            </p>
          )}
        </div>

        {branch && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label>URL del Modo Autopedido</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={url} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button onClick={copyLink} variant="outline"><Copy className="h-4 w-4" />Copiar</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Abre esta URL en la tablet fija del autoservicio. Los pedidos llegarán como "Pendientes de pago" al POS de esta sede.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" asChild>
                  <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Abrir Autopedido</a>
                </Button>
                <Button onClick={downloadQR}><Download className="h-4 w-4" />Descargar QR</Button>
                <Button onClick={printQR} variant="secondary"><Printer className="h-4 w-4" />Imprimir QR</Button>
              </div>
              <div>
                <Label className="text-xs">Tamaño del QR (px)</Label>
                <Input type="number" min={160} max={800} step={16} value={size} onChange={(e) => setSize(Number(e.target.value) || 320)} />
              </div>
            </div>
            <div className="flex flex-col items-center justify-center rounded-lg border bg-white p-6 dark:bg-white">
              <QRCodeCanvas
                id="kiosko-qr-canvas"
                value={url}
                size={size}
                level="H"
                includeMargin
                bgColor="#ffffff"
                fgColor="#0e8a5a"
              />
              <p className="mt-3 text-xs text-center text-neutral-700">{branch.name}</p>
              <p className="text-[10px] text-center text-neutral-500 break-all max-w-[280px]">{url}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KdsLinkTab() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [size, setSize] = useState(320);
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: async () =>
      ((await supabase.from("branches").select("*").order("is_main", { ascending: false }).order("name")).data ?? []) as unknown as Branch[],
  });

  useEffect(() => {
    if (!selectedId && branches.length) {
      const main = branches.find((b) => b.is_main) ?? branches[0];
      setSelectedId(main.id);
    }
  }, [branches, selectedId]);

  const branch = branches.find((b) => b.id === selectedId);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const slug = branch?.slug ?? "";
  const url = branch && slug ? `${origin}/kds-live?sede=${encodeURIComponent(slug)}` : "";

  function copyLink() {
    if (!url) return;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado al portapapeles");
  }

  function downloadQR() {
    const canvas = document.getElementById("kds-qr-canvas") as HTMLCanvasElement | null;
    if (!canvas) return toast.error("QR no disponible");
    const link = document.createElement("a");
    link.download = `kds-${branch?.slug ?? branch?.name ?? "qr"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function printQR() {
    const canvas = document.getElementById("kds-qr-canvas") as HTMLCanvasElement | null;
    if (!canvas) return toast.error("QR no disponible");
    const dataUrl = canvas.toDataURL("image/png");
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return toast.error("Permite ventanas emergentes para imprimir");
    w.document.write(`<!doctype html><html><head><title>QR KDS ${branch?.name ?? ""}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body { font-family: Arial, sans-serif; text-align: center; margin: 0; padding: 8px; }
        h2 { font-size: 16px; margin: 4px 0; }
        p { font-size: 11px; margin: 4px 0; word-break: break-all; }
        img { width: 70mm; height: 70mm; }
        .ftr { font-size: 12px; font-weight: bold; margin-top: 8px; }
      </style></head><body>
      <h2>${branch?.name ?? "KDS Cocina"}</h2>
      <p>Pantalla de cocina (KDS)</p>
      <img src="${dataUrl}" />
      <p>${url}</p>
      <div class="ftr">— Heladería Goloso —</div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500);}</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" /> Link de KDS (Pantalla de Cocina)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 p-6 pt-0">
        <div className="max-w-md">
          <Label>Sede</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger><SelectValue placeholder="Selecciona una sede…" /></SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}{b.is_main ? " · Principal" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {branch && !branch.slug && (
            <p className="mt-2 text-xs text-amber-600">
              Esta sede no tiene "slug" definido. Define un slug en "Sucursales" para generar el enlace público del KDS.
            </p>
          )}
        </div>

        {branch && slug && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label>URL pública del KDS</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={url} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button onClick={copyLink} variant="outline"><Copy className="h-4 w-4" />Copiar</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Abre esta URL en la tablet o pantalla de cocina. <b>No requiere inicio de sesión</b>: muestra las comandas de la sede en tiempo real.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" asChild>
                  <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Abrir KDS</a>
                </Button>
                <Button onClick={downloadQR}><Download className="h-4 w-4" />Descargar QR</Button>
                <Button onClick={printQR} variant="secondary"><Printer className="h-4 w-4" />Imprimir QR</Button>
              </div>
              <div>
                <Label className="text-xs">Tamaño del QR (px)</Label>
                <Input type="number" min={160} max={800} step={16} value={size} onChange={(e) => setSize(Number(e.target.value) || 320)} />
              </div>
            </div>
            <div className="flex flex-col items-center justify-center rounded-lg border bg-white p-6 dark:bg-white">
              <QRCodeCanvas
                id="kds-qr-canvas"
                value={url}
                size={size}
                level="H"
                includeMargin
                bgColor="#ffffff"
                fgColor="#0e8a5a"
              />
              <p className="mt-3 text-xs text-center text-neutral-700">{branch.name} · KDS</p>
              <p className="text-[10px] text-center text-neutral-500 break-all max-w-[280px]">{url}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

