import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { reconcileTables } from "@/lib/reconcile-tables";
import { supabase } from "@/integrations/supabase/client";
import { BranchProvider, useBranch } from "@/contexts/branch-context";
import { BranchSelector } from "@/components/branch-selector";
import { PosScreen, type OrderType } from "@/components/pos-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Utensils, ShoppingBag, ArrowLeft, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import { useRealtimeBranchSync } from "@/hooks/use-realtime-branch-sync";
import { BranchAutoDetectBadge } from "@/components/branch-auto-detect-badge";

import logoUrl from "@/assets/logo-goloso.png";
import tableFree from "@/assets/mesa_libre.png";
import tableOccupied from "@/assets/mesa_ocupada.png";

export const Route = createFileRoute("/tablet-pedidos")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Tablet Meseros · Goloso POS" },
      { name: "apple-mobile-web-app-title", content: "Goloso Mesero" },
      { name: "application-name", content: "Goloso Mesero" },
    ],
    links: [{ rel: "manifest", href: "/manifest-mesero.webmanifest" }],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: TabletPage,
});

type TabKey = "mesas" | "llevar" | "domicilio";

interface Mesa {
  id: string;
  number: number;
  label: string | null;
  seats: number;
  status: "free" | "occupied" | "reserved";
  current_guests: number | null;
}

function TabletPage() {
  return (
    <BranchProvider>
      <TabletShell />
    </BranchProvider>
  );
}

function TabletShell() {
  const { profile, user } = useAuth();
  const [tab, setTab] = useState<TabKey>("mesas");
  const [selected, setSelected] = useState<
    | { orderType: OrderType; tableId?: string | null; title?: string }
    | null
  >(null);

  function backToList() {
    setSelected(null);
  }

  return (
    <BranchCashGuard allowLogout extraMessage="Tu tablet quedará disponible automáticamente cuando el cajero abra el turno.">
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
        <img src={logoUrl} alt="Goloso" className="h-10 w-10 object-contain" />
        <div className="leading-tight">
          <div className="font-display text-lg">Goloso · Meseros</div>
          <div className="text-xs text-muted-foreground">Tablet de pedidos</div>
        </div>
        <div className="ml-3 flex items-center gap-2">
          <BranchSelector />
          <BranchAutoDetectBadge />
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <div className="text-right leading-tight">
            <div className="font-medium">{profile?.full_name ?? user?.email}</div>
            <div className="text-xs text-muted-foreground">Mesero</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Tabs principales (Mesas / Para llevar / A domicilio) */}
      {!selected && (
        <nav className="sticky top-16 z-10 flex gap-1 border-b bg-background/95 px-3 py-2 backdrop-blur">
          <TabButton active={tab === "mesas"} onClick={() => setTab("mesas")} icon={<Utensils className="h-4 w-4" />}>
            Mesas
          </TabButton>
          <TabButton active={tab === "llevar"} onClick={() => setTab("llevar")} icon={<ShoppingBag className="h-4 w-4" />}>
            Para llevar
          </TabButton>
          <TabButton active={tab === "domicilio"} onClick={() => setTab("domicilio")} icon={<Bike className="h-4 w-4" />}>
            A domicilio
          </TabButton>
        </nav>
      )}

      {selected && (
        <div className="sticky top-16 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
          <Button variant="ghost" size="sm" onClick={backToList}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
          <span className="text-sm text-muted-foreground">{selected.title ?? "Pedido"}</span>
        </div>
      )}

      <main className="flex-1 p-3 md:p-5">
        {!selected ? (
          tab === "mesas" ? (
            <MesasGrid
              onSelect={(m) => setSelected({ orderType: "mesa", tableId: m.id, title: m.label ?? `Mesa ${m.number}` })}
            />
          ) : (
            <QuickStart
              orderType={tab}
              onStart={() =>
                setSelected({
                  orderType: tab,
                  title: tab === "llevar" ? "Para llevar" : "A domicilio",
                })
              }
            />
          )
        ) : (
          <PosScreen
            orderType={selected.orderType}
            tableId={selected.tableId ?? null}
            title={selected.title}
            meseroMode
            onSaved={backToList}
          />
        )}
      </main>

      <footer className="border-t bg-muted/30 px-4 py-2 text-center text-[11px] text-muted-foreground">
        Modo Tablet · Sólo registro de pedidos. Los cobros se realizan en caja.
        {" · "}
        <Link to="/" className="underline">Acceso completo</Link>
      </footer>
    </div>
    </BranchCashGuard>
  );
}

