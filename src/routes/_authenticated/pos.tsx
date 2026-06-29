import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { PosScreen, type OrderType } from "@/components/pos-screen";
import { BranchCashGuard } from "@/components/branch-cash-guard";
import { Button } from "@/components/ui/button";

const searchSchema = z.object({
  type: z.enum(["mesa", "llevar", "domicilio", "kiosko"]).optional(),
  tableId: z.string().optional(),
  kioskSaleId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({ meta: [{ title: "Punto de venta · Goloso POS" }] }),
  validateSearch: searchSchema,
  component: POSRoute,
  errorComponent: PosErrorFallback,
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

function PosErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-lg p-6 text-center space-y-4">
      <h1 className="text-2xl font-display">No se pudo cargar el POS</h1>
      <p className="text-sm text-muted-foreground break-words">{error?.message ?? "Error desconocido"}</p>
      <div className="flex justify-center gap-2">
        <Button onClick={() => { reset(); router.invalidate(); }}>Reintentar</Button>
        <Button variant="outline" onClick={() => (window.location.href = "/")}>Ir al inicio</Button>
      </div>
    </div>
  );
}
