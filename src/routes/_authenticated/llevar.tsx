import { createFileRoute, useRouter } from "@tanstack/react-router";
import { PosScreen } from "@/components/pos-screen";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import { LlevarPendingPanel } from "@/components/llevar-pending-panel";
import { Button } from "@/components/ui/button";
import { ShoppingBag } from "lucide-react";
import takeawayImg from "@/assets/takeaway-goloso-3d.png";

export const Route = createFileRoute("/_authenticated/llevar")({
  head: () => ({ meta: [{ title: "Para llevar · Goloso POS" }] }),
  component: () => (
    <BranchCashGuard extraMessage="Solicita al cajero iniciar el turno para poder operar.">
      <div className="space-y-4 premium-scope">
        {/* Hero premium — título 3D degradado azul→verde + mostrador 3D a la derecha */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-white via-sky-50/60 to-emerald-50/50 dark:from-slate-900 dark:via-sky-950/40 dark:to-emerald-950/30 shadow-[0_20px_60px_-20px_rgba(2,132,199,0.35),0_8px_24px_-12px_rgba(16,185,129,0.25),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-white/60 dark:ring-white/5">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(700px 240px at 90% -10%, rgba(16,185,129,0.18), transparent 60%), radial-gradient(600px 220px at -5% 110%, rgba(2,132,199,0.18), transparent 60%)",
            }}
          />
          <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-5 py-5 sm:px-10 sm:py-8">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/80 dark:bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300 shadow-sm ring-1 ring-sky-500/20 backdrop-blur">
                <ShoppingBag className="h-3 w-3" /> Para llevar · Goloso
              </div>
              <h1
                className="font-display mt-2 text-4xl sm:text-6xl md:text-7xl font-black uppercase tracking-tight leading-[0.9] bg-clip-text text-transparent animate-fade-in whitespace-nowrap"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, #0369a1 0%, #0284c7 35%, #10b981 75%, #84cc16 100%)",
                  WebkitTextStroke: "0.5px rgba(255,255,255,0.4)",
                  filter:
                    "drop-shadow(0 2px 0 rgba(255,255,255,0.6)) drop-shadow(0 8px 20px rgba(2,132,199,0.35))",
                }}
              >
                Para Llevar
              </h1>
              <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-300 max-w-md">
                Registra pedidos para recoger. Rápido, elegante y sin fricción.
              </p>
            </div>
            <img
              src={takeawayImg}
              alt="Mostrador para llevar Goloso"
              width={1024}
              height={1024}
              loading="lazy"
              className="h-36 w-auto sm:h-56 md:h-64 object-contain select-none -mr-2 sm:-mr-4 drop-shadow-[0_20px_25px_rgba(2,132,199,0.35)] animate-fade-in"
              draggable={false}
            />
          </div>
        </div>

        <PosScreen orderType="llevar" hideTitle />
        <LlevarPendingPanel />
      </div>
    </BranchCashGuard>
  ),
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="mx-auto max-w-lg p-6 text-center space-y-4">
        <h1 className="text-2xl font-display">No se pudo cargar Para llevar</h1>
        <p className="text-sm text-muted-foreground break-words">{error?.message}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => { reset(); router.invalidate(); }}>Reintentar</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/")}>Inicio</Button>
        </div>
      </div>
    );
  },
});
