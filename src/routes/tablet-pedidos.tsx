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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Utensils, ShoppingBag, ArrowLeft, LogOut } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import { useRealtimeBranchSync } from "@/hooks/use-realtime-branch-sync";
import { BranchAutoDetectBadge } from "@/components/branch-auto-detect-badge";
import { useKioskLock } from "@/hooks/use-kiosk-lock";

import logoUrl from "@/assets/logo-goloso.webp";
import tableFree from "@/assets/mesa_libre.webp";
import tableOccupied from "@/assets/mesa_ocupada.webp";

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

type TabKey = "mesas" | "llevar";

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
  const { activeBranchId } = useBranch();
  // Mantener la suscripción realtime activa en TODA la sesión de tablet
  // (mesas, pedido en curso, etc.) para que el mapa de mesas ya esté
  // actualizado cuando el mesero regrese después de guardar un pedido.
  useRealtimeBranchSync(activeBranchId);
  const [tab, setTab] = useState<TabKey>("mesas");
  // Tablet de meseros: kiosco siempre activo (fullscreen automático al primer toque)
  useKioskLock(true);
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
      <header className="sticky top-0 z-20 flex h-14 md:h-16 items-center gap-2 md:gap-3 border-b bg-background/95 px-2 sm:px-4 backdrop-blur">
        <img src={logoUrl} alt="Goloso" className="h-8 w-8 md:h-10 md:w-10 object-contain shrink-0" />
        <div className="leading-tight min-w-0 hidden sm:block">
          <div className="font-display text-base md:text-lg truncate">Goloso · Meseros</div>
          <div className="text-[10px] md:text-xs text-muted-foreground truncate">Tablet de pedidos</div>
        </div>
        <div className="ml-1 md:ml-3 flex items-center gap-1 md:gap-2 min-w-0">
          <BranchSelector />
          <BranchAutoDetectBadge />
        </div>
        <div className="ml-auto flex items-center gap-2 md:gap-3 text-sm shrink-0">
          <div className="text-right leading-tight hidden md:block max-w-[160px]">
            <div className="font-medium truncate">{profile?.full_name ?? user?.email}</div>
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

      {/* Tabs principales — Mesero solo puede Mesas y Para llevar */}
      {!selected && (
        <nav className="sticky top-14 md:top-16 z-10 flex gap-1 border-b bg-background/95 px-2 sm:px-3 py-1.5 md:py-2 backdrop-blur">
          <TabButton active={tab === "mesas"} onClick={() => setTab("mesas")} icon={<Utensils className="h-4 w-4" />}>
            Mesas
          </TabButton>
          <TabButton active={tab === "llevar"} onClick={() => setTab("llevar")} icon={<ShoppingBag className="h-4 w-4" />}>
            Para llevar
          </TabButton>
        </nav>
      )}

      {selected && (
        <div className="sticky top-14 md:top-16 z-10 flex items-center gap-2 border-b bg-background/95 px-2 sm:px-3 py-1.5 md:py-2 backdrop-blur">
          <Button variant="ghost" size="sm" onClick={backToList}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
          <span className="text-xs md:text-sm text-muted-foreground truncate">{selected.title ?? "Pedido"}</span>
        </div>
      )}

      <main className="flex-1 p-2 sm:p-3 md:p-5 min-w-0 overflow-x-hidden">
        {!selected ? (
          tab === "mesas" ? (
            <MesasGrid
              onSelect={(m) => setSelected({ orderType: "mesa", tableId: m.id, title: m.label ?? `Mesa ${m.number}` })}
            />
          ) : (
            <QuickStart
              orderType="llevar"
              onStart={() =>
                setSelected({
                  orderType: "llevar",
                  title: "Para llevar",
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

  // Total en vivo del pedido activo por mesa. La key empieza con "sales" para
  // que useRealtimeBranchSync la invalide al agregar/eliminar ítems.
  const { data: mesaTotals = {} as Record<string, number> } = useQuery({
    queryKey: ["sales", "mesa-totals", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("table_id,total")
        .eq("branch_id", activeBranchId!)
        .not("table_id", "is", null)
        .not("status", "in", "(paid,cancelled)");
      const map: Record<string, number> = {};
      for (const r of (data ?? []) as { table_id: string; total: number | string | null }[]) {
        const t = Number(r.total ?? 0);
        map[r.table_id] = (map[r.table_id] ?? 0) + (Number.isFinite(t) ? t : 0);
      }
      return map;
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

  const [addToOccupied, setAddToOccupied] = useState<Mesa | null>(null);

  async function handleOpen(m: Mesa) {
    // No marcamos la mesa como ocupada al abrirla. La mesa cambia a
    // "ocupada" únicamente cuando se guarda un pedido con al menos un
    // producto (trigger DB `auto_occupy_table_on_sale_item`). Así, si el
    // mesero abre una mesa por error y sale sin agregar nada, la mesa
    // sigue mostrándose como Libre. Si ya está ocupada, pedimos
    // confirmación antes de agregar productos al pedido existente.
    if (m.status === "occupied") {
      setAddToOccupied(m);
      return;
    }
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
                  {occupied && (mesaTotals[m.id] ?? 0) > 0 && (
                    <div className="mt-2 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-center">
                      <div className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        Total pedido
                      </div>
                      <div className="font-display text-sm font-black tabular-nums text-emerald-700 dark:text-emerald-300">
                        {formatMoney(mesaTotals[m.id])}
                      </div>
                    </div>
                  )}
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

      <Dialog open={!!addToOccupied} onOpenChange={(o) => { if (!o) setAddToOccupied(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mesa {addToOccupied?.number} ya tiene un pedido activo</DialogTitle>
            <DialogDescription>
              ¿Desea agregar nuevos productos a este pedido? Los productos anteriores se conservan y solo se imprimirá una comanda con los productos recién agregados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToOccupied(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                const m = addToOccupied;
                setAddToOccupied(null);
                if (m) onSelect(m);
              }}
            >
              Sí, agregar productos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuickStart({
  orderType,
  onStart,
}: {
  orderType: "llevar";
  onStart: () => void;
}) {
  const label = "Para llevar";
  const Icon = ShoppingBag;

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
