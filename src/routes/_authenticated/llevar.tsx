import { createFileRoute, useRouter } from "@tanstack/react-router";
import { PosScreen } from "@/components/pos-screen";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import { LlevarPendingPanel } from "@/components/llevar-pending-panel";
import { Button } from "@/components/ui/button";
import paraLlevarImg from "@/assets/para_llevar.png";

export const Route = createFileRoute("/_authenticated/llevar")({
  head: () => ({ meta: [{ title: "Para llevar · Goloso POS" }] }),
  component: () => (
    <BranchCashGuard extraMessage="Solicita al cajero iniciar el turno para poder operar.">
      <div className="space-y-4">
        <div className="flex justify-center">
          <img
            src={paraLlevarImg}
            alt="Para llevar"
            className="w-full max-w-xs sm:max-w-sm object-contain select-none"
            draggable={false}
          />
        </div>
        <LlevarPendingPanel />
        <PosScreen orderType="llevar" />
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
