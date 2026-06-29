import { createFileRoute } from "@tanstack/react-router";
import { PosScreen } from "@/components/pos-screen";
import { BranchCashGuard } from "@/components/branch-cash-guard";

export const Route = createFileRoute("/_authenticated/domicilio")({
  head: () => ({ meta: [{ title: "A domicilio · Goloso POS" }] }),
  component: () => (
    <BranchCashGuard extraMessage="Solicita al cajero iniciar el turno para poder operar.">
      <PosScreen orderType="domicilio" />
    </BranchCashGuard>
  ),
});
