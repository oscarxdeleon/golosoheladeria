import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { reconcileTables } from "@/lib/reconcile-tables";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, QrCode, Copy, Download, LogOut, ArrowRightLeft, ShoppingBag, Bike, Link2, Unlink, X, Check, ArrowRight, Utensils, Search, Mic, User } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/branch-context";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import { useRealtimeBranchSync } from "@/hooks/use-realtime-branch-sync";
import mesaLibreImg from "@/assets/mesa_libre.webp";
import mesaOcupadaImg from "@/assets/mesa_ocupada.webp";
import golosoCharacter from "@/assets/goloso-character-official.webp";
import golosoLogo from "@/assets/goloso-logo-official.webp";
import takeawayImg from "@/assets/takeaway-goloso-3d.webp";
import deliveryImg from "@/assets/delivery-goloso-3d.webp";

export const Route = createFileRoute("/_authenticated/mesas")({
  head: () => ({ meta: [{ title: "Mesas · Goloso POS" }] }),
  component: MesasPage,
});

type Status = "free" | "occupied" | "reserved" | "merged";
interface Mesa {
  id: string;
  number: number;
  label: string | null;
  seats: number;
  status: Status;
  current_guests: number | null;
  occupied_at: string | null;
  notes: string | null;
  merged_into_id: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  free: "Libre",
  occupied: "Ocupada",
  reserved: "Reservada",
  merged: "Fusionada",
};

// El número siempre se pinta en un azul premium para máxima legibilidad y
// consistencia visual, sin importar el estado. El estado se comunica con la
// franja superior, el chip y el punto animado.
const TABLE_NUMBER_COLOR = "text-sky-600 dark:text-sky-400";

const STATUS_STYLES: Record<Status, {
  bg: string; bar: string; dot: string; chip: string; num: string; glow: string;
}> = {
  free: {
    bg: "bg-emerald-50/50 dark:bg-emerald-950/25 ring-1 ring-emerald-500/15 hover:ring-emerald-500/45",
    bar: "bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500",
    dot: "bg-emerald-500 shadow-[0_0_10px_var(--tw-shadow-color)] shadow-emerald-500/60",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    num: TABLE_NUMBER_COLOR,
    glow: "bg-emerald-400/25",
  },
  occupied: {
    bg: "bg-rose-50/60 dark:bg-rose-950/25 ring-1 ring-rose-500/20 hover:ring-rose-500/50",
    bar: "bg-gradient-to-r from-rose-500 via-red-500 to-orange-500",
    dot: "bg-rose-500 shadow-[0_0_10px_var(--tw-shadow-color)] shadow-rose-500/70",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    num: TABLE_NUMBER_COLOR,
    glow: "bg-rose-400/25",
  },
  reserved: {
    bg: "bg-amber-50/60 dark:bg-amber-950/25 ring-1 ring-amber-500/20 hover:ring-amber-500/50",
    bar: "bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-500",
    dot: "bg-amber-500 shadow-[0_0_10px_var(--tw-shadow-color)] shadow-amber-500/60",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    num: TABLE_NUMBER_COLOR,
    glow: "bg-amber-400/25",
  },
  merged: {
    bg: "bg-violet-50/60 dark:bg-violet-950/25 ring-1 ring-violet-500/20 hover:ring-violet-500/50",
    bar: "bg-gradient-to-r from-violet-500 via-purple-500 to-fuchsia-500",
    dot: "bg-violet-500 shadow-[0_0_10px_var(--tw-shadow-color)] shadow-violet-500/60",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    num: TABLE_NUMBER_COLOR,
    glow: "bg-violet-400/25",
  },
};

const STAT_CHIP_STYLES: Record<"emerald" | "rose" | "amber", string> = {
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
};

