import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { PosScreen } from "@/components/pos-screen";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import { LlevarPendingPanel } from "@/components/llevar-pending-panel";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";
import barraImg from "@/assets/goloso-barra.png";
import golosoLogo from "@/assets/goloso-logo-official.png";

function LlevarHeader() {
  const navigate = useNavigate();
  return (
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
          className="uppercase leading-[0.85] tracking-[-0.02em] text-4xl sm:text-5xl md:text-6xl bg-clip-text text-transparent select-none shrink-0 flex items-center"
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
          Para Llevar
        </h1>

        <div className="flex-1" />

        <img
          src={barraImg}
          alt="Barra Goloso"
          loading="eager"
          className="h-20 sm:h-24 md:h-28 w-auto object-contain select-none shrink-0 drop-shadow-[0_12px_18px_rgba(2,132,199,0.35)]"
          draggable={false}
        />

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
  );
}

export const Route = createFileRoute("/_authenticated/llevar")({
  head: () => ({ meta: [{ title: "Para llevar · Goloso POS" }] }),
  component: () => (
    <BranchCashGuard extraMessage="Solicita al cajero iniciar el turno para poder operar.">
      <div className="space-y-4 premium-scope">
        <LlevarHeader />
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
