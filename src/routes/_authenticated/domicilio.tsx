import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
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
import { VoiceMicButton } from "@/components/voice-input";

import domicilioMotoImg from "@/assets/delivery-goloso-3d.png";
import golosoLogo from "@/assets/goloso-logo-official.png";

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

  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-6 premium-scope">
      {/* Header compacto premium — alineado como Mesas / Para Llevar */}
      <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-white via-sky-50/70 to-emerald-50/60 dark:from-slate-900 dark:via-sky-950/40 dark:to-emerald-950/30 shadow-[0_18px_45px_-20px_rgba(2,132,199,0.35),inset_0_1px_0_rgba(255,255,255,0.95)] ring-1 ring-white/70 dark:ring-white/5">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(600px 180px at 92% -10%, rgba(132,204,22,0.18), transparent 60%), radial-gradient(500px 160px at -5% 110%, rgba(14,165,233,0.20), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-4 px-3 py-2.5 sm:px-5 sm:py-3">
          <img
            src={golosoLogo}
            alt="Heladería Goloso"
            width={1200}
            height={960}
            loading="eager"
            className="h-14 sm:h-16 md:h-20 w-auto object-contain select-none shrink-0 drop-shadow-[0_10px_14px_rgba(2,132,199,0.35)]"
            draggable={false}
          />

          <h1
            className="uppercase leading-[0.85] tracking-[-0.02em] text-4xl sm:text-5xl md:text-6xl bg-clip-text text-transparent select-none shrink-0"
            style={{
              fontFamily: '"Titan One", "Fredoka", system-ui, sans-serif',
              backgroundImage:
                "linear-gradient(180deg, #7dd3fc 0%, #0ea5e9 45%, #0369a1 100%)",
              WebkitTextStroke: "2px #ffffff",
              paintOrder: "stroke fill",
              filter:
                "drop-shadow(0 2px 0 rgba(255,255,255,0.95)) drop-shadow(0 8px 14px rgba(2,132,199,0.45))",
            }}
          >
            A Domicilio
          </h1>

          <div className="flex-1 flex justify-center">
            <img
              src={domicilioMotoImg}
              alt="Repartidor Goloso"
              loading="eager"
              className="h-20 sm:h-24 md:h-28 w-auto object-contain select-none drop-shadow-[0_12px_18px_rgba(2,132,199,0.35)]"
              draggable={false}
            />
          </div>

          <button
            type="button"
            onClick={() => navigate({ to: "/ajustes" })}
            className="grid h-10 w-10 place-items-center rounded-full bg-white dark:bg-white/10 text-emerald-600 ring-2 ring-emerald-400/70 shadow-[0_6px_14px_-6px_rgba(16,185,129,0.5)] transition hover:scale-110 active:scale-95 shrink-0"
            aria-label="Perfil"
          >
            <User className="h-5 w-5" />
          </button>
        </div>
      </div>

      {mode === "search" ? (
        <div className="space-y-4 animate-fade-in">
          {/* Buscador premium neumórfico */}
          <div className="flex gap-3 items-stretch">
            <div className="relative flex-1 group">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white to-sky-50/50 dark:from-slate-800 dark:to-slate-900 shadow-[0_10px_30px_-10px_rgba(2,132,199,0.25),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-slate-200/70 dark:ring-white/5 transition-shadow group-focus-within:shadow-[0_16px_40px_-10px_rgba(2,132,199,0.4),inset_0_1px_0_rgba(255,255,255,0.9)] group-focus-within:ring-sky-400/60" />
              <div className="relative flex items-center gap-2 px-4 py-1">
                <Search className="w-5 h-5 text-sky-600 shrink-0" strokeWidth={2.5} />
                <Input
                  autoFocus
                  placeholder="Buscar cliente por nombre o teléfono…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="flex-1 h-12 text-base border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-1 placeholder:text-slate-400"
                />
                <span className="hidden sm:inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-white/5">
                  F2
                </span>
                <VoiceMicButton
                  onTranscript={(t, isFinal) => { if (isFinal) setQ(t); }}
                  className="rounded-xl border-0 bg-gradient-to-br from-sky-500 to-emerald-500 text-white shadow-md hover:shadow-lg hover:brightness-110 transition"
                  title="Buscar por voz"
                />
              </div>
            </div>
            <Button
              size="lg"
              onClick={() => { setMode("new"); setForm({ name: /^\d/.test(q) ? "" : q, phone: /^\d/.test(q) ? q : "", address: "", neighborhood: "" }); }}
              className="h-auto gap-2 rounded-2xl bg-gradient-to-br from-sky-600 to-emerald-500 text-white font-bold shadow-[0_10px_25px_-8px_rgba(2,132,199,0.55)] hover:shadow-[0_14px_30px_-8px_rgba(2,132,199,0.7)] hover:brightness-105 active:scale-[0.98] transition"
            >
              <UserPlus className="w-4 h-4" /> Nuevo cliente
            </Button>
          </div>
          <Card className="rounded-2xl border-0 bg-white/80 dark:bg-slate-900/60 backdrop-blur shadow-[0_10px_30px_-15px_rgba(15,23,42,0.15)] ring-1 ring-slate-200/60 dark:ring-white/5">
            <CardContent className="p-3">


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
        </div>
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
