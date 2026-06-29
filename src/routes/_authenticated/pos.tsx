import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PosScreen, type OrderType } from "@/components/pos-screen";
import { BranchCashGuard } from "@/components/branch-cash-guard";

const searchSchema = z.object({
  type: z.enum(["mesa", "llevar", "domicilio", "kiosko"]).optional(),
  tableId: z.string().optional(),
  kioskSaleId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({ meta: [{ title: "Punto de venta · Goloso POS" }] }),
  validateSearch: searchSchema,
  component: POSRoute,
});

function POSRoute() {
  const { type, tableId, kioskSaleId } = Route.useSearch();
  const orderType: OrderType = type ?? (tableId ? "mesa" : kioskSaleId ? "kiosko" : "llevar");
  return (
    <BranchCashGuard extraMessage="Solicita al cajero iniciar el turno para poder operar.">
      <PosScreen orderType={orderType} tableId={tableId ?? null} kioskSaleId={kioskSaleId ?? null} />
    </BranchCashGuard>
  );
}