function TabButton({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-primary text-primary-foreground shadow"
          : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function MesasGrid({ onSelect }: { onSelect: (m: Mesa) => void }) {
  const qc = useQueryClient();
  const { activeBranchId, activeBranch } = useBranch();

  useRealtimeBranchSync(activeBranchId);

  const { data: mesas = [] } = useQuery({
    queryKey: ["restaurant_tables", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("restaurant_tables")
        .select("*")
        .eq("active", true)
        .eq("branch_id", activeBranchId!)
        .order("number");
      return (data ?? []) as Mesa[];
    },
  });

  useEffect(() => {
    if (!activeBranchId) return;
    let cancelled = false;
    const run = async () => {
      const fixed = await reconcileTables(activeBranchId, { silent: true });
      if (!cancelled && fixed > 0) {
        void qc.invalidateQueries({ queryKey: ["restaurant_tables", activeBranchId] });
      }
    };
    void run();
    const onOnline = () => void run();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [activeBranchId, qc]);

  const counts = mesas.reduce(
    (a, m) => {
      a[m.status] += 1;
      return a;
    },
    { free: 0, occupied: 0, reserved: 0 } as Record<Mesa["status"], number>,
  );

  async function handleOpen(m: Mesa) {
    // No marcamos la mesa como ocupada al abrirla. La mesa cambia a
    // "ocupada" únicamente cuando se guarda un pedido con al menos un
    // producto (trigger DB `auto_occupy_table_on_sale_item`). Así, si el
    // mesero abre una mesa por error y sale sin agregar nada, la mesa
    // sigue mostrándose como Libre.
    onSelect(m);
  }


  if (!activeBranchId) {
    return <p className="text-center text-sm text-muted-foreground py-10">Selecciona una sede para ver las mesas.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl">Mapa de mesas</h1>
          <p className="text-sm text-muted-foreground">
            {activeBranch?.name ?? ""} · Toca una mesa para tomar el pedido
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Libres: {counts.free}</Badge>
          <Badge className="bg-destructive text-destructive-foreground">Ocupadas: {counts.occupied}</Badge>
          <Badge variant="outline">Reservadas: {counts.reserved}</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {mesas.map((m) => {
              const occupied = m.status === "occupied";
              const reserved = m.status === "reserved";
              return (
                <button
                  key={m.id}
                  onClick={() => handleOpen(m)}
                  className={`relative flex flex-col items-center rounded-2xl border-2 p-3 transition hover:shadow-lg active:scale-[0.98] ${
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
                  <div className="mt-2 font-display text-4xl font-bold leading-none">{m.number}</div>
                  <Badge
                    variant={occupied ? "destructive" : reserved ? "outline" : "secondary"}
                    className="mt-2"
                  >
                    {occupied ? "Ocupada" : reserved ? "Reservada" : "Libre"}
                  </Badge>
                </button>
              );
            })}
            {mesas.length === 0 && (
              <div className="col-span-full text-center text-sm text-muted-foreground py-12">
                Sin mesas configuradas para esta sede.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuickStart({
  orderType,
  onStart,
}: {
  orderType: "llevar" | "domicilio";
  onStart: () => void;
}) {
  const label = orderType === "llevar" ? "Para llevar" : "A domicilio";
  const Icon = orderType === "llevar" ? ShoppingBag : Bike;
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Icon className="h-8 w-8" />
        </div>
        <h2 className="font-display text-2xl">Nuevo pedido · {label}</h2>
        <p className="text-sm text-muted-foreground">
          Crea un nuevo pedido {label.toLowerCase()}. Se enviará a cocina y al KDS al guardarlo.
        </p>
        <Button size="lg" className="w-full" onClick={onStart}>
          Iniciar pedido
        </Button>
      </CardContent>
    </Card>
  );
}
