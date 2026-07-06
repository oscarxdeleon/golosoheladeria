import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PosScreen } from "@/components/pos-screen";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, ArrowLeft, Bike, Phone, MapPin, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import domicilioMotoAsset from "@/assets/delivery-goloso.png.asset.json";
const domicilioMotoImg = domicilioMotoAsset.url;

export const Route = createFileRoute("/_authenticated/domicilio")({
  head: () => ({ meta: [{ title: "A domicilio · Goloso POS" }] }),
  component: () => (
    <BranchCashGuard extraMessage="Solicita al cajero iniciar el turno para poder operar.">
      <DeliveryFlow />
    </BranchCashGuard>
  ),
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="mx-auto max-w-lg p-6 text-center space-y-4">
        <h1 className="text-2xl font-display">No se pudo cargar A domicilio</h1>
        <p className="text-sm text-muted-foreground break-words">{error?.message}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => { reset(); router.invalidate(); }}>Reintentar</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/")}>Inicio</Button>
        </div>
      </div>
    );
  },
});

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  neighborhood: string | null;
  visits?: number | null;
}

interface Selected {
  name: string;
  phone: string;
  address: string;
  neighborhood: string;
}

function DeliveryFlow() {
  const [selected, setSelected] = useState<Selected | null>(null);

  if (!selected) {
    return <CustomerPicker onSelect={setSelected} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Cambiar cliente
        </Button>
        <div className="text-sm text-muted-foreground truncate">
          <b className="text-foreground">{selected.name}</b>
          {selected.phone && <> · {selected.phone}</>}
          {selected.neighborhood && <> · {selected.neighborhood}</>}
        </div>
      </div>
      <PosScreen
        orderType="domicilio"
        initialCustomer={selected.name}
        initialPhone={selected.phone}
        initialAddress={selected.address}
        initialNeighborhood={selected.neighborhood}
      />
    </div>
  );
}

function CustomerPicker({ onSelect }: { onSelect: (c: Selected) => void }) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"search" | "new">("search");
  const [form, setForm] = useState<Selected>({ name: "", phone: "", address: "", neighborhood: "" });
  const [saving, setSaving] = useState(false);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["customers-picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,phone,address,neighborhood,visits")
        .order("visits", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Customer[];
    },
  });

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers.slice(0, 30);
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          (c.phone ?? "").toLowerCase().includes(s) ||
          (c.neighborhood ?? "").toLowerCase().includes(s),
      )
      .slice(0, 50);
  }, [customers, q]);

  useEffect(() => {
    if (mode === "new" && q) setForm((f) => ({ ...f, name: /^\d/.test(q) ? f.name : q, phone: /^\d/.test(q) ? q : f.phone }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function saveNewAndContinue() {
    const name = form.name.trim();
    if (!name) return toast.error("Nombre requerido");
    if (!form.address.trim()) return toast.error("Dirección requerida");
    if (!form.phone.trim()) return toast.error("Teléfono requerido");
    setSaving(true);
    const { error } = await supabase.from("customers").insert({
      name,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      neighborhood: form.neighborhood.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Cliente guardado");
    onSelect({
      name,
      phone: form.phone.trim(),
      address: form.address.trim(),
      neighborhood: form.neighborhood.trim(),
    });
  }

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      {/* Encabezado premium compacto — la ilustración vive dentro del hero para
          ahorrar espacio vertical y que la búsqueda quede visible sin scroll. */}
      <div className="relative overflow-hidden rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-500/10 via-background to-background p-[1px] shadow-xl">
        <div className="relative rounded-[calc(1.5rem-1px)] bg-background/70 backdrop-blur-xl">
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                "radial-gradient(600px 180px at 100% -20%, color-mix(in oklab, #0284c7 22%, transparent), transparent 60%), radial-gradient(500px 180px at -10% 120%, color-mix(in oklab, #0284c7 16%, transparent), transparent 60%)",
            }}
          />
          <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-sky-700 dark:text-sky-300">
                <Bike className="h-3 w-3" /> Domicilios
              </div>
              <h1 className="font-display mt-1 text-lg sm:text-2xl font-extrabold tracking-tight leading-tight whitespace-nowrap bg-gradient-to-br from-foreground to-sky-600 bg-clip-text text-transparent">
                Nuevo pedido a domicilio
              </h1>
              <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
                Busca al cliente o registra uno nuevo para tomar el pedido.
              </p>
            </div>
            <img
              src={domicilioMotoImg}
              alt="Repartidor Goloso"
              className="h-32 w-auto sm:h-44 object-contain select-none drop-shadow-md mt-6 sm:mt-8 self-start -mr-2 sm:-mr-4"
              draggable={false}
            />
          </div>
        </div>
      </div>

      {mode === "search" ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Buscar por nombre o número de celular…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-9 h-11 text-base"
                />
              </div>
              <Button size="lg" className="gap-2" onClick={() => { setMode("new"); setForm({ name: /^\d/.test(q) ? "" : q, phone: /^\d/.test(q) ? q : "", address: "", neighborhood: "" }); }}>
                <UserPlus className="w-4 h-4" /> Nuevo cliente
              </Button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto rounded-lg border divide-y">
              {isLoading && <div className="p-4 text-sm text-muted-foreground">Cargando…</div>}
              {!isLoading && results.length === 0 && (
                <div className="p-6 text-center space-y-3">
                  <p className="text-sm text-muted-foreground">No se encontraron clientes.</p>
                  <Button onClick={() => { setMode("new"); setForm({ name: /^\d/.test(q) ? "" : q, phone: /^\d/.test(q) ? q : "", address: "", neighborhood: "" }); }} className="gap-2">
                    <UserPlus className="w-4 h-4" /> Registrar nuevo cliente
                  </Button>
                </div>
              )}
              {results.map((c) => (
                <button
                  key={c.id}
                  onClick={() =>
                    onSelect({
                      name: c.name,
                      phone: c.phone ?? "",
                      address: c.address ?? "",
                      neighborhood: c.neighborhood ?? "",
                    })
                  }
                  className="w-full text-left p-3 hover:bg-muted/60 transition flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      {c.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                      {c.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.address}</span>}
                      {c.neighborhood && <Badge variant="secondary" className="text-[10px]">{c.neighborhood}</Badge>}
                    </div>
                  </div>
                  {c.visits && c.visits > 0 ? (
                    <Badge variant="outline" className="shrink-0">{c.visits} pedidos</Badge>
                  ) : null}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg">Nuevo cliente</h2>
              <Button variant="ghost" size="sm" onClick={() => setMode("search")} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Buscar existente
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Nombre *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Teléfono *</Label>
                <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Dirección *</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Barrio</Label>
                <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMode("search")}>Cancelar</Button>
              <Button
                onClick={() =>
                  onSelect({
                    name: form.name.trim(),
                    phone: form.phone.trim(),
                    address: form.address.trim(),
                    neighborhood: form.neighborhood.trim(),
                  })
                }
                variant="secondary"
                disabled={!form.name.trim() || !form.address.trim() || !form.phone.trim()}
              >
                Continuar sin guardar
              </Button>
              <Button onClick={saveNewAndContinue} disabled={saving}>
                {saving ? "Guardando…" : "Guardar y continuar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