function StatChip({ color, label, value }: { color: "emerald" | "rose" | "amber"; label: string; value: number }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 backdrop-blur ${STAT_CHIP_STYLES[color]}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current`} />
      <span className="uppercase tracking-wider">{label}</span>
      <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-[11px] font-bold text-foreground">{value}</span>
    </div>
  );
}

function UsersMini() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MesasPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const [createOpen, setCreateOpen] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newSeats, setNewSeats] = useState("4");
  const [qrMesa, setQrMesa] = useState<Mesa | null>(null);
  const [releaseMesa, setReleaseMesa] = useState<Mesa | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [moveFrom, setMoveFrom] = useState<Mesa | null>(null);
  const [moveTarget, setMoveTarget] = useState<Mesa | null>(null);
  const [moving, setMoving] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<string[]>([]);
  const [mergePrincipal, setMergePrincipal] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [splitTarget, setSplitTarget] = useState<Mesa | null>(null);
  const [search, setSearch] = useState("");
  const [addToOccupied, setAddToOccupied] = useState<Mesa | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

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

  // Autocorrección al abrir el módulo de mesas y al reconectarse.
  useEffect(() => {
    if (!activeBranchId) return;
    let cancelled = false;
    const run = async () => {
      const fixed = await reconcileTables(activeBranchId, { silent: false });
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
    (acc, m) => {
      acc[m.status] += 1;
      return acc;
    },
    { free: 0, occupied: 0, reserved: 0 } as Record<Status, number>,
  );

  const filteredMesas = search.trim()
    ? mesas.filter((m) => {
        const q = search.trim().toLowerCase();
        return String(m.number).includes(q) || (m.label ?? "").toLowerCase().includes(q);
      })
    : mesas;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>('input[aria-label="Buscar mesa"]');
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function openMesa(m: Mesa) {
    // La mesa solo cambia a "ocupada" cuando se guarda un pedido con al menos un producto
    // (lo gestiona el trigger de DB sobre sale_items). Si ya está ocupada,
    // pedimos confirmación antes de agregar productos al pedido existente.
    if (m.status === "occupied") {
      setAddToOccupied(m);
      return;
    }
    navigate({ to: "/pos", search: { type: "mesa", tableId: m.id } });
  }


  async function confirmRelease() {
    if (!releaseMesa) return;
    if (releaseReason.trim().length < 3) {
      return toast.error("Ingresa un motivo (mínimo 3 caracteres)");
    }
    setReleasing(true);
    const { error } = await supabase.rpc("release_table", {
      _table_id: releaseMesa.id,
      _reason: releaseReason.trim(),
    });
    setReleasing(false);
    if (error) return toast.error(error.message);
    toast.success(`Mesa ${releaseMesa.number} liberada`);
    setReleaseMesa(null);
    setReleaseReason("");
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  async function doMove(force = false) {
    if (!moveFrom || !moveTarget) return;
    setMoving(true);
    const { error } = await supabase.rpc("move_table", {
      _from_table_id: moveFrom.id,
      _to_table_id: moveTarget.id,
      _reason: undefined,
      _force: force,
    });
    setMoving(false);
    if (error) {
      if (error.message.includes("destination_occupied")) {
        if (confirm(`La mesa ${moveTarget.number} ya tiene un pedido activo. ¿Deseas continuar y fusionar?`)) {
          return doMove(true);
        }
        return;
      }
      return toast.error(error.message);
    }
    toast.success(`Pedido movido a Mesa ${moveTarget.number}`);
    setMoveFrom(null);
    setMoveTarget(null);
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  function cancelMerge() {
    setMergeMode(false);
    setMergeSelected([]);
    setMergePrincipal(null);
  }

  function toggleMergeSelect(m: Mesa) {
    if (m.status === "merged") return;
    setMergeSelected((prev) =>
      prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id],
    );
    setMergePrincipal((p) => (p && !mergeSelected.includes(p) ? p : p));
  }

  async function confirmMerge() {
    if (!mergePrincipal) return toast.error("Selecciona la mesa principal");
    const sources = mergeSelected.filter((id) => id !== mergePrincipal);
    if (sources.length === 0) return toast.error("Selecciona al menos una mesa a fusionar");
    setMerging(true);
    const { error } = await supabase.rpc("merge_tables", {
      _principal_id: mergePrincipal,
      _source_ids: sources,
      _reason: undefined,
    });
    setMerging(false);
    if (error) return toast.error(error.message);
    toast.success("Mesas fusionadas");
    cancelMerge();
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  async function confirmSplit() {
    if (!splitTarget) return;
    const { error } = await supabase.rpc("split_merged_tables", {
      _principal_id: splitTarget.id,
      _reason: undefined,
    });
    if (error) return toast.error(error.message);
    toast.success("Mesas separadas");
    setSplitTarget(null);
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  async function eliminar(m: Mesa, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Eliminar Mesa ${m.number}?`)) return;
    await supabase.from("restaurant_tables").update({ active: false }).eq("id", m.id);
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
    toast.success("Mesa eliminada");
  }

  async function createMesa() {
    const n = Number(newNumber);
    if (!n) return toast.error("Número de mesa requerido");
    if (!activeBranchId) return toast.error("Selecciona una sede primero");
    const { error } = await supabase.from("restaurant_tables").insert({
      number: n,
      label: `Mesa ${n}`,
      seats: Number(newSeats) || 4,
      pos_x: mesas.length % 4,
      pos_y: Math.floor(mesas.length / 4),
      branch_id: activeBranchId,
    });
    if (error) return toast.error(error.message);
    toast.success("Mesa creada");
    setCreateOpen(false);
    setNewNumber("");
    setNewSeats("4");
    qc.invalidateQueries({ queryKey: ["restaurant_tables"] });
  }

  return (
    <BranchCashGuard>
    <div className="space-y-3 premium-scope">
      {/* Header premium compacto — Personaje + Logo + MESAS + buscador + usuario */}
      <div className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-white via-sky-50/70 to-emerald-50/60 dark:from-slate-900 dark:via-sky-950/40 dark:to-emerald-950/30 shadow-[0_18px_45px_-20px_rgba(2,132,199,0.35),inset_0_1px_0_rgba(255,255,255,0.95)] ring-1 ring-white/70 dark:ring-white/5">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(600px 180px at 92% -10%, rgba(132,204,22,0.18), transparent 60%), radial-gradient(500px 160px at -5% 110%, rgba(14,165,233,0.20), transparent 60%)",
          }}
        />

        <div className="relative flex flex-wrap items-center gap-3 px-3 py-2.5 sm:px-5 sm:py-3">
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
            className="uppercase leading-[0.85] tracking-[-0.02em] text-5xl sm:text-6xl md:text-7xl bg-clip-text text-transparent select-none shrink-0 flex items-center"
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
            Mesas
          </h1>

          <div className="flex-1" />

          <div className="hidden md:flex flex-wrap gap-1.5">
            <StatChip color="emerald" label="Libres" value={counts.free} />
            <StatChip color="rose" label="Ocupadas" value={counts.occupied} />
            <StatChip color="amber" label="Reservadas" value={counts.reserved} />
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

        {/* Segunda línea: botones compactos Para llevar / A domicilio */}
        <div className="relative grid grid-cols-2 gap-2.5 px-3 pb-3 sm:px-5 sm:pb-3.5">
          <button
            onClick={() => navigate({ to: "/llevar" })}
            className="group relative overflow-hidden rounded-xl px-3 py-2 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-14px_rgba(249,115,22,0.55)] shadow-[0_8px_18px_-10px_rgba(249,115,22,0.4),inset_0_1px_0_rgba(255,255,255,0.4)] ring-1 ring-orange-300/40"
            style={{ background: "linear-gradient(135deg, #fb923c 0%, #f97316 45%, #ea580c 100%)" }}
          >
            <div className="pointer-events-none absolute -bottom-6 -right-4 h-20 w-20 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/25 ring-1 ring-white/40 shrink-0">
                <ShoppingBag className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm sm:text-base font-black uppercase text-white leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]">
                  Para llevar
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/85">Rápido</div>
              </div>
              <ArrowRight className="h-4 w-4 text-white shrink-0 transition group-hover:translate-x-0.5" />
            </div>
          </button>

          <button
            onClick={() => navigate({ to: "/domicilio" })}
            className="group relative overflow-hidden rounded-xl px-3 py-2 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-14px_rgba(2,132,199,0.55)] shadow-[0_8px_18px_-10px_rgba(2,132,199,0.4),inset_0_1px_0_rgba(255,255,255,0.4)] ring-1 ring-sky-300/40"
            style={{ background: "linear-gradient(135deg, #38bdf8 0%, #0284c7 45%, #0369a1 100%)" }}
          >
            <div className="pointer-events-none absolute -bottom-6 -right-4 h-20 w-20 rounded-full bg-white/15 blur-2xl" />
            <div className="relative flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/25 ring-1 ring-white/40 shrink-0">
                <Bike className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm sm:text-base font-black uppercase text-white leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]">
                  A domicilio
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/85">Delivery</div>
              </div>
              <ArrowRight className="h-4 w-4 text-white shrink-0 transition group-hover:translate-x-0.5" />
            </div>
          </button>
        </div>

        <div className="relative flex md:hidden flex-wrap gap-1.5 px-3 pb-3">
          <StatChip color="emerald" label="Libres" value={counts.free} />
          <StatChip color="rose" label="Ocupadas" value={counts.occupied} />
          <StatChip color="amber" label="Reservadas" value={counts.reserved} />
        </div>
      </div>



      {/* Barra de acciones: fusionar/separar mesas + crear */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!mergeMode ? (
          <Button size="sm" variant="outline" onClick={() => setMergeMode(true)}>
            <Link2 className="h-4 w-4" /> Fusionar mesas
          </Button>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">
              {mergeSelected.length === 0
                ? "Toca las mesas a fusionar y elige la principal"
                : mergePrincipal
                  ? `Principal: Mesa ${mesas.find((x) => x.id === mergePrincipal)?.number} · ${mergeSelected.length} seleccionadas`
                  : `${mergeSelected.length} seleccionadas · elige la principal`}
            </span>
            <Button size="sm" variant="ghost" onClick={cancelMerge}>
              <X className="h-4 w-4" /> Cancelar
            </Button>
            <Button
              size="sm"
              onClick={confirmMerge}
              disabled={merging || !mergePrincipal || mergeSelected.length < 2}
            >
              <Check className="h-4 w-4" /> Fusionar
            </Button>
          </>
        )}
        {isAdmin && !mergeMode && (
          <Button size="sm" onClick={() => setCreateOpen(true)} className="shadow-md">
            <Plus className="h-4 w-4" /> Nueva mesa
          </Button>
        )}
      </div>



      {/* Grid de mesas sin recuadro externo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {filteredMesas.map((m) => {
          const status = m.status;
          const styles = STATUS_STYLES[status];
          const selected = mergeSelected.includes(m.id);
          const isPrincipal = mergePrincipal === m.id;
          const hasMerged = mesas.some((x) => x.merged_into_id === m.id);
          return (
            <button
              key={m.id}
              onClick={() => {
                if (mergeMode) {
                  if (!selected) toggleMergeSelect(m);
                  else if (!isPrincipal) setMergePrincipal(m.id);
                  else setMergePrincipal(null);
                  return;
                }
                openMesa(m);
              }}
              className={`group relative flex flex-col items-center overflow-hidden rounded-2xl p-4 text-left transition-all duration-300 hover:-translate-y-1 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${styles.bg} ${
                mergeMode && selected ? "ring-4 ring-violet-500/80" : ""
              } ${isPrincipal ? "ring-4 ring-amber-400" : ""}`}
              aria-label={`Mesa ${m.number} ${STATUS_LABEL[status]}`}
            >
              {/* franja superior de estado */}
              <span className={`absolute inset-x-0 top-0 h-1 ${styles.bar}`} aria-hidden />
              {/* halo suave */}
              <span className={`pointer-events-none absolute -inset-12 opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-60 ${styles.glow}`} aria-hidden />

              {/* dot de estado */}
              <div className="flex w-full items-start justify-between">
                <span className={`relative inline-flex h-2.5 w-2.5 items-center justify-center rounded-full ${styles.dot}`} aria-hidden>
                  {status === "occupied" && (
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${styles.dot}`} />
                  )}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles.chip}`}>
                  {STATUS_LABEL[status]}
                </span>
              </div>

              {/* imagen de la mesa + número */}
              <div className="my-2 flex flex-col items-center">
                <img
                  src={status === "occupied" ? mesaOcupadaImg : mesaLibreImg}
                  alt={status === "occupied" ? "Mesa ocupada" : "Mesa libre"}
                  className="h-24 w-24 object-contain drop-shadow-none select-none"
                  draggable={false}
                />
                <div className={`mt-1 font-display text-4xl font-black leading-none tracking-tight tabular-nums drop-shadow-[0_1px_0_rgba(2,132,199,0.15)] ${styles.num}`}>
                  {m.number}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <UsersMini />
                  <span>{m.seats} puestos</span>
                </div>
              </div>

              {/* acciones flotantes */}
              {status === "occupied" && (
                <div className="mt-1 flex w-full flex-wrap items-center justify-center gap-1.5">
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); setMoveFrom(m); }}
                    className="inline-flex items-center gap-1 rounded-lg bg-background/80 px-2 py-1 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur transition hover:bg-background"
                    title="Mover mesa"
                  >
                    <ArrowRightLeft className="h-3 w-3" /> Mover
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); setReleaseMesa(m); setReleaseReason(""); }}
                    className="inline-flex items-center gap-1 rounded-lg bg-background/80 px-2 py-1 text-[11px] font-semibold text-destructive shadow-sm backdrop-blur transition hover:bg-background"
                    title="Liberar mesa"
                  >
                    <LogOut className="h-3 w-3" /> Liberar
                  </span>
                  {hasMerged && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); setSplitTarget(m); }}
                      className="inline-flex items-center gap-1 rounded-lg bg-violet-500/10 px-2 py-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300 shadow-sm backdrop-blur transition hover:bg-violet-500/20"
                      title="Separar mesas fusionadas"
                    >
                      <Unlink className="h-3 w-3" /> Separar
                    </span>
                  )}
                </div>
              )}

              {/* icono QR discreto */}
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setQrMesa(m); }}
                className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-lg bg-background/70 text-foreground/70 opacity-0 shadow-sm backdrop-blur transition hover:bg-background hover:text-foreground group-hover:opacity-100"
                aria-label="QR de la mesa"
                title="QR para pedir desde el teléfono"
              >
                <QrCode className="h-3.5 w-3.5" />
              </span>
              {isAdmin && (
                <span
                  role="button"
                  onClick={(e) => eliminar(m, e)}
                  className="absolute bottom-2 left-2 grid h-7 w-7 place-items-center rounded-lg bg-background/70 text-destructive opacity-0 shadow-sm backdrop-blur transition hover:bg-background group-hover:opacity-100"
                  aria-label="Eliminar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          );
        })}
        {mesas.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border/60 bg-muted/30 py-16 text-center text-sm text-muted-foreground">
            Sin mesas. {isAdmin ? "Crea la primera desde el botón superior." : "Pide a un admin que cree mesas."}
          </div>
        )}
      </div>


      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva mesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Número</label>
              <Input
                type="number"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Puestos</label>
              <Input
                type="number"
                value={newSeats}
                onChange={(e) => setNewSeats(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createMesa}>Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrMesa} onOpenChange={(o) => !o && setQrMesa(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>QR · {qrMesa?.label ?? `Mesa ${qrMesa?.number}`}</DialogTitle>
            <DialogDescription>
              El cliente escanea con su teléfono y pide directamente desde la mesa.
            </DialogDescription>
          </DialogHeader>
          {qrMesa && (
            <div className="flex flex-col items-center gap-3">
              <div id={`mesa-qr-${qrMesa.number}`} className="rounded-xl border bg-white p-4">
                <QRCodeCanvas value={`${origin}/t/${qrMesa.number}`} size={220} level="M" />
              </div>
              <div className="text-xs text-muted-foreground break-all text-center font-mono">
                {origin}/t/{qrMesa.number}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(`${origin}/t/${qrMesa.number}`);
                    toast.success("Link copiado");
                  }}
                >
                  <Copy className="h-4 w-4" /> Copiar link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const canvas = document.querySelector<HTMLCanvasElement>(`#mesa-qr-${qrMesa.number} canvas`);
                    if (!canvas) return;
                    const a = document.createElement("a");
                    a.href = canvas.toDataURL("image/png");
                    a.download = `mesa-${qrMesa.number}-qr.png`;
                    a.click();
                  }}
                >
                  <Download className="h-4 w-4" /> Descargar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center px-2">
                Imprime el QR y pégalo sobre la mesa. Imprime una etiqueta resistente al agua.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Release with mandatory reason */}
      <Dialog open={!!releaseMesa} onOpenChange={(o) => { if (!o) { setReleaseMesa(null); setReleaseReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar Mesa {releaseMesa?.number}</DialogTitle>
            <DialogDescription>
              Ingrese el motivo por el cual desea liberar o cancelar esta mesa. El pedido pendiente se cancelará.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo <span className="text-destructive">*</span></label>
            <Textarea
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              placeholder="Ej: Cliente se retiró sin consumir, error de mesera, mesa marcada por error..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseMesa(null)} disabled={releasing}>
              Cancelar acción
            </Button>
            <Button variant="destructive" onClick={confirmRelease} disabled={releasing || releaseReason.trim().length < 3}>
              Confirmar liberación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar adición de productos a mesa ocupada */}
      <Dialog open={!!addToOccupied} onOpenChange={(o) => { if (!o) setAddToOccupied(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mesa {addToOccupied?.number} ya tiene un pedido activo</DialogTitle>
            <DialogDescription>
              ¿Qué desea hacer? Puede agregar nuevos productos al pedido existente (solo se imprimirá una comanda con los productos recién agregados) o ir directamente a cobrar la mesa.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setAddToOccupied(null)}>Cancelar</Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                onClick={() => {
                  const m = addToOccupied;
                  setAddToOccupied(null);
                  if (m) navigate({ to: "/pos", search: { type: "mesa", tableId: m.id } });
                }}
              >
                Agregar productos
              </Button>
              <Button
                onClick={() => {
                  const m = addToOccupied;
                  setAddToOccupied(null);
                  if (m) navigate({ to: "/pos", search: { type: "mesa", tableId: m.id } });
                }}
              >
                Cobrar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move table */}
      <Dialog open={!!moveFrom} onOpenChange={(o) => { if (!o) { setMoveFrom(null); setMoveTarget(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mover Mesa {moveFrom?.number}</DialogTitle>
            <DialogDescription>
              Selecciona la mesa destino. El pedido, productos y tiempo de ocupación se trasladarán automáticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-[50vh] overflow-y-auto p-1">
            {mesas.filter((m) => m.id !== moveFrom?.id).map((m) => {
              const isTarget = moveTarget?.id === m.id;
              const isOcc = m.status === "occupied";
              return (
                <button
                  key={m.id}
                  onClick={() => setMoveTarget(m)}
                  className={`rounded-xl border-2 p-3 text-center transition ${
                    isTarget ? "border-primary bg-primary/10 ring-2 ring-primary"
                      : isOcc ? "border-destructive/40 bg-destructive/5"
                      : "border-success/40 bg-success/5 hover:border-success"
                  }`}
                >
                  <div className="font-display text-2xl font-bold">{m.number}</div>
                  <div className="text-[10px] text-muted-foreground">{STATUS_LABEL[m.status]}</div>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMoveFrom(null); setMoveTarget(null); }} disabled={moving}>
              Cancelar
            </Button>
            <Button onClick={() => doMove(false)} disabled={!moveTarget || moving}>
              Confirmar traslado{moveTarget ? ` a Mesa ${moveTarget.number}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!splitTarget} onOpenChange={(o) => !o && setSplitTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Separar Mesa {splitTarget?.number}</DialogTitle>
            <DialogDescription>
              Los productos volverán a la mesa desde la que se fusionaron. Las mesas sin productos quedarán libres.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm">
            Mesas fusionadas:{" "}
            <span className="font-semibold">
              {mesas
                .filter((x) => x.merged_into_id === splitTarget?.id)
                .map((x) => `Mesa ${x.number}`)
                .join(", ") || "—"}
            </span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitTarget(null)}>Cancelar</Button>
            <Button onClick={confirmSplit}>
              <Unlink className="h-4 w-4" /> Separar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </BranchCashGuard>
  );
}
